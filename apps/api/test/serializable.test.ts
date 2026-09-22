import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_ATTEMPTS,
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

  it("gives up after MAX_ATTEMPTS with SerializationRetryExhausted", async () => {
    let attempts = 0;

    const alwaysConflicts = async () => {
      await withSerializableTx(
        db,
        () => {
          attempts += 1;
          return Promise.reject(
            Object.assign(new Error("serialization_failure"), { code: "40001" }),
          );
        },
        { sleep: () => Promise.resolve() },
      );
    };

    await expect(alwaysConflicts()).rejects.toThrow(SerializationRetryExhausted);
    expect(attempts).toBe(MAX_ATTEMPTS);
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
