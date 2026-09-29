import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import Fastify from "fastify";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Database } from "../db/schema.js";
import { toApiError } from "../errors.js";
import { IdentityService } from "../identity/service.js";
import { findOrCreateUserByPhone } from "../relationships/users.js";
import { startTestPostgres, type TestPostgres } from "../../../../tests/pg.js";
import { registerIdentityRoutes } from "./identity.js";
import { registerRelationshipRoutes } from "./relationships.js";
import { InviteLimiter } from "./invite-limit.js";
import { PostgresReceiptStore } from "./idempotency.js";

let server: TestPostgres;
let db: Kysely<Database>;
let identity: IdentityService;
const codes = new Map<string, string>();
const app = Fastify({ trustProxy: true });
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
    pepper: "abuse-synthetic-pepper-at-least-32-bytes",
    policy: { requestPerPhone: 100, requestPerIp: 1000, verifyPerPhone: 100, verifyPerIp: 1000 },
    deliver: (item) => {
      codes.set(item.challengeId, item.code);
      return Promise.resolve();
    },
  });
  app.setErrorHandler((error, request, reply) => {
    const mapped = toApiError(error, request.id);
    void reply.code(mapped.statusCode).send(mapped.body);
  });
  registerIdentityRoutes(app, { identity });
  registerRelationshipRoutes(app, {
    db,
    identity,
    inviteLimiter: new InviteLimiter(db, "abuse-invite-pepper-at-least-32-bytes", 1000, 1000),
    receipts: new PostgresReceiptStore(db, "abuse-receipt-pepper-at-least-32-bytes"),
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await server.stop();
});
function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    p50: sorted[Math.floor(sorted.length / 2)] ?? 0,
    p99: sorted[Math.max(0, Math.ceil(sorted.length * 0.99) - 1)] ?? 0,
  };
}
function probabilitySlower(a: number[], b: number[]) {
  let score = 0;
  for (const x of a) for (const y of b) score += x > y ? 1 : x === y ? 0.5 : 0;
  return score / (a.length * b.length);
}

it("returns identical registration-independent OTP/invite contracts and measures timing", async () => {
  const senderCode = await identity.requestCode({ phone: "+15553000001", ip: "192.0.2.1" });
  const otp = codes.get(senderCode.challengeId);
  if (otp === undefined) throw new Error("Missing code");
  const sender = await identity.verifyCode({
    challengeId: senderCode.challengeId,
    code: otp,
    ip: "192.0.2.1",
  });
  const timings: Record<string, number[]> = {
    otpKnown: [],
    otpNew: [],
    inviteKnown: [],
    inviteNew: [],
  };
  const observations: {
    otpCode: number;
    otpKeys: string[];
    inviteCode: number;
    inviteKeys: string[];
  }[] = [];
  for (let index = 0; index < 40; index += 1) {
    const known = `+50253${index.toString().padStart(6, "0")}`;
    const unseen = `+50254${index.toString().padStart(6, "0")}`;
    await findOrCreateUserByPhone(db, { phone: known, role: "recipient" });
    // Alternate ordering to avoid a fixed warm-up/order advantage.
    for (const kind of index % 2 === 0
      ? (["Known", "New"] as const)
      : (["New", "Known"] as const)) {
      const phone = kind === "Known" ? known : unseen;
      let start = performance.now();
      const requested = await app.inject({
        method: "POST",
        url: "/auth/otp/request",
        payload: { phone },
      });
      const otpMs = performance.now() - start;
      timings[`otp${kind}`]?.push(otpMs);
      start = performance.now();
      const invitation = await app.inject({
        method: "POST",
        url: "/relationships/invite",
        headers: {
          authorization: `Bearer ${sender.token}`,
          "idempotency-key": crypto.randomUUID(),
        },
        payload: { phone },
      });
      const inviteMs = performance.now() - start;
      timings[`invite${kind}`]?.push(inviteMs);
      const observation = {
        otpCode: requested.statusCode,
        otpKeys: Object.keys(requested.json<Record<string, unknown>>()),
        inviteCode: invitation.statusCode,
        inviteKeys: Object.keys(invitation.json<Record<string, unknown>>()),
      };
      expect(observation).toEqual({
        otpCode: 202,
        otpKeys: ["challengeId"],
        inviteCode: 201,
        inviteKeys: ["id"],
      });
      observations.push(observation);
    }
  }
  expect(observations).toHaveLength(80);
  // Measurements are evidence, not a claim of timing indistinguishability.
  // The helper exercises real DB work; no sleep is added to disguise paths.
  process.stdout.write(
    "ABUSE_TIMING " +
      JSON.stringify({
        otpKnown: summary(timings["otpKnown"] ?? []),
        otpNew: summary(timings["otpNew"] ?? []),
        inviteKnown: summary(timings["inviteKnown"] ?? []),
        inviteNew: summary(timings["inviteNew"] ?? []),
        otpProbabilityKnownSlower: probabilitySlower(
          timings["otpKnown"] ?? [],
          timings["otpNew"] ?? [],
        ),
        inviteProbabilityKnownSlower: probabilitySlower(
          timings["inviteKnown"] ?? [],
          timings["inviteNew"] ?? [],
        ),
      }) +
      "\n",
  );
});

