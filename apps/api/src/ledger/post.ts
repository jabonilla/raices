import { createHash } from "node:crypto";

import {
  add,
  equals,
  isCurrency,
  money,
  SUPPORTED_CURRENCIES,
  type Currency,
  type Money,
} from "@raices/money";
import type { Kysely, Transaction } from "kysely";
import { z } from "zod";

import type { Database } from "../db/schema.js";
import { withSerializableTx } from "../db/serializable.js";

/** Postgres raises this when the unique idempotency key collides. */
const UNIQUE_VIOLATION = "23505";
const IDEMPOTENCY_KEY_CONSTRAINT = "ledger_transaction_idempotency_key_key";

/**
 * How many times a caller may lose the duplicate-key race before we give up.
 *
 * Losing once is the expected outcome of a genuine race and resolves to a
 * replay on the next attempt, which reads a fresh snapshot. Losing repeatedly
 * would mean something else is wrong.
 */
const MAX_COLLISION_ATTEMPTS = 3;

/**
 * Internal: the key is neither insertable nor visible from this snapshot,
 * because another caller committed it after our snapshot was taken. The retry
 * loop below resolves it into a replay; it never reaches a caller.
 *
 * Measured note: on Postgres 16 this is currently unreachable. A racing
 * ON CONFLICT under SERIALIZABLE raises 40001 before reaching here, and
 * `withSerializableTx` retries that, so the fresh snapshot finds the winner
 * and replays. Instrumenting every race test in this suite — the staged
 * race, 20 parallel, 50 parallel and ten repeated races — threw this zero
 * times. It is kept as a guard for the case where that stops being true
 * (a different isolation level, or a Postgres that reports the collision as
 * 23505 instead), not because it is doing work today.
 */
class ConcurrentKeyInsert extends Error {
  constructor(idempotencyKey: string) {
    super(`Idempotency key ${JSON.stringify(idempotencyKey)} was committed concurrently`);
    this.name = "ConcurrentKeyInsert";
  }
}

export class UnbalancedPostingError extends Error {
  readonly currency: Currency;
  readonly debitMinor: bigint;
  readonly creditMinor: bigint;

  constructor(currency: Currency, debitMinor: bigint, creditMinor: bigint) {
    super(
      `Posting does not balance in ${currency}: debits ${debitMinor.toString()} ` +
        `!= credits ${creditMinor.toString()}`,
    );
    this.name = "UnbalancedPostingError";
    this.currency = currency;
    this.debitMinor = debitMinor;
    this.creditMinor = creditMinor;
  }
}

export class IdempotencyConflictError extends Error {
  readonly idempotencyKey: string;
  readonly storedHash: string;
  readonly requestHash: string;

  constructor(idempotencyKey: string, storedHash: string, requestHash: string) {
    super(
      `Idempotency key ${JSON.stringify(idempotencyKey)} was already used for a different ` +
        `request. A key identifies one posting; reusing it with changed contents is a bug, ` +
        `not a retry.`,
    );
    this.name = "IdempotencyConflictError";
    this.idempotencyKey = idempotencyKey;
    this.storedHash = storedHash;
    this.requestHash = requestHash;
  }
}

/**
 * Exported for OpenAPI generation (apps/api/src/openapi.ts): the document's
 * schema components are generated from these exact schemas, so the published
 * contract can never drift from what `post` validates.
 *
 * The `.meta()` declares the JSON representation of this custom guard for
 * generators that read Zod 4 native metadata. It changes nothing about
 * validation: the guard still accepts exactly the supported ISO 4217 codes.
 */
export const CurrencySchema = z
  .custom<Currency>(isCurrency, {
    message: "unsupported currency",
  })
  .meta({ type: "string", enum: [...SUPPORTED_CURRENCIES] });

/**
 * Money arrives as the frozen value from packages/money. It is re-validated
 * here rather than trusted: `post` is a boundary, and CLAUDE.md puts Zod at
 * every boundary.
 */
export const MoneySchema = z.object({
  // Wire representation declared for OpenAPI generation (see CurrencySchema
  // above): positive bigint amounts are decimal strings without leading
  // zeros. Validation behavior is unchanged.
  amount: z.bigint().positive().meta({ pattern: "^[1-9]\\d*$" }),
  currency: CurrencySchema,
});

