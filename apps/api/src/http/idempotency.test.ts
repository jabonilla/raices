import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, expect, it } from "vitest";

import type { Database } from "../db/schema.js";
import { ApiError, BadRequestError, ConflictError, ServiceUnavailableError } from "../errors.js";
import { createHmac } from "node:crypto";
import { startTestPostgres, type TestPostgres } from "../../../../tests/pg.js";
import { PostgresReceiptStore, requestFingerprint } from "./idempotency.js";

/**
 * The durable half of idempotency, on its own.
 *
 * It is tested here rather than only through the routes because the
 * in-memory middleware in front of it answers first and hides it: a replay
 * conflict over HTTP is caught by the process-local store, so an HTTP test
 * cannot tell whether the durable one still checks anything. Disabling the
 * durable fingerprint comparison leaves every route test passing, which is
 * how this file came to exist.
 *
 * The distinction is not academic. The in-memory store is one process and
 * fifteen minutes; this one is the receipt that is still there after a
 * restart, a deploy, or a request landing on another replica — which is
 * precisely when a retried "send my family $250" would otherwise run twice.
 */

const PEPPER = "durable-receipt-test-pepper-32-bytes-min";

let server: TestPostgres;
let db: Kysely<Database>;
let store: PostgresReceiptStore;

beforeAll(async () => {
  server = await startTestPostgres();
  db = server.kysely<Database>();
  store = new PostgresReceiptStore(db, PEPPER);
}, 120_000);

afterAll(async () => {
  await server.stop();
});

const actor = () => crypto.randomUUID();
const hash = (value: unknown) => requestFingerprint(value);

it("refuses a pepper too short to be a secret", () => {
  expect(() => new PostgresReceiptStore(db, "short")).toThrow(/at least 32 bytes/u);
});

it("runs the operation once and replays the stored value", async () => {
  const input = { actorId: actor(), key: "k-replay", requestHash: hash({ amount: 250 }) };
  let runs = 0;
  const first = await store.run(input, () => {
    runs += 1;
    return Promise.resolve({ id: "req-1" });
  });
  const second = await store.run(input, () => {
    runs += 1;
    return Promise.resolve({ id: "req-2" });
  });
  expect(first).toEqual({ id: "req-1" });
  expect(second).toEqual({ id: "req-1" });
  expect(runs).toBe(1);
});

it("refuses the same key carrying a different request", async () => {
  const actorId = actor();
  await store.run({ actorId, key: "k-conflict", requestHash: hash({ amount: 250 }) }, () =>
    Promise.resolve("ok"),
  );
  let ran = false;
  await expect(
    store.run({ actorId, key: "k-conflict", requestHash: hash({ amount: 25_000 }) }, () => {
      ran = true;
      return Promise.resolve("ok");
    }),
  ).rejects.toBeInstanceOf(ConflictError);
  // The point of the refusal is that the second amount never happened.
  expect(ran).toBe(false);
});

it("scopes keys to the actor", async () => {
  const key = "k-shared";
  const requestHash = hash({ amount: 100 });
  const mine = await store.run({ actorId: actor(), key, requestHash }, () =>
    Promise.resolve("mine"),
  );
  const theirs = await store.run({ actorId: actor(), key, requestHash }, () =>
    Promise.resolve("theirs"),
  );
  expect([mine, theirs]).toEqual(["mine", "theirs"]);
});

it("stores a definite domain failure and replays it without re-running", async () => {
  const input = { actorId: actor(), key: "k-declined", requestHash: hash({ reason: "" }) };
  let runs = 0;
  const operation = () => {
    runs += 1;
    return Promise.reject(new BadRequestError("A decline needs a reason."));
  };
  await expect(store.run(input, operation)).rejects.toBeInstanceOf(BadRequestError);
  const replayed = await store.run(input, operation).catch((error: unknown) => error);
  expect(replayed).toBeInstanceOf(ApiError);
  expect((replayed as ApiError).statusCode).toBe(400);
  expect((replayed as ApiError).message).toBe("A decline needs a reason.");
  // A 4xx is a decision the system made and can repeat from the receipt.
  expect(runs).toBe(1);
});

