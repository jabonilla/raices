import type { Kysely, Transaction } from "kysely";

/**
 * Postgres SQLSTATEs that mean "this transaction lost a race and is safe to
 * replay from the top".
 *
 * - 40001 serialization_failure
 * - 40P01 deadlock_detected
 */
const RETRYABLE_SQLSTATES: ReadonlySet<string> = new Set(["40001", "40P01"]);

/**
 * How long to keep retrying a transaction that keeps losing races, in
 * milliseconds.
 *
 * A budget in wall-clock time rather than a count of attempts. A caller cares
 * how long it waited, not how many times we tried, and under contention the
 * two are not related: the same five attempts can take 40ms on an idle
 * machine and be over before the contention has cleared, or take a second on
 * a loaded one. Counting attempts makes the failure rate depend on how busy
 * the host is, which is how a legitimate posting ends up rejected for losing
 * five coin flips (issue #44).
 *
 * The value comes from measurement, not taste. See docs/adr or the PR for
 * issue #44 for the attempt distribution this was chosen against.
 */
export const DEFAULT_RETRY_BUDGET_MS = 2_000;

/** Base for the exponential component of the backoff, in milliseconds. */
const BASE_DELAY_MS = 10;

/** Upper bound on the exponential component, before jitter. */
const MAX_DELAY_MS = 250;

/**
 * Thrown when a transaction was still losing races when its budget ran out.
 *
 * Distinct and retryable on purpose: the work was never applied and the same
 * call can be made again, so this is a "busy, try again" condition and not an
 * internal error. Callers must map it to a retryable response — never a
 * generic 500, and never swallow it.
 */
export class SerializationRetryExhausted extends Error {
  /** Marks this as safe for the caller to retry. */
  readonly retryable = true;
  readonly attempts: number;
  readonly elapsedMs: number;
  readonly budgetMs: number;

  constructor(
    attempts: number,
    elapsedMs: number,
    budgetMs: number,
    options?: { cause?: unknown },
  ) {
    super(
      `Transaction still serialization-failing after ${String(attempts)} attempts ` +
        `over ${String(elapsedMs)}ms (budget ${String(budgetMs)}ms)`,
      options,
    );
    this.name = "SerializationRetryExhausted";
    this.attempts = attempts;
    this.elapsedMs = elapsedMs;
    this.budgetMs = budgetMs;
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
 * retrying in lockstep and colliding again. Jittering only part of the window
 * leaves them clustered, which is the failure this is here to avoid.
 */
function backoffDelayMs(attempt: number, random: () => number): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return Math.floor(random() * exponential);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** What happened on one attempt. Reported to `onAttempt`, if supplied. */
export interface TransactionAttempt {
  /** 1-based. */
  readonly attempt: number;
  readonly outcome: "committed" | "retrying" | "exhausted";
  /** Milliseconds since the first attempt started. */
  readonly elapsedMs: number;
  /** The SQLSTATE that caused a retry, when there was one. */
  readonly sqlState?: string | undefined;
  /** How long we are about to wait, when retrying. */
  readonly delayMs?: number | undefined;
}

export interface WithSerializableTxOptions {
  /** Injectable for tests that need a deterministic backoff. */
  readonly random?: () => number;
  /** Injectable for tests that must not actually wait. */
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * Injectable clock. A test that stubs `sleep` must stub this too, or the
   * budget is measured against real time that the stub never advances.
   */
  readonly now?: () => number;
  /** Override the retry budget in milliseconds. */
  readonly budgetMs?: number;
  /** Observe each attempt. Used to measure contention; never to control it. */
  readonly onAttempt?: (attempt: TransactionAttempt) => void;
}

/**
 * Run `fn` inside a SERIALIZABLE transaction, retrying the whole transaction
 * on a serialization failure or deadlock until the retry budget runs out.
 *
 * `fn` must be replayable: it can run many times, so it must not carry state
 * between attempts or perform side effects outside the transaction. Any
 * non-retryable error propagates immediately, on the first attempt.
 *
 * The budget bounds when we stop *starting* attempts, so the total can exceed
 * it by the duration of the attempt already in flight. Bounding it exactly
 * would mean abandoning a transaction mid-commit, which tells us nothing
 * about whether it committed.
 */
export async function withSerializableTx<DB, T>(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<T>,
  options: WithSerializableTxOptions = {},
): Promise<T> {
  const random = options.random ?? Math.random;
  const delay = options.sleep ?? sleep;
  const clock = options.now ?? Date.now;
  const budgetMs = options.budgetMs ?? DEFAULT_RETRY_BUDGET_MS;
  const onAttempt = options.onAttempt;

  const startedAt = clock();
  const deadline = startedAt + budgetMs;

  let lastError: unknown;

  for (let attempt = 1; ; attempt += 1) {
    try {
      const result = await db.transaction().setIsolationLevel("serializable").execute(fn);
      onAttempt?.({ attempt, outcome: "committed", elapsedMs: clock() - startedAt });
      return result;
    } catch (error) {
      if (!isRetryableSerializationError(error)) throw error;
      lastError = error;

      const remaining = deadline - clock();
      if (remaining <= 0) {
        const elapsedMs = clock() - startedAt;
        onAttempt?.({ attempt, outcome: "exhausted", elapsedMs, sqlState: sqlState(error) });
        throw new SerializationRetryExhausted(attempt, elapsedMs, budgetMs, { cause: lastError });
      }

      // Never sleep past the deadline: the time left is better spent on one
      // more attempt than on waiting to be told we are out of time.
      const delayMs = Math.min(backoffDelayMs(attempt, random), remaining);
      onAttempt?.({
        attempt,
        outcome: "retrying",
        elapsedMs: clock() - startedAt,
        delayMs,
        sqlState: sqlState(error),
      });
      await delay(delayMs);
    }
  }
}
