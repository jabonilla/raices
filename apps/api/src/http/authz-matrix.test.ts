import { readFile } from "node:fs/promises";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "../app.js";
import type { Database } from "../db/schema.js";
import { IdentityService } from "../identity/service.js";
import { invite } from "../relationships/relationships.js";
import { startTestPostgres, type TestPostgres } from "../../../../tests/pg.js";
import { registerIdentityRoutes } from "./identity.js";
import { registerRelationshipRoutes } from "./relationships.js";
import { InviteLimiter } from "./invite-limit.js";
import { PostgresReceiptStore } from "./idempotency.js";

let server: TestPostgres;
let db: Kysely<Database>;
let identity: IdentityService;
const app = buildApp();
const codes = new Map<string, string>();
const principals: Record<string, { token: string; userId: string }> = {};
let relationshipId: string;
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
    pepper: "matrix-synthetic-pepper-at-least-32-bytes",
    deliver: (item) => {
      codes.set(item.challengeId, item.code);
      return Promise.resolve();
    },
  });
  for (const [index, name] of ["member", "recipient", "outsider", "expired", "revoked"].entries()) {
    const phone = `+1555200000${index.toString()}`;
    const requested = await identity.requestCode({ phone, ip: `192.0.2.${index.toString()}` });
    const code = codes.get(requested.challengeId);
    if (code === undefined) throw new Error("Missing code");
    principals[name] = await identity.verifyCode({
      challengeId: requested.challengeId,
      code,
      ip: `192.0.2.${index.toString()}`,
    });
  }
  const member = principals["member"];
  const recipient = principals["recipient"];
  const expired = principals["expired"];
  const revoked = principals["revoked"];
  if (
    member === undefined ||
    recipient === undefined ||
    expired === undefined ||
    revoked === undefined
  )
    throw new Error("Missing fixtures");
  principals["superseded"] = member;
  const requested = await identity.requestCode({ phone: "+15552000000", ip: "192.0.2.6" });
  const code = codes.get(requested.challengeId);
  if (code === undefined) throw new Error("Missing code");
  principals["member"] = await identity.verifyCode({
    challengeId: requested.challengeId,
    code,
    ip: "192.0.2.6",
  });
  await sql`update identity_session set expires_at=created_at where token_hash=${identity.tokenHash(expired.token)}`.execute(
    db,
  );
  await identity.revoke(revoked.token);
  relationshipId = (await invite(db, { senderId: member.userId, recipientId: recipient.userId }))
    .id;
  registerIdentityRoutes(app, { identity });
  registerRelationshipRoutes(app, {
    db,
    identity,
    inviteLimiter: new InviteLimiter(db, "matrix-invite-pepper-at-least-32-bytes"),
    receipts: new PostgresReceiptStore(db, "matrix-receipt-pepper-at-least-32-bytes"),
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await server.stop();
});

it("denies missing, malformed, expired, revoked and superseded credentials on every private route", async () => {
  const targets = [
    { method: "GET" as const, url: "/relationships" },
    { method: "HEAD" as const, url: "/relationships" },
    { method: "GET" as const, url: `/relationships/${relationshipId}` },
    { method: "HEAD" as const, url: `/relationships/${relationshipId}` },
    { method: "POST" as const, url: "/relationships/invite" },
    ...(["accept", "pause", "terminate"] as const).map((action) => ({
      method: "POST" as const,
      url: `/relationships/${relationshipId}/${action}`,
    })),
    { method: "POST" as const, url: "/auth/session/revoke" },
  ];
  const invalid = [
    undefined,
    "Bearer bad",
    ...(["expired", "revoked", "superseded"] as const).map(
      (name) => `Bearer ${principals[name]?.token ?? "missing"}`,
    ),
  ];
  for (const target of targets)
    for (const authorization of invalid) {
      const result = await app.inject({
        ...target,
        headers: {
          ...(authorization === undefined ? {} : { authorization }),
          "idempotency-key": crypto.randomUUID(),
        },
        ...(target.method === "POST"
          ? { payload: target.url.endsWith("invite") ? { phone: "+50252000009" } : {} }
          : {}),
      });
      expect(result.statusCode, `${target.method} ${target.url}`).toBe(401);
      if (target.method !== "HEAD")
        expect(result.json<{ error: { code: string } }>().error.code).toBe("unauthorized");
    }
});

it("denies a valid wrong-family session on read and every relationship mutation without side effects", async () => {
  const outsider = principals["outsider"];
  if (outsider === undefined) throw new Error("Missing outsider");
  const before = await db
    .selectFrom("audit_log")
    .select("id")
    .where("entity_id", "=", relationshipId)
    .execute();
  for (const action of ["read", "accept", "pause", "terminate"] as const) {
    const result = await app.inject({
      method: action === "read" ? "GET" : "POST",
      url: `/relationships/${relationshipId}${action === "read" ? "" : `/${action}`}`,
      headers: {
        authorization: `Bearer ${outsider.token}`,
        "idempotency-key": crypto.randomUUID(),
      },
      ...(action === "read" ? {} : { payload: {} }),
    });
    expect(result.statusCode).toBe(404);
  }
  const row = await db
    .selectFrom("relationship")
    .select("status")
    .where("id", "=", relationshipId)
    .executeTakeFirstOrThrow();
  expect(row.status).toBe("invited");
  expect(
    await db.selectFrom("audit_log").select("id").where("entity_id", "=", relationshipId).execute(),
  ).toEqual(before);
});

it("preserves intentionally public diagnostic and OTP boundaries", async () => {
  expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  expect((await app.inject({ method: "GET", url: "/openapi.json" })).statusCode).toBe(200);
  const ready = await app.inject({ method: "GET", url: "/ready" });
  expect([200, 503]).toContain(ready.statusCode);
  expect(Object.keys(ready.json<Record<string, unknown>>())).toEqual(["ok"]);
  for (const url of ["/auth/otp/request", "/auth/otp/verify"]) {
    const result = await app.inject({ method: "POST", url, payload: {} });
    expect(result.statusCode).toBe(400);
    expect(result.json<{ error: { code: string } }>().error.code).toBe("invalid_request");
  }
});

it("enforces the new webhook skeleton signature and payload boundaries", async () => {
  for (const signature of [undefined, "invalid"]) {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/channel",
      headers: signature === undefined ? {} : { "x-webhook-signature": signature },
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("unauthorized");
  }
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/webhooks/channel",
        headers: { "x-webhook-signature": "test-signature" },
        payload: [],
      })
    ).statusCode,
  ).toBe(400);
  // This documents the default fake's boundary; it is not provider authentication.
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/webhooks/channel",
        headers: { "x-webhook-signature": "test-signature" },
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
});
