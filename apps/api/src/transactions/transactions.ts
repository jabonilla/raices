import { isCurrency, money, type Money } from "@raices/money";
import type { Kysely, Transaction } from "kysely";

import { transitionWithin, transition, type Actor, type Channel } from "../audit/index.js";
import type { Database } from "../db/schema.js";
import { withSerializableTx } from "../db/serializable.js";
import { MAX_COLLISION_ATTEMPTS, isPostKeyRace, postWithin } from "../ledger/index.js";
import { requestMachine } from "../requests/index.js";
import type { RequestStatus } from "../requests/schema.js";
import { transactionIntentMachine, transactionSettlementMachine } from "./machine.js";
import type { IntentState, SettlementState, TransactionDatabase } from "./schema.js";

/** SQLSTATE raised by the state-pair guard in 0007. */
const STATE_PAIR_VIOLATION = "TX001";

/** An actor who can approve or cancel. The system expires; it does not agree. */
export type ResolvingActor = Extract<Actor, { id: string }>;

export class CancelAfterSettlementError extends Error {
  readonly transactionId: string;

  constructor(transactionId: string, options?: { cause?: unknown }) {
    super(
      `Transaction ${transactionId} cannot have its intent cancelled: settlement has already ` +
        `started. Money that has been instructed is reversed, not un-agreed.`,
      options,
    );
    this.name = "CancelAfterSettlementError";
    this.transactionId = transactionId;
  }
}

function isStatePairViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === STATE_PAIR_VIOLATION;
}

/** The two ledger accounts an approval posts between. */
export interface ApprovalPosting {
  readonly debitAccountId: string;
  readonly creditAccountId: string;
  readonly entryType: string;
}

export interface ApproveAndRecordInput {
  readonly requestId: string;
  readonly actor: ResolvingActor;
  readonly channel?: Channel;
  /**
   * Which accounts the double entry moves between.
   *
   * Supplied by the caller. There is no chart of accounts in the domain yet —
   * `ledger_account` holds codes, and nothing maps a relationship to a pair
   * of them. Inventing that mapping here would bury a decision that belongs
   * in its own ticket, so the accounts come in from outside until it exists.
   */
  readonly posting: ApprovalPosting;
  /** What is known about the approver right now, recorded as it stands. */
  readonly assuranceLevel?: string;
  /** Business time for the ledger entry. Defaults to now. */
  readonly occurredAt?: Date;
}

export interface ApproveAndRecordResult {
  readonly transactionId: string;
  readonly ledgerTransactionId: string;
  /** True when the request was already approved and nothing was written. */
  readonly replayed: boolean;
}

export interface TransactionRecord {
  readonly id: string;
  readonly requestId: string;
  readonly relationshipId: string;
  readonly amount: Money;
  readonly intentState: IntentState;
  readonly settlementState: SettlementState;
  readonly approvedBy: string;
  readonly approvedAt: Date;
  readonly assuranceLevelAtApproval: string | null;
  readonly settlementProvider: string | null;
  readonly providerReferenceId: string | null;
  readonly fxRateApplied: string | null;
  readonly fee: Money | null;
  readonly recipientAmount: Money | null;
}

function amountFrom(minor: string, currency: string, what: string): Money {
  if (!isCurrency(currency)) {
    throw new Error(`${what} has unsupported currency ${JSON.stringify(currency)}.`);
  }
  return money(BigInt(minor), currency);
}

function optionalAmountFrom(
  minor: string | null,
  currency: string | null,
  what: string,
): Money | null {
  if (minor === null && currency === null) return null;
  if (minor === null || currency === null) {
    throw new Error(`${what} is half-set: an amount without a currency, or the reverse.`);
  }
  return amountFrom(minor, currency, what);
}

interface RequestRow {
  readonly status: RequestStatus;
  readonly relationship_id: string;
  readonly amount_minor: string;
  readonly amount_currency: string;
  readonly description: string;
}

async function readRequestRow(
  trx: Transaction<TransactionDatabase>,
  requestId: string,
): Promise<RequestRow> {
  const row = await trx
    .selectFrom("request")
    .select(["status", "relationship_id", "amount_minor", "amount_currency", "description"])
    .where("id", "=", requestId)
    .executeTakeFirst();

  if (row === undefined) throw new Error(`No request ${requestId}`);
  return row;
}

async function findExisting(
  trx: Transaction<TransactionDatabase>,
  requestId: string,
): Promise<ApproveAndRecordResult | undefined> {
  const tx = await trx
    .selectFrom("transaction")
    .select("id")
    .where("request_id", "=", requestId)
    .executeTakeFirst();
  if (tx === undefined) return undefined;

  const ledger = await trx
    .selectFrom("ledger_transaction")
    .select("id")
    .where("idempotency_key", "=", requestId)
    .executeTakeFirst();

  return {
    transactionId: tx.id,
    ledgerTransactionId: ledger?.id ?? "",
    replayed: true,
  };
}

