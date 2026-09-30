import Fastify from "fastify";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Database } from "../db/schema.js";
import { registerRateLimit } from "../hardening.js";
import { toApiError } from "../errors.js";
import { IdentityService } from "../identity/service.js";
import { startTestPostgres, type TestPostgres } from "../../../../tests/pg.js";
import { registerIdentityRoutes } from "./identity.js";

let server: TestPostgres;
let db: Kysely<Database>;
const delivered: { code: string; challengeId: string }[] = [];
const app = Fastify();
beforeAll(async () => {
  server = await startTestPostgres();
  db = server.kysely<Database>();
  const identity = new IdentityService(db, {
    pepper: "test-only-synthetic-pepper-with-32-bytes",
    deliver: (item) => {
      delivered.push(item);
      return Promise.resolve();
    },
  });
  app.setErrorHandler((error, request, reply) => {
    const mapped = toApiError(error, request.id);
    void reply.code(mapped.statusCode).send(mapped.body);
  });
  registerIdentityRoutes(app, {
    identity,
    rateLimitCheck: registerRateLimit(app, { max: 600, windowMs: 60_000 }),
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await server.stop();
});

it("validates OTP boundary, never returns code, and requires bearer for revoke", async () => {
  const invalid = await app.inject({
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    url: "/auth/otp/request",
    payload: { phone: "invalid" },
  });
  expect(invalid.statusCode).toBe(400);
  const request = await app.inject({
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    url: "/auth/otp/request",
    payload: { phone: "+15551100001" },
  });
  expect(request.statusCode).toBe(202);
  expect(request.headers["cache-control"]).toBe("no-store");
  const body = request.json<{ challengeId: string }>();
  expect(Object.keys(body)).toEqual(["challengeId"]);
  const code = delivered.find((item) => item.challengeId === body.challengeId)?.code;
  if (code === undefined) throw new Error("Missing fake code");
  const verification = await app.inject({
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    url: "/auth/otp/verify",
    payload: { challengeId: body.challengeId, code },
  });
  expect(verification.statusCode).toBe(200);
  const session = verification.json<{ token: string }>();
  const unauthorized = await app.inject({ method: "POST", url: "/auth/session/revoke" });
  expect(unauthorized.statusCode).toBe(401);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/auth/session/revoke",
        headers: {
          authorization: `Bearer ${session.token}`,
          "idempotency-key": crypto.randomUUID(),
        },
      })
    ).statusCode,
  ).toBe(204);
});
