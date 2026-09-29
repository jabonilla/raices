import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Database } from "../db/schema.js";
import { toApiError } from "../errors.js";
import { IdentityService } from "../identity/service.js";
import { findOrCreateUserByPhone } from "../relationships/users.js";
import { startTestPostgres, type TestPostgres } from "../../../../tests/pg.js";
import { registerRelationshipRoutes } from "./relationships.js";
import { PostgresReceiptStore } from "./idempotency.js";
import { InviteLimiter } from "./invite-limit.js";
import { buildHttpOpenApiDocument } from "./document.js";

let server: TestPostgres;
let db: Kysely<Database>;
let identity: IdentityService;
let sender: { token: string; userId: string };
let recipient: { token: string; userId: string };
let outsider: { token: string; userId: string };
const delivery = new Map<string, string>();
const app = Fastify();
beforeAll(async () => {
  server = await startTestPostgres();
  db = server.kysely<Database>();
  await sql
    .raw(
      await readFile(
        new URL("../../../../docs/http-idempotency-proposal.sql", import.meta.url),
        "utf8",
      ),
    )
    .execute(db);
  identity = new IdentityService(db, {
    pepper: "synthetic-test-pepper-32-bytes-minimum",
    deliver: (item) => {
      delivery.set(item.challengeId, item.code);
      return Promise.resolve();
    },
  });
  async function login(phone: string, ip: string) {
    const requested = await identity.requestCode({ phone, ip });
    const code = delivery.get(requested.challengeId);
    if (code === undefined) throw new Error("Missing delivery");
    return identity.verifyCode({ challengeId: requested.challengeId, code, ip });
  }
  sender = await login("+15551200001", "127.0.0.1");
  recipient = await login("+50251200002", "127.0.0.2");
  outsider = await login("+15551200003", "127.0.0.3");
  await findOrCreateUserByPhone(db, { phone: "+50251200002", role: "recipient" });
  app.setErrorHandler((error, request, reply) => {
    const mapped = toApiError(error, request.id);
    void reply.code(mapped.statusCode).send(mapped.body);
  });
  registerRelationshipRoutes(app, {
    db,
    identity,
    receipts: new PostgresReceiptStore(db, "test-receipt-pepper-32-bytes-minimum"),
    inviteLimiter: new InviteLimiter(db, "test-limit-pepper-32-bytes-minimum", 100, 100),
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await server.stop();
});
function headers(token: string, key = crypto.randomUUID()) {
  return { authorization: `Bearer ${token}`, "idempotency-key": key };
}
async function invitation() {
  const result = await app.inject({
    method: "POST",
    url: "/relationships/invite",
    headers: headers(sender.token),
    payload: { phone: "+50251200002" },
  });
  expect(result.statusCode).toBe(201);
  return result.json<{ id: string }>().id;
}

it("denies another family's read and every action and derives list membership", async () => {
  const id = await invitation();
  for (const url of [
    `/relationships/${id}`,
    `/relationships/${id}/accept`,
    `/relationships/${id}/pause`,
    `/relationships/${id}/terminate`,
  ]) {
    const result = await app.inject({
      method: url.endsWith(id) ? "GET" : "POST",
      url,
      headers: headers(outsider.token),
      ...(url.endsWith(id) ? {} : { payload: {} }),
    });
    expect(result.statusCode).toBe(404);
  }
  const list = await app.inject({
    method: "GET",
    url: "/relationships",
    headers: headers(outsider.token),
  });
  expect(list.json()).toEqual([]);
  const own = await app.inject({
    method: "GET",
    url: "/relationships",
    headers: headers(sender.token),
  });
  expect(own.json<{ id: string }[]>().map((row) => row.id)).toContain(id);
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/relationships/${id}/accept`,
        headers: headers(sender.token),
        payload: {},
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/relationships/${id}/accept`,
        headers: headers(recipient.token),
        payload: { actor: { id: outsider.userId } },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/relationships/${id}/accept`,
        headers: headers(recipient.token),
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  const row = await db
    .selectFrom("relationship")
    .select("status")
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
  expect(row.status).toBe("active");
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/relationships/${id}/pause`,
        headers: headers(sender.token),
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/relationships/${id}/terminate`,
        headers: headers(recipient.token),
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
});

it("replays completed writes, rejects changed payload/key reuse and isolates keys by actor", async () => {
  const key = crypto.randomUUID();
  const opts = {
    method: "POST" as const,
    url: "/relationships/invite",
    headers: headers(sender.token, key),
    payload: { phone: "+50251200002" },
  };
  const first = await app.inject(opts);
  expect(first.statusCode).toBe(201);
  const second = await app.inject(opts);
  expect(second.statusCode).toBe(201);
  expect(second.json()).toEqual(first.json());
  expect((await app.inject({ ...opts, payload: { phone: "+50251200004" } })).statusCode).toBe(409);
  expect(
    (
      await app.inject({
        ...opts,
        headers: headers(outsider.token, key),
        payload: { phone: "+50251200004" },
      })
    ).statusCode,
  ).toBe(201);
});

it("requires idempotency and fails closed before mutation without a durable store", async () => {
  const noKey = await app.inject({
    method: "POST",
    url: "/relationships/invite",
    headers: { authorization: `Bearer ${sender.token}` },
    payload: { phone: "+50251200005" },
  });
  expect(noKey.statusCode).toBe(400);
  const closed = Fastify();
  closed.setErrorHandler((error, request, reply) => {
    const mapped = toApiError(error, request.id);
    void reply.code(mapped.statusCode).send(mapped.body);
  });
  registerRelationshipRoutes(closed, {
    db,
    identity,
    inviteLimiter: new InviteLimiter(db, "synthetic-limit-pepper-32-bytes-minimum"),
  });
  try {
    const result = await closed.inject({
      method: "POST",
      url: "/relationships/invite",
      headers: headers(sender.token),
      payload: { phone: "+50251200005" },
    });
    expect(result.statusCode).toBe(503);
    expect(
      await db
        .selectFrom("app_user")
        .select("id")
        .where("phone", "=", "+50251200005")
        .executeTakeFirst(),
    ).toBeUndefined();
  } finally {
    await closed.close();
  }
});

it("generates route contracts from the runtime Zod schemas", () => {
  const spec = buildHttpOpenApiDocument();
  for (const path of [
    "/auth/otp/request",
    "/auth/otp/verify",
    "/auth/session/revoke",
    "/relationships",
    "/relationships/{id}",
    "/relationships/invite",
    "/relationships/{id}/accept",
    "/relationships/{id}/pause",
    "/relationships/{id}/terminate",
  ])
    expect(spec.paths).toHaveProperty(path);
  expect(JSON.stringify(spec.paths["/relationships/invite"])).toContain("idempotency-key");
  expect(JSON.stringify(spec.paths["/relationships/invite"])).toContain("displayName");
});

it("admits one writer across two receipt adapters and never retries an ambiguous write", async () => {
  const one = new PostgresReceiptStore(db, "synthetic-shared-receipt-pepper-32-bytes");
  const two = new PostgresReceiptStore(db, "synthetic-shared-receipt-pepper-32-bytes");
  const input = { actorId: sender.userId, key: crypto.randomUUID(), requestHash: "a".repeat(64) };
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let admitted!: () => void;
  const admission = new Promise<void>((resolve) => {
    admitted = resolve;
  });
  let writes = 0;
  const pending = one.run(input, async () => {
    writes += 1;
    admitted();
    await gate;
    return { id: "synthetic-result" };
  });
  try {
    await admission;
    await expect(
      two.run(input, () => {
        writes += 1;
        return Promise.resolve({ id: "duplicate" });
      }),
    ).rejects.toMatchObject({ statusCode: 503 });
    open();
    await pending;
    expect(
      await two.run(input, () => {
        writes += 1;
        return Promise.resolve({ id: "duplicate" });
      }),
    ).toEqual({ id: "synthetic-result" });
    expect(writes).toBe(1);
  } finally {
    open();
    await pending;
  }
  const ambiguous = { ...input, key: crypto.randomUUID() };
  await expect(
    one.run(ambiguous, () => Promise.reject(new Error("synthetic unknown commit outcome"))),
  ).rejects.toMatchObject({ statusCode: 503 });
  await expect(
    two.run(ambiguous, () => {
      writes += 1;
      return Promise.resolve({ id: "duplicate" });
    }),
  ).rejects.toMatchObject({ statusCode: 503 });
  expect(writes).toBe(1);
});
