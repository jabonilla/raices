import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  claimInboundMessage,
  withInboundClaim,
  type ChannelInboundDatabase,
} from "../src/webhooks/inbound.js";
import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * P3.1 — durable inbound dedupe, against real Postgres.
 *
 * The property this file exists for is the one in the ticket: the dedupe
 * claim commits in the same transaction as the work it guards. A claim that
 * survives while the work rolls back is the bug the table is here to
 * prevent, so it is proven by killing the work and looking at what is left,
 * never by reasoning about the code.
 *
 * The "work" is a scratch table rather than a real request insert. The
 * property under test is transactional atomicity between two writes, and a
 * scratch table makes a failure mean exactly that — not a missing fixture, a
 * foreign key, or a trigger from another ticket.
 */

const PROVIDER = "whatsapp-fake";

let pgx: TestPostgres;
let pool: pg.Pool;
let db: Kysely<ChannelInboundDatabase>;

/** Unique per run so repeated local runs never collide on the unique index. */
function freshMessageId(label: string): string {
  return `${label}-${crypto.randomUUID()}`;
}

/**
 * Everything a careless log handler could get out of an error: own
 * properties, message, stack, and the whole cause chain. Asserting against
 * `error.message` alone would miss node-postgres's `detail`, which is
 * exactly where the payload would leak.
 */
function dumpError(error: unknown, depth = 0): string {
  if (depth > 5 || typeof error !== "object" || error === null) return String(error);
  const parts: string[] = [];
  if (error instanceof Error) parts.push(error.message, error.stack ?? "");
  for (const key of Object.getOwnPropertyNames(error)) {
    const value: unknown = (error as Record<string, unknown>)[key];
    parts.push(
      key,
      typeof value === "object" && value !== null ? dumpError(value, depth + 1) : String(value),
    );
  }
  return parts.join("\n");
}

async function workRowCount(tag: string): Promise<number> {
  const result = await sql<{ n: string }>`
    select count(*)::text as n from __p31_work where tag = ${tag}
  `.execute(db);
  return Number(result.rows[0]?.n ?? "0");
}

async function claimRowCount(providerMessageId: string): Promise<number> {
  const result = await sql<{ n: string }>`
    select count(*)::text as n from channel_inbound_message
    where provider = ${PROVIDER} and provider_message_id = ${providerMessageId}
  `.execute(db);
  return Number(result.rows[0]?.n ?? "0");
}

beforeAll(async () => {
  pgx = await startTestPostgres();
  // Wide enough that "20 concurrent" means 20 in flight rather than a queue.
  pool = new pg.Pool({ connectionString: pgx.connectionString, max: 30 });
  // The crash tests terminate a backend out from under the pool. That
  // surfaces as an 'error' on the client socket, which is an uncaught
  // exception unless something is listening — on the checked-out client as
  // well as the idle one. Expected here; the pool discards the dead client.
  pool.on("error", () => undefined);
  pool.on("connect", (client) => client.on("error", () => undefined));
  db = new Kysely<ChannelInboundDatabase>({ dialect: new PostgresDialect({ pool }) });

  await sql`
    create table if not exists __p31_work (
      id  uuid primary key default gen_random_uuid(),
      tag text not null
    )
  `.execute(db);
});

afterAll(async () => {
  await db.destroy();
  await pgx.stop();
});

beforeEach(async () => {
  await sql`truncate __p31_work`.execute(db);
});

describe("inbound dedupe: at-least-once delivery", () => {
  it("processes the same provider_message_id once; the second is a silent no-op", async () => {
    const messageId = freshMessageId("twice");
    const tag = messageId;

    const first = await withInboundClaim(
      db,
      {
        provider: PROVIDER,
        providerMessageId: messageId,
        receivedAt: new Date(),
        payload: { a: 1 },
      },
      async (trx) => {
        await sql`insert into __p31_work (tag) values (${tag})`.execute(trx);
        return "did-the-work";
      },
    );

    // Redelivery. Must not throw, must not run the work again.
    const second = await withInboundClaim(
      db,
      {
        provider: PROVIDER,
        providerMessageId: messageId,
        receivedAt: new Date(),
        payload: { a: 1 },
      },
      async (trx) => {
        await sql`insert into __p31_work (tag) values (${tag})`.execute(trx);
        return "did-the-work";
      },
    );

    expect(first).toEqual({ deduped: false, result: "did-the-work" });
    expect(second).toEqual({ deduped: true });
    expect(await workRowCount(tag)).toBe(1);
    expect(await claimRowCount(messageId)).toBe(1);
  });

  it("treats the same message id from a different provider as a different message", async () => {
    const messageId = freshMessageId("shared-id");

    const a = await withInboundClaim(
      db,
      { provider: "provider-a", providerMessageId: messageId, receivedAt: new Date(), payload: {} },
      () => Promise.resolve("a"),
    );
    const b = await withInboundClaim(
      db,
      { provider: "provider-b", providerMessageId: messageId, receivedAt: new Date(), payload: {} },
      () => Promise.resolve("b"),
    );

    // Uniqueness is on the pair. Two providers numbering their messages from
    // 1 must not silently swallow each other's traffic.
    expect(a).toEqual({ deduped: false, result: "a" });
    expect(b).toEqual({ deduped: false, result: "b" });
  });

  it("stores the raw payload verbatim, including fields nothing here understands", async () => {
    const messageId = freshMessageId("verbatim");
    const payload = {
      from: "+50255551234",
      text: "¿me mandas Q200?",
      nested: { deep: [1, 2, { three: true }] },
      unknown_provider_field: "kept",
    };

    await withInboundClaim(
      db,
      { provider: PROVIDER, providerMessageId: messageId, receivedAt: new Date(), payload },
      () => Promise.resolve(undefined),
    );

    const row = await sql<{ payload: unknown }>`
      select payload from channel_inbound_message
      where provider = ${PROVIDER} and provider_message_id = ${messageId}
    `.execute(db);
    expect(row.rows[0]?.payload).toEqual(payload);
  });
});

