import { expect, it } from "vitest";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.js";
import { IdentityService } from "../identity/service.js";
import { buildApp } from "../app.js";

it("counts each demo auth attempt once with the vetted IP", async () => {
  const db = {} as Kysely<Database>;
  const identity = new IdentityService(db, {
    pepper: "synthetic-host-limiter-pepper-32-bytes",
    deliver: () => Promise.resolve(),
  });
  const app = buildApp({
    rateLimitMax: 2,
    demoApi: { db, identity, clientIp: () => "127.0.0.1" },
  });
  try {
    for (const expected of [400, 400, 429]) {
      const r = await app.inject({
        method: "POST",
        url: "/auth/otp/request",
        headers: {
          "idempotency-key": crypto.randomUUID(),
        },
        payload: {},
      });
      expect(r.statusCode).toBe(expected);
    }
  } finally {
    await app.close();
  }
});
