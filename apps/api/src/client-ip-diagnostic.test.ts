import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { registerClientIpDiagnostic } from "./client-ip-diagnostic.js";

const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("K3.21 client IP diagnostic", () => {
  const salt = "a-long-random-secret-for-isolated-diagnostic-tests";

  it("is absent by default", async () => {
    const app = Fastify();
    apps.push(app);
    registerClientIpDiagnostic(app, {});
    const response = await app.inject("/__diagnostics/client-ip");
    expect(response.statusCode).toBe(404);
  });

  it("fails closed when enabled in production", () => {
    const app = Fastify();
    apps.push(app);
    expect(() =>
      registerClientIpDiagnostic(app, {
        RAICES_ENV: "production",
        K3_IP_DIAGNOSTIC_ENABLED: "true",
        DIAGNOSTIC_IP_SALT: salt,
      }),
    ).toThrow(/forbidden/);
  });

  it("omits route without salt", () => {
    const app = Fastify();
    apps.push(app);
    expect(() =>
      registerClientIpDiagnostic(app, {
        RAICES_ENV: "staging",
      }),
    ).not.toThrow();
  });

  it("returns a stable salted hash, never a raw IP", async () => {
    const app = Fastify({ trustProxy: true });
    apps.push(app);
    registerClientIpDiagnostic(app, {
      RAICES_ENV: "staging",
      DIAGNOSTIC_IP_SALT: salt,
    });
    const a = await app.inject({
      url: "/__diagnostics/client-ip",
      headers: { "x-forwarded-for": "198.51.100.10" },
    });
    const b = await app.inject({
      url: "/__diagnostics/client-ip",
      headers: { "x-forwarded-for": "198.51.100.10" },
    });
    const c = await app.inject({
      url: "/__diagnostics/client-ip",
      headers: { "x-forwarded-for": "198.51.100.11" },
    });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toEqual({
      clientIpHash: createHmac("sha256", salt).update("198.51.100.10").digest("hex"),
    });
    expect(a.body).toBe(b.body);
    expect(a.body).not.toBe(c.body);
    expect(a.body).not.toContain("198.51.100.10");
    expect(a.headers["cache-control"]).toBe("no-store");
  });
});