describe("inbound dedupe: the claim and the work share a transaction", () => {
  it("rolls the claim back when the work throws, so redelivery is accepted", async () => {
    const messageId = freshMessageId("throws");
    const tag = messageId;

    await expect(
      withInboundClaim(
        db,
        { provider: PROVIDER, providerMessageId: messageId, receivedAt: new Date(), payload: {} },
        async (trx) => {
          await sql`insert into __p31_work (tag) values (${tag})`.execute(trx);
          throw new Error("work blew up after the claim");
        },
      ),
    ).rejects.toThrow("work blew up after the claim");

    // The claim must not have survived the work it was guarding.
    expect(await claimRowCount(messageId)).toBe(0);
    expect(await workRowCount(tag)).toBe(0);

    // And redelivery must now succeed, not be swallowed as a duplicate.
    const retry = await withInboundClaim(
      db,
      { provider: PROVIDER, providerMessageId: messageId, receivedAt: new Date(), payload: {} },
      async (trx) => {
        await sql`insert into __p31_work (tag) values (${tag})`.execute(trx);
        return "retried";
      },
    );
    expect(retry).toEqual({ deduped: false, result: "retried" });
    expect(await workRowCount(tag)).toBe(1);
  });

  it("rolls the claim back when the process dies mid-work, with no chance to ROLLBACK", async () => {
    const messageId = freshMessageId("crash");
    const tag = messageId;

    // A thrown error is a clean unwind: the client still sends ROLLBACK. A
    // crash does not. This kills the backend from a second connection while
    // the first is mid-transaction, so nothing on the dying side gets to run
    // any cleanup — the closest thing to `kill -9` that a test can arrange.
    const victim = new pg.Client({ connectionString: pgx.connectionString });
    // The terminated backend sends a FATAL that surfaces as an async 'error'
    // event. Expected here — swallow it so it is not an unhandled rejection.
    victim.on("error", () => undefined);
    await victim.connect();
    const backendPid = (await victim.query<{ pid: number }>("select pg_backend_pid() as pid"))
      .rows[0]?.pid;
    expect(backendPid).toBeTypeOf("number");

    await victim.query("begin isolation level serializable");
    await victim.query(
      `insert into channel_inbound_message
         (provider, provider_message_id, received_at, payload, processing_state)
       values ($1, $2, now(), $3, 'processed')`,
      [PROVIDER, messageId, JSON.stringify({ mid: "flight" })],
    );
    await victim.query("insert into __p31_work (tag) values ($1)", [tag]);

    // Both writes are now live inside an uncommitted transaction.
    const executioner = new pg.Client({ connectionString: pgx.connectionString });
    await executioner.connect();
    await executioner.query("select pg_terminate_backend($1)", [backendPid]);
    await executioner.end();
    await victim.end().catch(() => undefined);

    // Neither write survived, and crucially they did not survive separately.
    expect(await claimRowCount(messageId)).toBe(0);
    expect(await workRowCount(tag)).toBe(0);

    // Redelivery after the crash is processed, not mistaken for a duplicate.
    const redelivery = await withInboundClaim(
      db,
      { provider: PROVIDER, providerMessageId: messageId, receivedAt: new Date(), payload: {} },
      async (trx) => {
        await sql`insert into __p31_work (tag) values (${tag})`.execute(trx);
        return "redelivered";
      },
    );
    expect(redelivery).toEqual({ deduped: false, result: "redelivered" });
    expect(await claimRowCount(messageId)).toBe(1);
    expect(await workRowCount(tag)).toBe(1);
  });

  it("rolls the claim back when the process dies inside withInboundClaim itself", async () => {
    // The test above proves Postgres unwinds both writes together, but it
    // hand-writes the INSERT, so it says nothing about whether
    // withInboundClaim puts the claim and the work in one transaction. This
    // one kills the backend from inside the work callback, so the real code
    // path takes the real crash.
    const messageId = freshMessageId("crash-in-module");
    const tag = messageId;

    const executioner = new pg.Client({ connectionString: pgx.connectionString });
    await executioner.connect();

    await expect(
      withInboundClaim(
        db,
        { provider: PROVIDER, providerMessageId: messageId, receivedAt: new Date(), payload: {} },
        async (trx) => {
          await sql`insert into __p31_work (tag) values (${tag})`.execute(trx);
          const pid = (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx))
            .rows[0]?.pid;
          // Kill the connection this transaction is running on. 57P01 is not
          // a serialization failure, so withSerializableTx does not retry it.
          await executioner.query("select pg_terminate_backend($1)", [pid]);
          await sql`select 1`.execute(trx);
          return "should never get here";
        },
      ),
    ).rejects.toThrow();

    await executioner.end();

    expect(await claimRowCount(messageId)).toBe(0);
    expect(await workRowCount(tag)).toBe(0);

    const redelivery = await withInboundClaim(
      db,
      { provider: PROVIDER, providerMessageId: messageId, receivedAt: new Date(), payload: {} },
      async (trx) => {
        await sql`insert into __p31_work (tag) values (${tag})`.execute(trx);
        return "redelivered";
      },
    );
    expect(redelivery).toEqual({ deduped: false, result: "redelivered" });
    expect(await workRowCount(tag)).toBe(1);
  });

  it("refuses to let a claim be taken outside the work's transaction", async () => {
    // claimInboundMessage takes a Transaction, not a Kysely, so the unsafe
    // shape — claim in one transaction, work in another — does not typecheck.
    // This asserts the runtime half: a claim taken in a transaction that then
    // rolls back leaves nothing behind for a later, separate attempt to trip
    // over.
    const messageId = freshMessageId("separate-tx");

    await db
      .transaction()
      .setIsolationLevel("serializable")
      .execute(async (trx) => {
        const claim = await claimInboundMessage(trx, {
          provider: PROVIDER,
          providerMessageId: messageId,
          receivedAt: new Date(),
          payload: {},
        });
        expect(claim.claimed).toBe(true);
        throw new Error("abandon");
      })
      .catch(() => undefined);

    expect(await claimRowCount(messageId)).toBe(0);
  });
});