export const EntrySchema = z.object({
  accountId: z.uuid(),
  direction: z.enum(["debit", "credit"]),
  amount: MoneySchema,
  entryType: z.string().min(1),
});

/**
 * Two entries is the floor for double entry, and the database enforces it too.
 * Rejecting here gives the caller a useful message instead of a SQLSTATE.
 */
export const PostRequestSchema = z.object({
  idempotencyKey: z.string().min(1),
  description: z.string().min(1),
  occurredAt: z.date(),
  entries: z.array(EntrySchema).min(2),
});

export interface PostEntry {
  readonly accountId: string;
  readonly direction: "debit" | "credit";
  readonly amount: Money;
  readonly entryType: string;
}

export interface PostRequest {
  readonly idempotencyKey: string;
  readonly description: string;
  readonly occurredAt: Date;
  readonly entries: readonly PostEntry[];
}

export interface PostResult {
  readonly transactionId: string;
  readonly seq: bigint;
  /** True when this call returned an existing transaction and wrote nothing. */
  readonly replayed: boolean;
}

type ParsedRequest = z.infer<typeof PostRequestSchema>;

/**
 * Debits must equal credits within each currency, checked here in TypeScript
 * before anything is written. The deferred database trigger checks the same
 * thing at commit; both are required, and neither is redundant. This one gives
 * the caller a precise error, and the database one holds even for writers that
 * never go through this function.
 */
function assertBalanced(entries: ParsedRequest["entries"]): void {
  const totals = new Map<Currency, { debit: Money; credit: Money }>();

  for (const entry of entries) {
    const currency = entry.amount.currency;
    const amount = money(entry.amount.amount, currency);
    const running = totals.get(currency) ?? {
      debit: money(0n, currency),
      credit: money(0n, currency),
    };

    if (entry.direction === "debit") {
      running.debit = add(running.debit, amount);
    } else {
      running.credit = add(running.credit, amount);
    }

    totals.set(currency, running);
  }

  for (const [currency, { debit, credit }] of totals) {
    if (!equals(debit, credit)) {
      throw new UnbalancedPostingError(currency, debit.amount, credit.amount);
    }
  }
}

interface CanonicalEntry {
  readonly accountId: string;
  readonly amount: string;
  readonly currency: string;
  readonly direction: string;
  readonly entryType: string;
}

function compareCanonicalEntries(a: CanonicalEntry, b: CanonicalEntry): number {
  if (a.accountId !== b.accountId) return a.accountId < b.accountId ? -1 : 1;
  if (a.direction !== b.direction) return a.direction < b.direction ? -1 : 1;
  if (a.currency !== b.currency) return a.currency < b.currency ? -1 : 1;

  const amountA = BigInt(a.amount);
  const amountB = BigInt(b.amount);
  if (amountA !== amountB) return amountA < amountB ? -1 : 1;

  if (a.entryType !== b.entryType) return a.entryType < b.entryType ? -1 : 1;
  return 0;
}

/**
 * A stable rendering of the request, used to tell a retry from a different
 * request that reused the key.
 *
 * Entries are sorted, so the same posting sent with its legs in a different
 * order is recognised as the same request rather than reported as a conflict.
 * A permutation of the same entries produces an identical ledger, so treating
 * it as a conflict would reject a safe retry.
 *
 * Amounts are decimal strings of the bigint minor units and never numbers, so
 * the hash cannot be changed by a float round-trip.
 */
function canonicalize(request: ParsedRequest): string {
  const entries: CanonicalEntry[] = request.entries
    .map((entry) => ({
      accountId: entry.accountId,
      amount: entry.amount.amount.toString(),
      currency: entry.amount.currency,
      direction: entry.direction,
      entryType: entry.entryType,
    }))
    .sort(compareCanonicalEntries);

  // Keys are written in alphabetical order so the JSON is stable.
  return JSON.stringify({
    description: request.description,
    entries,
    idempotencyKey: request.idempotencyKey,
    occurredAt: request.occurredAt.toISOString(),
  });
}

export function requestHashOf(request: PostRequest): string {
  const parsed = PostRequestSchema.parse(request);
  return createHash("sha256").update(canonicalize(parsed)).digest("hex");
}

