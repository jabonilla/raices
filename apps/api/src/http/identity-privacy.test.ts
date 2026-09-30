import { performance } from "node:perf_hooks";
import Fastify from "fastify";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Database } from "../db/schema.js";
import { toApiError } from "../errors.js";
import { registerRateLimit } from "../hardening.js";
import { IdentityService } from "../identity/service.js";
import { findOrCreateUserByPhone } from "../relationships/users.js";
import { startTestPostgres, type TestPostgres } from "../../../../tests/pg.js";
import { registerIdentityRoutes } from "./identity.js";

let server: TestPostgres | undefined;
let db: Kysely<Database>;
const codes = new Map<string, string>();
const app = Fastify({ genReqId: () => "synthetic-fixed-test-request" });
const limiterScope = Fastify();
beforeAll(async () => {
  server = await startTestPostgres();
  db = server.kysely<Database>();
  const identity = new IdentityService(db, {
    pepper: "privacy-synthetic-pepper-at-least-32-bytes",
    policy: { requestPerIp: 1000, verifyPerIp: 1000 },
    deliver: (item) => {
      codes.set(item.challengeId, item.code);
      return Promise.resolve();
    },
  });
  app.setErrorHandler((error, request, reply) => {
    const mapped = toApiError(error, request.id);
    void reply.code(mapped.statusCode).send(mapped.body);
  });
  registerIdentityRoutes(app, {
    identity,
    clientIp: () => "192.0.2.40",
    rateLimitCheck: registerRateLimit(limiterScope, { max: 1000, windowMs: 60_000 }),
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await limiterScope.close();
  await server?.stop();
});

function median(values: number[]) {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
}
function auc(a: number[], b: number[]) {
  let score = 0;
  for (const x of a) for (const y of b) score += x > y ? 1 : x === y ? 0.5 : 0;
  return score / (a.length * b.length);
}
it("known and unknown phones have identical wrong-code responses and no coarse timing separation", async () => {
  const knownRequest: number[] = [],
    unknownRequest: number[] = [];
  const knownVerify: number[] = [],
    unknownVerify: number[] = [];
  let expectedBody: string | undefined;
  // Independent phones avoid accumulating lockouts. Interleave order and omit
  // warmup pairs. This is a coarse local regression bound, not a network proof.
  for (let i = 0; i < 70; i++) {
    const phones = {
      known: `+155560${i.toString().padStart(5, "0")}`,
      unknown: `+155570${i.toString().padStart(5, "0")}`,
    };
    await findOrCreateUserByPhone(db, { phone: phones.known, role: "sender" });
    for (const kind of i % 2 === 0
      ? (["known", "unknown"] as const)
      : (["unknown", "known"] as const)) {
      const start = performance.now();
      const requested = await app.inject({
        method: "POST",
        url: "/auth/otp/request",
        payload: { phone: phones[kind] },
      });
      const requestMs = performance.now() - start;
      expect(requested.statusCode).toBe(202);
      const body = requested.json<{ challengeId: string }>();
      expect(Object.keys(body)).toEqual(["challengeId"]);
      expect(body.challengeId).toMatch(/^[0-9a-f-]{36}$/);
      const code = codes.get(body.challengeId);
      if (code === undefined) throw new Error("Missing synthetic delivery");
      const verifyStart = performance.now();
      const denied = await app.inject({
        method: "POST",
        url: "/auth/otp/verify",
        payload: { challengeId: body.challengeId, code: code === "000000" ? "111111" : "000000" },
      });
      const verifyMs = performance.now() - verifyStart;
      expect(denied.statusCode).toBe(401);
      expectedBody ??= denied.body;
      expect(denied.body).toBe(expectedBody);
      if (i >= 10) {
        (kind === "known" ? knownRequest : unknownRequest).push(requestMs);
        (kind === "known" ? knownVerify : unknownVerify).push(verifyMs);
      }
    }
  }
  for (const [name, a, b] of [
    ["request", knownRequest, unknownRequest],
    ["wrongCode", knownVerify, unknownVerify],
  ] as const) {
    const ratio = median(a) / median(b);
    const rankProbability = auc(a, b);
    process.stdout.write(
      `PHONE_PRIVACY ${JSON.stringify({ name, n: a.length, knownMedianMs: median(a), unknownMedianMs: median(b), ratio, rankProbability })}\n`,
    );
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
    expect(rankProbability).toBeGreaterThan(0.2);
    expect(rankProbability).toBeLessThan(0.8);
  }
});
