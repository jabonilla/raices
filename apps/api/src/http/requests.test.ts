import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { CENSOR, censorSensitiveKeys } from "../logging.js";
import { startSpan, setSpanExporter } from "../telemetry.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "../db/schema.js";
import { startTestPostgres, type TestPostgres } from "../../../../tests/pg.js";
import { findOrCreateUserByPhone } from "../relationships/users.js";
import { invite, activate } from "../relationships/relationships.js";
import type { IdentityService } from "../identity/service.js";

let server: TestPostgres;
let db: Kysely<Database>;
let sender: string;
let recipient: string;
let stranger: string;
let relationshipId: string;
let debit: string;
let credit: string;
let app: FastifyInstance;
const tokens = new Map<string, string>();
function headers(user: string, key = randomUUID()) {
  const token = [...tokens].find(([, id]) => id === user)?.[0];
  return { authorization: `Bearer ${token ?? ""}`, "idempotency-key": key };
}
beforeAll(async () => {
  server = await startTestPostgres();
  db = server.kysely<Database>();
  sender = (await findOrCreateUserByPhone(db, { phone: "+15551112221", role: "sender" })).id;
  recipient = (await findOrCreateUserByPhone(db, { phone: "+50251112222", role: "recipient" })).id;
  stranger = (await findOrCreateUserByPhone(db, { phone: "+15551112223", role: "sender" })).id;
  [sender, recipient, stranger].forEach((id, i) => tokens.set(String(i + 1).repeat(43), id));
  relationshipId = (await invite(db, { senderId: sender, recipientId: recipient })).id;
  await activate(db, { relationshipId, actor: { kind: "user", id: recipient } });
  const accounts = await db
    .insertInto("ledger_account")
    .values([
      { code: "http_debit", currency: "USD", type: "asset" },
      { code: "http_credit", currency: "USD", type: "liability" },
    ])
    .returning("id")
    .execute();
  const [a, b] = accounts;
  if (a === undefined || b === undefined) throw new Error("Missing accounts");
  debit = a.id;
  credit = b.id;
  const identity = {
    authenticate: (token: string) => {
      const id = tokens.get(token);
      if (id === undefined) throw new Error("Invalid synthetic token");
      return Promise.resolve({ id, sessionId: randomUUID() });
    },
  } as Pick<IdentityService, "authenticate">;
  app = buildApp({
    demoApi: {
      db,
      identity: identity as IdentityService,
      postingFor: () =>
        Promise.resolve({ debitAccountId: debit, creditAccountId: credit, entryType: "transfer" }),
    },
  });
  await app.ready();
}, 180_000);
afterAll(async () => {
  await app.close();
  await server.stop();
});
const body = () => ({
  amount: { minor: "9007199254740993", currency: "USD" },
  categoryId: null,
  description: "Synthetic purpose",
});
async function submit() {
  const r = await app.inject({
    method: "POST",
    url: `/relationships/${relationshipId}/requests`,
    headers: headers(recipient),
    payload: body(),
  });
  expect(r.statusCode).toBe(201);
  return r.json<{ id: string }>().id;
}
it("denies strangers and wrong relationship roles before any write", async () => {
  for (const user of [stranger, sender]) {
    const r = await app.inject({
      method: "POST",
      url: `/relationships/${relationshipId}/requests`,
      headers: headers(user),
      payload: body(),
    });
    expect(r.statusCode).toBe(404);
  }
  const id = await submit();
  for (const suffix of ["", "/approve", "/decline"]) {
    const r = await app.inject({
      method: suffix === "" ? "GET" : "POST",
      url: `/relationships/${relationshipId}/requests/${id}${suffix}`,
      headers: headers(stranger),
      ...(suffix === "" ? {} : { payload: { reason: "private" } }),
    });
    expect(r.statusCode).toBe(404);
  }
  const selfApprove = await app.inject({
    method: "POST",
    url: `/relationships/${relationshipId}/requests/${id}/approve`,
    headers: headers(recipient),
    payload: {},
  });
  expect(selfApprove.statusCode).toBe(404);
});
it("preserves exact minor units and coalesces duplicate approvals into one posting", async () => {
  const id = await submit();
  const detail = await app.inject({
    method: "GET",
    url: `/relationships/${relationshipId}/requests/${id}`,
    headers: headers(sender),
  });
  expect(detail.json<{ amount: unknown }>().amount).toEqual(body().amount);
  const key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      app.inject({
        method: "POST",
        url: `/relationships/${relationshipId}/requests/${id}/approve`,
        headers: headers(sender, key),
        payload: {},
      }),
    ),
  );
  expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
  expect(new Set(results.map((r) => r.body)).size).toBe(1);
  const { rows } = await sql<{
    n: string;
  }>`select count(*)::text n from ledger_transaction where idempotency_key=${id}`.execute(db);
  expect(rows[0]?.n).toBe("1");
});
it("requires write keys and rejects float amounts and free-text validation without echo", async () => {
  const id = await submit();
  const missing = await app.inject({
    method: "POST",
    url: `/relationships/${relationshipId}/requests/${id}/approve`,
    headers: { authorization: headers(sender).authorization },
    payload: {},
  });
  expect(missing.statusCode).toBe(400);
  const secret = "PII-test-marker".repeat(30);
  const bad = await app.inject({
    method: "POST",
    url: `/relationships/${relationshipId}/requests/${id}/decline`,
    headers: headers(sender),
    payload: { reason: secret },
  });
  expect(bad.statusCode).toBe(400);
  expect(bad.body).not.toContain("PII-test-marker");
  const float = await app.inject({
    method: "POST",
    url: `/relationships/${relationshipId}/requests`,
    headers: headers(recipient),
    payload: { ...body(), amount: { minor: 1.25, currency: "USD" } },
  });
  expect(float.statusCode).toBe(400);
});
it("declines with no posting, and cannot smuggle a request from another relationship", async () => {
  const id = await submit();
  const denied = await app.inject({
    method: "GET",
    url: `/relationships/${randomUUID()}/requests/${id}`,
    headers: headers(sender),
  });
  expect(denied.statusCode).toBe(404);
  const result = await app.inject({
    method: "POST",
    url: `/relationships/${relationshipId}/requests/${id}/decline`,
    headers: headers(sender),
    payload: { reason: "Synthetic private reason" },
  });
  expect(result.statusCode).toBe(204);
  const row = await db
    .selectFrom("request")
    .select(["status", "decline_reason"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
  expect(row).toEqual({ status: "declined", decline_reason: "Synthetic private reason" });
  const tx = await db.selectFrom("transaction").select("id").where("request_id", "=", id).execute();
  expect(tx).toEqual([]);
});

it("publishes host policies and scrubs decline text in logs and span attributes", async () => {
  const health = await app.inject({ method: "GET", url: "/health" });
  expect(health.statusCode).toBe(200);
  const anonymous = await app.inject({
    method: "GET",
    url: `/relationships/${relationshipId}/requests`,
  });
  expect(anonymous.statusCode).toBe(401);
  expect(
    censorSensitiveKeys({ nested: { reason: "private marker", decline_reason: "private marker" } }),
  ).toEqual({ nested: { reason: CENSOR, decline_reason: CENSOR } });
  const captured: unknown[] = [];
  setSpanExporter((span) => captured.push(span));
  try {
    const span = startSpan("request.test");
    span.setAttribute("declineReason", "private marker");
    span.end();
    expect(JSON.stringify(captured)).not.toContain("private marker");
    expect(JSON.stringify(captured)).toContain(CENSOR);
  } finally {
    setSpanExporter(() => {});
  }
});
it("scopes screen lists and transaction detail, preserves state pairs, and paginates", async () => {
  const id = await submit();
  const approved = await app.inject({
    method: "POST",
    url: `/relationships/${relationshipId}/requests/${id}/approve`,
    headers: headers(sender),
    payload: {},
  });
  expect(approved.statusCode).toBe(200);
  const transactionId = approved.json<{ transactionId: string }>().transactionId;
  for (const path of ["relationships", "requests", "history"]) {
    const outsider = await app.inject({
      method: "GET",
      url: `/screen/${path}`,
      headers: headers(stranger),
    });
    expect(outsider.statusCode).toBe(200);
    expect(outsider.json<{ items: unknown[] }>().items).toEqual([]);
  }
  const details = await app.inject({
    method: "GET",
    url: `/screen/transactions/${transactionId}`,
    headers: headers(sender),
  });
  expect(details.statusCode).toBe(200);
  expect(details.json()).toMatchObject({
    id: transactionId,
    amount: body().amount,
    intentState: "committed",
    settlementState: "not_started",
  });
  const outsider = await app.inject({
    method: "GET",
    url: `/screen/transactions/${transactionId}`,
    headers: headers(stranger),
  });
  expect(outsider.statusCode).toBe(404);
  const page = await app.inject({
    method: "GET",
    url: "/screen/history?limit=1",
    headers: headers(sender),
  });
  const first = page.json<{ items: { id: string }[]; nextCursor: string }>();
  expect(first.items).toHaveLength(1);
  expect(first.nextCursor).toBeTypeOf("string");
  const next = await app.inject({
    method: "GET",
    url: `/screen/history?limit=1&before=${first.nextCursor}`,
    headers: headers(sender),
  });
  expect(next.json<{ items: { id: string }[] }>().items[0]?.id).not.toBe(first.items[0]?.id);
});