/**
 * Approve a request: move its status, record the transaction, post the
 * double entry — all in one transaction.
 *
 * The three have to commit together. A transaction row without its posting
 * is money we think we moved and did not; a posting without its transaction
 * row is money we moved for a reason we cannot name; an approved request
 * with neither is a promise to the recipient with nothing behind it.
 *
 * Idempotent on the request id, which is also the ledger's idempotency key.
 * Approving the same request twenty times over produces one transaction and
 * one posting: the unique constraint on `request_id` and the unique
 * idempotency key are what enforce that, not the check at the top. Under
 * SERIALIZABLE the losers conflict on the request row, get retried by
 * `withSerializableTx` against a snapshot where the winner is visible, and
 * replay.
 */
export async function approveAndRecord(
  db: Kysely<Database>,
  input: ApproveAndRecordInput,
): Promise<ApproveAndRecordResult> {
  const occurredAt = input.occurredAt ?? new Date();

  for (let attempt = 1; attempt <= MAX_COLLISION_ATTEMPTS; attempt += 1) {
    try {
      return await withSerializableTx(db, async (raw) => {
        const trx = raw as unknown as Transaction<TransactionDatabase>;

        const request = await readRequestRow(trx, input.requestId);

        // Already approved: this is a replay, not a second approval.
        if (request.status === "approved") {
          const existing = await findExisting(trx, input.requestId);
          if (existing !== undefined) return existing;
        }

        const amount = amountFrom(
          request.amount_minor,
          request.amount_currency,
          `Request ${input.requestId}`,
        );

        // The request's own transition, inside this transaction rather than
        // opening its own, so its audit row commits with everything else.
        const transactionId = await transitionWithin(
          trx,
          requestMachine,
          {
            entityId: input.requestId,
            from: request.status,
            to: "approved",
            action: "request.approve",
            actor: input.actor,
            ...(input.channel === undefined ? {} : { channel: input.channel }),
            ...(input.assuranceLevel === undefined ? {} : { assuranceLevel: input.assuranceLevel }),
          },
          async (inner) => {
            await inner
              .updateTable("request")
              .set({
                status: "approved",
                resolved_by: input.actor.id,
                resolved_at: occurredAt,
              })
              .where("id", "=", input.requestId)
              .execute();

            const created = await inner
              .insertInto("transaction")
              .values({
                request_id: input.requestId,
                relationship_id: request.relationship_id,
                amount_minor: amount.amount,
                amount_currency: amount.currency,
                approved_by: input.actor.id,
                approved_at: occurredAt,
                assurance_level_at_approval: input.assuranceLevel ?? null,
              })
              .returning("id")
              .executeTakeFirstOrThrow();

            return created.id;
          },
        );

        // The request id is the idempotency key, per the ticket: one request
        // can only ever produce one posting, and the key says so.
        const posted = await postWithin(raw as unknown as Transaction<Database>, {
          idempotencyKey: input.requestId,
          description: request.description,
          occurredAt,
          entries: [
            {
              accountId: input.posting.debitAccountId,
              direction: "debit",
              amount,
              entryType: input.posting.entryType,
            },
            {
              accountId: input.posting.creditAccountId,
              direction: "credit",
              amount,
              entryType: input.posting.entryType,
            },
          ],
        });

        return {
          transactionId,
          ledgerTransactionId: posted.transactionId,
          replayed: false,
        };
      });
    } catch (error) {
      // Lost the race for the idempotency key to a caller who has since
      // committed. A fresh transaction sees their row and replays; retrying
      // inside this one cannot, because its snapshot predates their commit.
      //
      // Measured note, matching the one on ConcurrentKeyInsert in
      // ledger/post.ts: this branch does not fire today. Under SERIALIZABLE
      // the racing callers conflict on the request row and raise 40001
      // first, which withSerializableTx retries, so the fresh snapshot finds
      // the winner and the replay check at the top returns. Instrumenting
      // the 20-parallel test threw this zero times. It is kept as a guard
      // for the case where that stops being true, not because it is doing
      // work — a mutation that disables it is not caught by any test.
      if (isPostKeyRace(error) && attempt < MAX_COLLISION_ATTEMPTS) continue;
      throw error;
    }
  }

  throw new Error(
    `Could not resolve the approval of request ${JSON.stringify(input.requestId)} after ` +
      `${String(MAX_COLLISION_ATTEMPTS)} attempts`,
  );
}