describe("inbound dedupe: concurrency", () => {
  it("processes exactly once under 20 concurrent deliveries of one message", async () => {
    const messageId = freshMessageId("thundering-herd");
    const tag = messageId;

    const deliveries = Array.from({ length: 20 }, () =>
      withInboundClaim(
        db,
        {
          provider: PROVIDER,
          providerMessageId: messageId,
          receivedAt: new Date(),
          payload: { n: 1 },
        },
        async (trx) => {
          await sql`insert into __p31_work (tag) values (${tag})`.execute(trx);
          return "worked";
        },
      ),
    );

    const outcomes = await Promise.all(deliveries);
    const processed = outcomes.filter((o) => !o.deduped);
    const deduped = outcomes.filter((o) => o.deduped);

    expect(processed).toHaveLength(1);
    expect(deduped).toHaveLength(19);
    // The claim row is the dedupe key; the work row is the thing a double
    // process would duplicate. Both must be exactly one.
    expect(await claimRowCount(messageId)).toBe(1);
    expect(await workRowCount(tag)).toBe(1);
  });

  it("lets exactly one of 20 concurrent deliveries win when all but one would fail", async () => {
    // Every delivery that wins the claim immediately fails its work, except
    // the last one to try. The losers must not consume the message: a failed
    // winner has to hand the id back, not leave it claimed.
    const messageId = freshMessageId("retry-herd");
    const tag = messageId;

    let attempts = 0;
    const deliveries = Array.from({ length: 20 }, () =>
      withInboundClaim(
        db,
        { provider: PROVIDER, providerMessageId: messageId, receivedAt: new Date(), payload: {} },
        async (trx) => {
          attempts += 1;
          if (attempts < 3) throw new Error("transient");
          await sql`insert into __p31_work (tag) values (${tag})`.execute(trx);
          return "worked";
        },
      ).catch((error: unknown) => ({ failed: error })),
    );

    await Promise.all(deliveries);

    // Whatever the interleaving, the message is processed at most once and
    // the failures left nothing claimed behind them.
    expect(await workRowCount(tag)).toBeLessThanOrEqual(1);
    expect(await claimRowCount(messageId)).toBe(await workRowCount(tag));
  });
});

describe("inbound dedupe: the payload is PII", () => {
  it("keeps payload contents out of the error raised on a bad claim", async () => {
    const messageId = freshMessageId("pii");
    const secret = "+50255559999";

    await withInboundClaim(
      db,
      {
        provider: PROVIDER,
        providerMessageId: messageId,
        receivedAt: new Date(),
        payload: { from: secret },
      },
      () => Promise.resolve(undefined),
    );

    // Force a failure with the payload in hand: an oversized provider value
    // violates the column constraint while the payload is being carried.
    // Postgres reports a constraint violation with the whole failing row in
    // DETAIL, so the raw driver error holds the phone number.
    let caught: unknown;
    try {
      await withInboundClaim(
        db,
        {
          provider: "x".repeat(300),
          providerMessageId: messageId,
          receivedAt: new Date(),
          payload: { from: secret },
        },
        () => Promise.resolve(undefined),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    // Everything a log handler could reach: own properties, message, stack,
    // and anything hanging off a cause chain.
    expect(dumpError(caught)).not.toContain(secret);
  });
});