it("leaves an ambiguous failure unresolved rather than running the mutation twice", async () => {
  const input = { actorId: actor(), key: "k-crash", requestHash: hash({ amount: 999 }) };
  let runs = 0;
  // An unexpected throw may have come from either side of the commit. The
  // store cannot know whether the money moved, so it refuses to guess.
  await expect(
    store.run(input, () => {
      runs += 1;
      return Promise.reject(new Error("connection terminated unexpectedly"));
    }),
  ).rejects.toBeInstanceOf(ServiceUnavailableError);

  await expect(
    store.run(input, () => {
      runs += 1;
      return Promise.resolve("second attempt");
    }),
  ).rejects.toBeInstanceOf(ServiceUnavailableError);

  // This is the whole design: a stuck receipt an operator has to look at,
  // chosen over a second transfer nobody asked for. It is at-most-once, and
  // the 503 is not a retry hint — retrying returns 503 forever until the row
  // is reconciled by hand.
  expect(runs).toBe(1);
  const row = await sql<{
    state: string;
    outcome: unknown;
  }>`select state, outcome from http_request_receipt order by created_at desc limit 1`.execute(db);
  expect(row.rows[0]).toMatchObject({ state: "started", outcome: null });
});

it("never writes the caller's idempotency key into the table", async () => {
  const key = "key-that-must-not-appear-5f3a9c";
  await store.run({ actorId: actor(), key, requestHash: hash({ amount: 1 }) }, () =>
    Promise.resolve("ok"),
  );
  const rows = await sql<{
    scope_hash: string;
  }>`select scope_hash from http_request_receipt`.execute(db);
  // An HMAC under a server-side pepper, so the stored key is not the key and
  // an actor id cannot be recovered from a database dump by guessing one.
  expect(rows.rows.map((row) => row.scope_hash)).not.toContain(key);
  for (const row of rows.rows) expect(row.scope_hash).toMatch(/^[0-9a-f]{64}$/u);
});

it("keys the row by an HMAC under the pepper, not by a plain hash", async () => {
  // Without this, dropping the pepper and hashing (actor, key) unkeyed
  // passes every other test here: the column still holds 64 hex characters
  // and still is not the raw key. The difference only shows up against
  // someone holding a database dump, for whom an unkeyed hash of a uuid and
  // a short key is an enumeration and an HMAC is not.
  const actorId = actor();
  const key = "k-pepper";
  await store.run({ actorId, key, requestHash: hash({ amount: 1 }) }, () => Promise.resolve("ok"));
  const expected = createHmac("sha256", PEPPER)
    .update(JSON.stringify([actorId, key]))
    .digest("hex");
  const row = await sql<{
    scope_hash: string;
  }>`select scope_hash from http_request_receipt where scope_hash = ${expected}`.execute(db);
  expect(row.rows).toHaveLength(1);
  const unkeyed = createHmac("sha256", "")
    .update(JSON.stringify([actorId, key]))
    .digest("hex");
  expect(expected).not.toBe(unkeyed);
});

it("will not store a receipt whose state and outcome disagree", async () => {
  // 0012's CHECK is why `state !== "completed"` in the replay path is
  // belt-and-braces rather than load-bearing: a started row cannot carry an
  // outcome, so testing the outcome alone would reach the same answer.
  // Removing that half of the condition is an equivalent mutant, and it is
  // equivalent *because* of this constraint — which is therefore worth
  // having a test of its own rather than a comment.
  const hex = "a".repeat(64);
  await expect(
    sql`insert into http_request_receipt(scope_hash, request_hash, state, outcome)
        values (${hex}, ${hex}, 'started', '{"ok":true}'::jsonb)`.execute(db),
  ).rejects.toThrow();
  await expect(
    sql`insert into http_request_receipt(scope_hash, request_hash, state, outcome)
        values (${"b".repeat(64)}, ${hex}, 'completed', null)`.execute(db),
  ).rejects.toThrow();
});

it("refuses to let the application delete a receipt", async () => {
  // Granting DELETE would make a replay re-executable, which is the double
  // charge the table exists to prevent. 0012 never grants it.
  const granted = await sql<{
    ok: boolean;
  }>`select has_table_privilege('app', 'http_request_receipt', 'delete') as ok`.execute(db);
  expect(granted.rows[0]?.ok).toBe(false);
});