export async function readTransaction(
  db: Kysely<Database>,
  transactionId: string,
): Promise<TransactionRecord> {
  const trx = db as unknown as Kysely<TransactionDatabase>;

  const row = await trx
    .selectFrom("transaction")
    .selectAll()
    .where("id", "=", transactionId)
    .executeTakeFirst();

  if (row === undefined) throw new Error(`No transaction ${transactionId}`);

  return {
    id: row.id,
    requestId: row.request_id,
    relationshipId: row.relationship_id,
    amount: amountFrom(row.amount_minor, row.amount_currency, `Transaction ${transactionId}`),
    intentState: row.intent_state,
    settlementState: row.settlement_state,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    assuranceLevelAtApproval: row.assurance_level_at_approval,
    settlementProvider: row.settlement_provider,
    providerReferenceId: row.provider_reference_id,
    fxRateApplied: row.fx_rate_applied,
    fee: optionalAmountFrom(row.fee_minor, row.fee_currency, `Transaction ${transactionId} fee`),
    recipientAmount: optionalAmountFrom(
      row.recipient_amount_minor,
      row.recipient_amount_currency,
      `Transaction ${transactionId} recipient amount`,
    ),
  };
}

async function currentStates(
  db: Kysely<Database>,
  transactionId: string,
): Promise<{ intent: IntentState; settlement: SettlementState }> {
  const trx = db as unknown as Kysely<TransactionDatabase>;
  const row = await trx
    .selectFrom("transaction")
    .select(["intent_state", "settlement_state"])
    .where("id", "=", transactionId)
    .executeTakeFirstOrThrow();
  return { intent: row.intent_state, settlement: row.settlement_state };
}

export interface CancelIntentInput {
  readonly transactionId: string;
  readonly actor: ResolvingActor;
  readonly channel?: Channel;
}

/**
 * Withdraw the agreement to move money.
 *
 * Refused once settlement has left `not_started`: at that point money has
 * been instructed, and the honest record of that is a reversal, not a
 * cancellation that pretends the instruction never happened.
 *
 * The refusal is the database's (0007, TX001), so it holds for any writer
 * rather than only for callers of this function. There was a matching check
 * here as well until mutation testing showed the pair masking each other —
 * removing either one alone left every test green, because the other still
 * produced the same error. One layer, in the place that covers everyone.
 */
export async function cancelIntent(db: Kysely<Database>, input: CancelIntentInput): Promise<void> {
  const { intent } = await currentStates(db, input.transactionId);

  try {
    await transition(
      db,
      transactionIntentMachine,
      {
        entityId: input.transactionId,
        from: intent,
        to: "cancelled",
        action: "transaction.cancelled",
        actor: input.actor,
        ...(input.channel === undefined ? {} : { channel: input.channel }),
      },
      async (trx) => {
        await (trx as unknown as Transaction<TransactionDatabase>)
          .updateTable("transaction")
          .set({ intent_state: "cancelled" })
          .where("id", "=", input.transactionId)
          .execute();
      },
    );
  } catch (error) {
    if (isStatePairViolation(error)) {
      throw new CancelAfterSettlementError(input.transactionId, { cause: error });
    }
    throw error;
  }
}

export interface AdvanceSettlementInput {
  readonly transactionId: string;
  readonly to: SettlementState;
  readonly actor: Actor;
  readonly channel?: Channel;
  readonly settlementProvider?: string;
  readonly providerReferenceId?: string;
}

/**
 * Move where the money is.
 *
 * Separate from intent on purpose, and audited under its own entity type, so
 * the history of what the money did can be read without the history of what
 * was agreed getting mixed into it.
 */
export async function advanceSettlement(
  db: Kysely<Database>,
  input: AdvanceSettlementInput,
): Promise<void> {
  const { settlement } = await currentStates(db, input.transactionId);

  await transition(
    db,
    transactionSettlementMachine,
    {
      entityId: input.transactionId,
      from: settlement,
      to: input.to,
      action: `transaction.${input.to}`,
      actor: input.actor,
      ...(input.channel === undefined ? {} : { channel: input.channel }),
    },
    async (trx) => {
      await (trx as unknown as Transaction<TransactionDatabase>)
        .updateTable("transaction")
        .set({
          settlement_state: input.to,
          ...(input.settlementProvider === undefined
            ? {}
            : { settlement_provider: input.settlementProvider }),
          ...(input.providerReferenceId === undefined
            ? {}
            : { provider_reference_id: input.providerReferenceId }),
        })
        .where("id", "=", input.transactionId)
        .execute();
    },
  );
}
