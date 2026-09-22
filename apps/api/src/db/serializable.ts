import type { Kysely, Transaction } from "kysely";

/**
 * Postgres SQLSTATEs that mean "this transaction lost a race and is safe to
 * replay from the top".
 *
 * - 40001 serialization_failure
 * - 40P01 deadlock_detected
 */
const RETRYABLE_SQLSTATES: ReadonlySet<string> = new Set(["40001", "40P01"]);

export const MAX_ATTEMPTS = 5;

/** Base for the exponential component of the backoff, in milliseconds. */
const BASE_DELAY_MS = 10;

/** Upper bound on the exponential component, before jitter. */
const MAX_DELAY_MS = 250;

/**
 * Thrown when a transaction serialized-failed on every attempt. Carries the
 * last underlying error as `cause` so the SQLSTATE is not lost.
 */
export class SerializationRetryExhausted extends Error {
  readonly attempts: number;

  constructor(attempts: number, options?: { cause?: unknown }) {
    super(`Transaction failed to serialize after ${String(attempts)} attempts`, options);
    this.name = "SerializationRetryExhausted";
    this.attempts = attempts;
  }
}

function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function isRetryableSerializationError(error: unknown): boolean {
  const code = sqlState(error);
  return code !== undefined && RETRYABLE_SQLSTATES.has(code);
}

/**
 * Full jitter: a uniform draw from [0, capped exponential]. Spreading retries
 * across the whole window is what stops a pile of conflicting writers from
 * retrying in lockstep and colliding again.
 */
function backoffDelayMs(attempt: number, random: () => number): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return Math.floor(random() * exponential);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WithSerializableTxOptions {
  /** Injectable for tests that need a deterministic backoff. */
  readonly random?: () => number;
  /** Injectable for tests that must not actually wait. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Run `fn` inside a SERIALIZABLE transaction, retrying the whole transaction
 * on a serialization failure or deadlock.
 *
 * `fn` must be replayable: it can run up to MAX_ATTEMPTS times, so it must not
 * carry state between attempts or perform side effects outside the transaction.
 * Any non-retryable error propagates immediately, on the first attempt.
 */
export async function withSerializableTx<DB, T>(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<T>,
  options: WithSerializableTxOptions = {},
): Promise<T> {
  const random = options.random ?? Math.random;
  const delay = options.sleep ?? sleep;

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await db.transaction().setIsolationLevel("serializable").execute(fn);
    } catch (error) {
      if (!isRetryableSerializationError(error)) throw error;

      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await delay(backoffDelayMs(attempt, random));
      }
    }
  }

  throw new SerializationRetryExhausted(MAX_ATTEMPTS, { cause: lastError });
}
