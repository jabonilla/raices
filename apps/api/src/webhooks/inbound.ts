import type { ColumnType, Kysely, Transaction } from "kysely";

import { withSerializableTx, type WithSerializableTxOptions } from "../db/serializable.js";

/**
 * P3.1 — durable inbound dedupe, mirroring `db/migrations/0010_channel_inbound.sql`.
 *
 * Replaces K2.28's in-memory Set, which forgot everything it had seen on
 * restart. The contract that matters is narrow and the whole ticket rests on
 * it: the claim is taken inside the caller's transaction, so it commits with
 * the work or not at all.
 */

/**
 * Both states are terminal at insert. There is deliberately no 'pending':
 * the claim shares a transaction with the work, so a visible row is a
 * message whose work committed. See the migration for the longer note.
 */
export type InboundProcessingState = "processed" | "ignored";

/** A column supplied on insert but never updated. */
type Immutable<Select, Insert = Select> = ColumnType<Select, Insert, never>;

/** A column the database fills in and that is never updated. */
type DefaultedImmutable<T> = ColumnType<T, T | undefined, never>;

export interface ChannelInboundMessageTable {
  id: DefaultedImmutable<string>;
  /** bigserial. node-postgres returns int8 as a string, never a lossy number. */
  seq: ColumnType<string, never, never>;
  provider: Immutable<string>;
  provider_message_id: Immutable<string>;
  received_at: Immutable<Date>;
  /** Raw provider payload. PII — see the error handling below. */
  payload: Immutable<unknown, string>;
  processing_state: Immutable<InboundProcessingState>;
  processed_at: DefaultedImmutable<Date>;
  created_at: DefaultedImmutable<Date>;
}

export interface ChannelInboundDatabase {
  channel_inbound_message: ChannelInboundMessageTable;
}

export interface InboundMessageClaim {
  readonly provider: string;
  readonly providerMessageId: string;
  readonly receivedAt: Date;
  /** Stored verbatim. Never logged, never put in a span, never in an error. */
  readonly payload: unknown;
  /** Defaults to "processed". */
  readonly state?: InboundProcessingState | undefined;
}

export type InboundClaimResult =
  { readonly claimed: true; readonly id: string } | { readonly claimed: false; readonly id: null };

export type InboundOutcome<T> =
  { readonly deduped: false; readonly result: T } | { readonly deduped: true };

/**
 * A write against `channel_inbound_message` was rejected.
 *
 * Carries the SQLSTATE and the constraint name and nothing else. Postgres
 * puts the entire offending row in the DETAIL of a constraint violation, and
 * for this table that row contains the provider's raw payload — a phone
 * number and the person's message. The ticket says the payload is never
 * echoed in an error, so the original error is dropped rather than attached
 * as `cause`: an error reachable through a `cause` chain is one `JSON.stringify`
 * in a log handler away from being the leak it was supposed to prevent.
 *
 * `code` survives because `withSerializableTx` reads it to decide whether a
 * transaction is worth replaying. Losing it here would turn every
 * serialization failure into a hard error.
 */
export class InboundStorageError extends Error {
  /** SQLSTATE, preserved so retry classification still works. */
  readonly code: string | undefined;
  readonly constraintName: string | undefined;

  constructor(code: string | undefined, constraintName: string | undefined) {
    super(
      `channel_inbound_message rejected a write (SQLSTATE ${code ?? "unknown"}` +
        `${constraintName === undefined ? "" : `, constraint ${constraintName}`}). ` +
        `Details withheld: an inbound payload is PII and never appears in an error.`,
    );
    this.name = "InboundStorageError";
    this.code = code;
    this.constraintName = constraintName;
  }
}

function stringProp(error: unknown, key: string): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value: unknown = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Strip a driver error down to the two fields that are safe to keep.
 *
 * Deliberately total: anything that is not a recognisable Postgres error
 * still comes back as an `InboundStorageError` with no fields, because the
 * alternative is re-raising an object whose shape we have not inspected
 * while it may be holding the payload.
 */
function withoutPayload(error: unknown): InboundStorageError {
  return new InboundStorageError(stringProp(error, "code"), stringProp(error, "constraint"));
}

/**
 * Claim `provider` + `providerMessageId` inside `trx`.
 *
 * Returns `{ claimed: false }` when the pair is already recorded — the
 * message has been processed and the caller must do nothing and report
 * success. At-least-once delivery makes a duplicate normal traffic, never an
 * error.
 *
 * Takes a `Transaction`, not a `Kysely`, so the dangerous shape — claim in
 * one transaction, work in another — cannot be written without going out of
 * the caller's way. `withInboundClaim` is the path that should be used.
 *
 * `on conflict do nothing` rather than catching a unique violation: when a
 * concurrent transaction holds the same key, the insert waits on it and then
 * sees the outcome. If that transaction committed, this one is a duplicate;
 * if it rolled back, this one takes the claim. Catching 23505 instead would
 * work, but it burns the transaction in Postgres and so cannot be recovered
 * from without a savepoint.
 */
export async function claimInboundMessage<DB extends ChannelInboundDatabase>(
  trx: Transaction<DB>,
  claim: InboundMessageClaim,
): Promise<InboundClaimResult> {
  // Kysely's DB generic is invariant, so a `DB extends ChannelInboundDatabase`
  // transaction is not assignable to one over the narrow type. The cast is
  // the documented escape; the constraint above is what makes it sound.
  const typed = trx as unknown as Transaction<ChannelInboundDatabase>;

  try {
    const row = await typed
      .insertInto("channel_inbound_message")
      .values({
        provider: claim.provider,
        provider_message_id: claim.providerMessageId,
        received_at: claim.receivedAt,
        // Explicit JSON.stringify rather than relying on the driver's
        // handling of an arbitrary JS value for a jsonb column.
        payload: JSON.stringify(claim.payload ?? null),
        processing_state: claim.state ?? "processed",
      })
      .onConflict((oc) => oc.columns(["provider", "provider_message_id"]).doNothing())
      .returning("id")
      .executeTakeFirst();

    return row === undefined ? { claimed: false, id: null } : { claimed: true, id: row.id };
  } catch (error) {
    throw withoutPayload(error);
  }
}

/**
 * Run `work` exactly once for this inbound message.
 *
 * The claim and `work` share one SERIALIZABLE transaction, so they commit
 * together or roll back together. If `work` throws — or the process dies
 * mid-flight — the claim goes with it and the provider's redelivery is
 * processed normally rather than being mistaken for a duplicate.
 *
 * `work` must be replayable: `withSerializableTx` may run the whole
 * transaction again on a serialization failure, so it must not carry state
 * between attempts or have effects outside the transaction it is given.
 */
export async function withInboundClaim<DB extends ChannelInboundDatabase, T>(
  db: Kysely<DB>,
  claim: InboundMessageClaim,
  work: (trx: Transaction<DB>) => Promise<T>,
  options: WithSerializableTxOptions = {},
): Promise<InboundOutcome<T>> {
  return withSerializableTx(
    db,
    async (trx): Promise<InboundOutcome<T>> => {
      const claimed = await claimInboundMessage(trx, claim);
      if (!claimed.claimed) return { deduped: true };
      return { deduped: false, result: await work(trx) };
    },
    options,
  );
}