it("uses indistinguishable verification denial envelopes for wrong, missing and expired proof", async () => {
  const challenge = await identity.requestCode({ phone: "+15553000002", ip: "192.0.2.2" });
  const actual = codes.get(challenge.challengeId);
  if (actual === undefined) throw new Error("Missing code");
  const wrong = actual === "000000" ? "111111" : "000000";
  const probes = [
    { challengeId: challenge.challengeId, code: wrong },
    { challengeId: crypto.randomUUID(), code: wrong },
  ];
  probes.push({ challengeId: challenge.challengeId, code: actual });
  for (const payload of probes) {
    if (payload.code === actual && payload.challengeId === challenge.challengeId) {
      await sql`update identity_challenge set expires_at=created_at where id=${challenge.challengeId}`.execute(
        db,
      );
    }
    const result = await app.inject({ method: "POST", url: "/auth/otp/verify", payload });
    expect(result.statusCode).toBe(401);
    const body = result.json<{ error: { code: string; message: string; requestId: string } }>();
    expect(body.error.code).toBe("unauthorized");
    expect(body.error.message).toBe("Authentication required.");
  }
});

it("cannot rotate forwarded IP headers to evade persistent OTP request/verify caps", async () => {
  const capped = Fastify({ trustProxy: true });
  capped.setErrorHandler((error, request, reply) => {
    const mapped = toApiError(error, request.id);
    void reply.code(mapped.statusCode).send(mapped.body);
  });
  const service = new IdentityService(db, {
    pepper: "abuse-ip-cap-pepper-at-least-32-bytes",
    policy: { requestPerIp: 2, verifyPerIp: 2 },
    deliver: () => Promise.resolve(),
  });
  registerIdentityRoutes(capped, { identity: service });
  try {
    for (let index = 0; index < 3; index += 1) {
      const headers = { "x-forwarded-for": `203.0.113.${index.toString()}` };
      const request = await capped.inject({
        method: "POST",
        url: "/auth/otp/request",
        headers,
        payload: { phone: `+1555300001${index.toString()}` },
      });
      expect(request.statusCode).toBe(index < 2 ? 202 : 429);
      const verify = await capped.inject({
        method: "POST",
        url: "/auth/otp/verify",
        headers,
        payload: { challengeId: crypto.randomUUID(), code: "000000" },
      });
      expect(verify.statusCode).toBe(index < 2 ? 401 : 429);
    }
  } finally {
    await capped.close();
  }
});

it("rate-limits invite spam before creating a recipient even when forwarded IP changes", async () => {
  const requested = await identity.requestCode({ phone: "+15553000003", ip: "192.0.2.3" });
  const code = codes.get(requested.challengeId);
  if (code === undefined) throw new Error("Missing code");
  const sender = await identity.verifyCode({
    challengeId: requested.challengeId,
    code,
    ip: "192.0.2.3",
  });
  const capped = Fastify({ trustProxy: true });
  capped.setErrorHandler((error, request, reply) => {
    const mapped = toApiError(error, request.id);
    void reply.code(mapped.statusCode).send(mapped.body);
  });
  registerRelationshipRoutes(capped, {
    db,
    identity,
    inviteLimiter: new InviteLimiter(db, "abuse-invite-cap-pepper-at-least-32-bytes", 100, 2),
    receipts: new PostgresReceiptStore(db, "abuse-invite-receipt-pepper-32-bytes"),
  });
  try {
    for (let index = 0; index < 3; index += 1) {
      const result = await capped.inject({
        method: "POST",
        url: "/relationships/invite",
        headers: {
          authorization: `Bearer ${sender.token}`,
          "idempotency-key": crypto.randomUUID(),
          "x-forwarded-for": `198.51.100.${index.toString()}`,
        },
        payload: { phone: `+5025500000${index.toString()}` },
      });
      expect(result.statusCode).toBe(index < 2 ? 201 : 429);
    }
    expect(
      await db
        .selectFrom("app_user")
        .select("id")
        .where("phone", "=", "+50255000002")
        .executeTakeFirst(),
    ).toBeUndefined();
  } finally {
    await capped.close();
  }
});
