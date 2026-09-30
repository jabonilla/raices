import Fastify from "fastify";
import type { Kysely } from "kysely";
import { afterEach, expect, it, vi } from "vitest";
import type { Database } from "../db/schema.js";
import { toApiError } from "../errors.js";
import { registerRateLimit } from "../hardening.js";
import { IdentityService } from "../identity/service.js";
import { registerIdentityRoutes } from "./identity.js";

afterEach(() => vi.unstubAllEnvs());
function service() {
  return new IdentityService({} as Kysely<Database>, {
    pepper: "test-synthetic-pepper-at-least-32-bytes",
    deliver: () => Promise.resolve(),
  });
}
it("refuses production registration without a trusted client IP resolver", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const app = Fastify();
  expect(() => {
    registerIdentityRoutes(app, {
      identity: service(),
      rateLimitCheck: async () => {},
    });
  }).toThrow(/clientIp/);
  await app.close();
});
it("refuses registration without the outer limiter even outside production", async () => {
  const app = Fastify();
  // A JS caller can bypass TypeScript: the runtime guard must still bite.
  expect(() => {
    registerIdentityRoutes(app, { identity: service() } as never);
  }).toThrow(/rateLimitCheck/);
  await app.close();
});
it.each(["/auth/otp/request", "/auth/otp/verify", "/auth/session/revoke"])(
  "rejects floods on %s before parsing or calling identity, ignoring forwarded headers",
  async (url) => {
    const app = Fastify({ trustProxy: true });
    const limiterScope = Fastify();
    const check = registerRateLimit(limiterScope, { max: 2, windowMs: 60_000 });
    const identity = service();
    const requestCode = vi
      .spyOn(identity, "requestCode")
      .mockResolvedValue({ challengeId: crypto.randomUUID() });
    const verifyCode = vi
      .spyOn(identity, "verifyCode")
      .mockRejectedValue(new Error("unexpected call"));
    const revoke = vi.spyOn(identity, "revoke").mockResolvedValue();
    app.setErrorHandler((error, request, reply) => {
      const mapped = toApiError(error, request.id);
      void reply.code(mapped.statusCode).send(mapped.body);
    });
    registerIdentityRoutes(app, { identity, rateLimitCheck: check, clientIp: () => "192.0.2.10" });
    try {
      for (let i = 0; i < 3; i++) {
        const result = await app.inject({
          method: "POST",
          url,
          headers: { "x-forwarded-for": `198.51.100.${i.toString()}` },
          payload: {},
        });
        expect(result.statusCode).toBe(i < 2 ? (url.endsWith("revoke") ? 401 : 400) : 429);
        expect(result.headers["cache-control"]).toBe("no-store");
        if (i === 2) expect(result.headers["retry-after"]).toBeDefined();
      }
      expect(requestCode).not.toHaveBeenCalled();
      expect(verifyCode).not.toHaveBeenCalled();
      expect(revoke).not.toHaveBeenCalled();
    } finally {
      await app.close();
      await limiterScope.close();
    }
  },
);