function isIdempotencyKeyCollision(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === UNIQUE_VIOLATION && candidate.constraint === IDEMPOTENCY_KEY_CONSTRAINT;
}

interface ExistingTransaction {
  id: string;
  seq: string;
  request_hash: string;
}

async function findByKey(
  trx: Transaction<Database>,
  idempotencyKey: string,
): Promise<ExistingTransaction | undefined> {
  return trx
    .selectFrom("ledger_transaction")
    .select(["id", "seq", "request_hash"])
    .where("idempotency_key", "=", idempotencyKey)
    .executeTakeFirst();
}

function replayOf(
  existing: ExistingTransaction,
  idempotencyKey: string,
  requestHash: string,
): PostResult {
  if (existing.request_hash !== requestHash) {
    throw new IdempotencyConflictError(idempotencyKey, existing.request_hash, requestHash);
  }
  return {
    transactionId: existing.id,
    seq: BigInt(existing.seq),
    replayed: true,
  };
}

/**
 * Write one double-entry transaction.
 *
 * Runs in SERIALIZABLE through `withSerializableTx`, so a serialization
 * failure is retried transparently. Idempotent by `idempotencyKey`: the same
 * key with the same contents replays and writes nothing, and the same key with
 * different contents is an error rather than a silent second posting.
 */
export async function post(db: Kysely<Database>, request: PostRequest): Promise<PostResult> {
  const parsed = PostRequestSchema.parse(request);
  assertBalanced(parsed.entries);

  const requestHash = createHash("sha256").update(canonicalize(parsed)).digest("hex");

  for (let attempt = 1; attempt <= MAX_COLLISION_ATTEMPTS; attempt += 1) {
    try {
      return await withSerializableTx(db, async (trx) => {
        // Insert first, rather than checking for the key and then inserting.
        // The check would be a read of the idempotency index, and under
        // SERIALIZABLE that read takes a predicate lock: on a small index
        // every key sits on the same page, so 50 concurrent postings with
        // distinct keys would all rw-conflict and cancel each other as
        // pivots. ON CONFLICT resolves the collision in the index instead,
        // where it costs nothing.
        const created = await trx
          .insertInto("ledger_transaction")
          .values({
            idempotency_key: parsed.idempotencyKey,
            request_hash: requestHash,
            description: parsed.description,
            occurred_at: parsed.occurredAt,
          })
          .onConflict((oc) => oc.column("idempotency_key").doNothing())
          .returning(["id", "seq"])
          .executeTakeFirst();

        if (created === undefined) {
          // The key already exists. Either it was committed before our
          // snapshot, in which case we can read it and replay, or a
          // concurrent caller committed it after our snapshot, in which case
          // it is invisible here and only a fresh transaction can see it.
          const existing = await findByKey(trx, parsed.idempotencyKey);
          if (existing !== undefined) {
            return replayOf(existing, parsed.idempotencyKey, requestHash);
          }
          throw new ConcurrentKeyInsert(parsed.idempotencyKey);
        }

        await trx
          .insertInto("ledger_entry")
          .values(
            parsed.entries.map((entry) => ({
              transaction_id: created.id,
              account_id: entry.accountId,
              direction: entry.direction,
              amount_minor: entry.amount.amount,
              currency: entry.amount.currency,
              entry_type: entry.entryType,
            })),
          )
          .execute();

        return {
          transactionId: created.id,
          seq: BigInt(created.seq),
          replayed: false,
        };
      });
    } catch (error) {
      // We lost a race to another caller using the same new key. The winner
      // has committed by the time this surfaces, so the next attempt opens a
      // fresh transaction, reads a fresh snapshot, finds their row and
      // replays. Retrying inside the failed transaction would not work: it is
      // aborted, and its snapshot predates the winner's commit.
      //
      // See ConcurrentKeyInsert above: today 40001 gets there first and
      // withSerializableTx handles the race, so this branch is a guard rather
      // than the mechanism.
      const lostTheRace = error instanceof ConcurrentKeyInsert || isIdempotencyKeyCollision(error);
      if (lostTheRace && attempt < MAX_COLLISION_ATTEMPTS) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `Could not resolve idempotency key ${JSON.stringify(parsed.idempotencyKey)} after ` +
      `${String(MAX_COLLISION_ATTEMPTS)} attempts`,
  );
}
