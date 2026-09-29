import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_RETRY_BUDGET_MS,
  SerializationRetryExhausted,
  isRetryableSerializationError,
  withSerializableTx,
} from "../src/db/serializable.js";
import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

interface ProbeDatabase {
  retry_probe: {
    id: number;
    n: number;
  };
}

/** A promise plus its resolver, used to interleave the two transactions. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = () => {
      resolve();
    };
  });
  return { wait, open };
}

function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

describe("withSerializableTx", () => {
  let pg: TestPostgres;
  let db: Kysely<ProbeDatabase>;

  beforeAll(async () => {
    pg = await startTestPostgres();
    db = pg.kysely<ProbeDatabase>();
    await sql`create table if not exists retry_probe (id int primary key, n int not null)`.execute(
      db,
    );
  });

  afterAll(async () => {
    await pg.stop();
  });

  beforeEach(async () => {
    await sql`truncate retry_probe`.execute(db);
    await db.insertInto("retry_probe").values({ id: 1, n: 0 }).execute();
  });

  /**
   * Both transactions read the row, then both write it. Under SERIALIZABLE the
   * second writer blocks on the first, and is aborted with 40001 when the first
   * commits. This control test pins that the scenario really does produce a
   * serialization failure, so the retry test below is not passing vacuously.
   */
  it("read-then-write from two concurrent transactions produces a 40001", async () => {
    const a = gate();
    const b = gate();

    const bump = async (self: { open: () => void }, other: { wait: Promise<void> }) => {
      await db
        .transaction()
        .setIsolationLevel("serializable")
        .execute(async (trx) => {
          const row = await trx
            .selectFrom("retry_probe")
            .select("n")
            .where("id", "=", 1)
            .executeTakeFirstOrThrow();

          self.open();
          await other.wait;

          await trx
            .updateTable("retry_probe")
            .set({ n: row.n + 1 })
            .where("id", "=", 1)
            .execute();
        });
    };

    const results = await Promise.allSettled([bump(a, b), bump(b, a)]);

    const rejections = results.filter((r) => r.status === "rejected");
    expect(rejections).toHaveLength(1);
    expect(sqlState(rejections[0]?.reason)).toBe("40001");

    // The aborted transaction wrote nothing, so the increment was lost.
    const after = await db
      .selectFrom("retry_probe")
      .select("n")
      .where("id", "=", 1)
      .executeTakeFirstOrThrow();
    expect(after.n).toBe(1);
  });

  it("retries the losing transaction and both increments land", async () => {
    const a = gate();
    const b = gate();

    let attempts = 0;

    const bump = async (self: { open: () => void }, other: { wait: Promise<void> }) => {
      await withSerializableTx(db, async (trx) => {
        attempts += 1;

        const row = await trx
          .selectFrom("retry_probe")
          .select("n")
          .where("id", "=", 1)
          .executeTakeFirstOrThrow();

        // Only the first attempt participates in the interleave; a retry runs
        // straight through, because both gates are already open by then.
        self.open();
        await other.wait;

        await trx
          .updateTable("retry_probe")
          .set({ n: row.n + 1 })
          .where("id", "=", 1)
          .execute();
      });
    };

    await Promise.all([bump(a, b), bump(b, a)]);

    // Two callers, one of which lost the race and ran a second time.
    expect(attempts).toBe(3);

    // Neither increment was lost, which is the whole point of the retry.
    const after = await db
      .selectFrom("retry_probe")
      .select("n")
      .where("id", "=", 1)
      .executeTakeFirstOrThrow();
    expect(after.n).toBe(2);
  });

  /** How long a failing attempt is taken to cost, in simulated milliseconds. */
  const ATTEMPT_COST_MS = 1;

  /**
   * A clock the test drives, so the budget is measured against simulated time
   * and the test neither waits nor depends on how fast the machine is.
   *
   * Both the sleep and the attempt itself move it. Charging for the attempt
   * matters: full jitter can legitimately draw a delay of zero, and a clock
   * that only advanced on sleep would then never reach the deadline — the
   * test would hang on a system that in reality makes progress, because a
   * real transaction costs time whether or not it succeeds.
   */
  function fakeClock(): {
    now: () => number;
    sleep: (ms: number) => Promise<void>;
    tick: (ms: number) => void;
  } {
    let t = 0;
    return {
      now: () => t,
      sleep: (ms) => {
        t += ms;
        return Promise.resolve();
      },
      tick: (ms) => {
        t += ms;
      },
    };
  }

  /** A transaction body that always loses the race, and costs time doing it. */
  function alwaysConflicting(clock: { tick: (ms: number) => void }): () => Promise<never> {
    return () => {
      clock.tick(ATTEMPT_COST_MS);
      return Promise.reject(Object.assign(new Error("serialization_failure"), { code: "40001" }));
    };
  }

  it("gives up when the budget runs out, with SerializationRetryExhausted", async () => {
    let attempts = 0;
    const clock = fakeClock();

    const alwaysConflicts = async () => {
      await withSerializableTx(
        db,
        () => {
          attempts += 1;
          return alwaysConflicting(clock)();
        },
        { sleep: clock.sleep, now: clock.now, budgetMs: 2_000, random: () => 1 },
      );
    };

    await expect(alwaysConflicts()).rejects.toThrow(SerializationRetryExhausted);

    // The budget, not a fixed count, is what stopped it: with the backoff
    // capped at 250ms and full jitter pinned to its maximum, 2s buys far more
    // than the five attempts the old attempt-based budget allowed.
    expect(attempts).toBeGreaterThan(5);
    expect(clock.now()).toBeGreaterThanOrEqual(2_000);
  });

  /**
   * Full jitter means the delay is a uniform draw from the whole window,
   * [0, capped exponential]. The two tests below pin both ends of that
   * window, which together rule out the lightly-jittered variants the issue
   * warns about: a scheme like `exponential * (0.9 + 0.2 * random)` can
   * never yield 0, and never yields the full exponential either.
   */
  async function delaysWith(random: () => number, budgetMs: number): Promise<number[]> {
    const clock = fakeClock();
    const delays: number[] = [];
    await withSerializableTx(db, alwaysConflicting(clock), {
      sleep: clock.sleep,
      now: clock.now,
      budgetMs,
      random,
      onAttempt: (a) => {
        if (a.delayMs !== undefined) delays.push(a.delayMs);
      },
    }).catch(() => undefined);
    return delays;
  }

  it("draws the backoff from the bottom of the window", async () => {
    // A draw of 0 must give a delay of 0. Nothing that merely perturbs the
    // exponential around its nominal value can do that.
    const delays = await delaysWith(() => 0, 100);
    expect(delays.length).toBeGreaterThan(1);
    expect(delays.every((d) => d === 0)).toBe(true);
  });

  it("draws the backoff from the top of the window, capped", async () => {
    // A draw of 1 must give the full capped exponential: 10, 20, 40, 80,
    // 160, then flat at the 250ms cap.
    const delays = await delaysWith(() => 1, 5_000);
    expect(delays.slice(0, 5)).toEqual([10, 20, 40, 80, 160]);
    expect(delays.slice(5, 9)).toEqual([250, 250, 250, 250]);
  });

  it("reports attempts, elapsed and budget on the exhaustion error", async () => {
    const clock = fakeClock();

    const alwaysConflicts = withSerializableTx(db, alwaysConflicting(clock), {
      sleep: clock.sleep,
      now: clock.now,
      budgetMs: 500,
      random: () => 1,
    });

    const error = await alwaysConflicts.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SerializationRetryExhausted);
    const exhausted = error as SerializationRetryExhausted;

    expect(exhausted.budgetMs).toBe(500);
    expect(exhausted.elapsedMs).toBeGreaterThanOrEqual(500);
    // Never sleeps past the deadline: the last wait is trimmed to whatever
    // budget is left, so we overrun only by the attempt already in flight.
    expect(exhausted.elapsedMs).toBeLessThanOrEqual(500 + ATTEMPT_COST_MS);
    expect(exhausted.attempts).toBeGreaterThan(1);
    // Retryable, so a caller can tell "busy, try again" from "broken".
    expect(exhausted.retryable).toBe(true);
    expect(sqlState(exhausted.cause)).toBe("40001");
  });

  it("spends a smaller budget sooner", async () => {
    const attemptsWithin = async (budgetMs: number): Promise<number> => {
      const clock = fakeClock();
      let attempts = 0;
      await withSerializableTx(
        db,
        () => {
          attempts += 1;
          return alwaysConflicting(clock)();
        },
        { sleep: clock.sleep, now: clock.now, budgetMs, random: () => 1 },
      ).catch(() => undefined);
      return attempts;
    };

    // The budget is what governs how many attempts happen, so a larger one
    // must buy strictly more of them.
    expect(await attemptsWithin(2_000)).toBeGreaterThan(await attemptsWithin(200));
  });

  it("defaults to the documented budget", async () => {
    const clock = fakeClock();
    const error = await withSerializableTx(db, alwaysConflicting(clock), {
      sleep: clock.sleep,
      now: clock.now,
      random: () => 1,
    }).catch((e: unknown) => e as SerializationRetryExhausted);

    expect(error.budgetMs).toBe(DEFAULT_RETRY_BUDGET_MS);
  });

  it("does not retry an error that is not a serialization failure", async () => {
    let attempts = 0;

    const boom = async () => {
      await withSerializableTx(db, () => {
        attempts += 1;
        return Promise.reject(Object.assign(new Error("not null violation"), { code: "23502" }));
      });
    };

    await expect(boom()).rejects.toThrow("not null violation");
    expect(attempts).toBe(1);
  });
});

describe("isRetryableSerializationError", () => {
  it("recognises serialization_failure and deadlock_detected only", () => {
    expect(isRetryableSerializationError({ code: "40001" })).toBe(true);
    expect(isRetryableSerializationError({ code: "40P01" })).toBe(true);
    expect(isRetryableSerializationError({ code: "23505" })).toBe(false);
    expect(isRetryableSerializationError(new Error("no sqlstate"))).toBe(false);
    expect(isRetryableSerializationError(undefined)).toBe(false);
  });
});
