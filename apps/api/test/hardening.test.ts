import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp, MAX_JSON_BODY_BYTES } from "../src/app.js";

const app = buildApp();
const limitedApp = buildApp({ rateLimitMax: 3, rateLimitWindowMs: 60_000 });
const resettingApp = buildApp({ rateLimitMax: 2, rateLimitWindowMs: 200 });

for (const instance of [limitedApp, resettingApp]) {
  instance.get("/ping", () => ({ pong: true }));
}
app.post("/echo", (request) => ({ got: request.body }));

beforeAll(async () => {
  await app.ready();
  await limitedApp.ready();
  await resettingApp.ready();
});

afterAll(async () => {
  await app.close();
  await limitedApp.close();
  await resettingApp.close();
});

describe("security headers", () => {
  it("sets hardening headers on every response", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(response.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(response.headers["x-dns-prefetch-control"]).toBe("off");
  });

  it("sets the same headers on error responses", async () => {
    const response = await app.inject({ method: "GET", url: "/no-such-route" });
    expect(response.statusCode).toBe(404);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("body size limits", () => {
  it("rejects a JSON body larger than the limit with 413", async () => {
    const oversized = "x".repeat(MAX_JSON_BODY_BYTES + 1);
    const response = await app.inject({
      method: "POST",
      url: "/echo",
      payload: JSON.stringify({ data: oversized }),
      headers: { "content-type": "application/json" },
    });
    expect(response.statusCode).toBe(413);
    const body = response.json<{
      error: { code: string; message: string; requestId: string };
    }>();
    expect(body.error.code).toBe("bad_request");
    expect(typeof body.error.requestId).toBe("string");
  });

  it("accepts a JSON body just under the limit", async () => {
    // /health is GET-only; use a POST against a 404 route: the body parser
    // still runs before routing fails, so a too-large body would 413 first.
    const under = "x".repeat(1024);
    const response = await app.inject({
      method: "POST",
      url: "/no-such-route",
      payload: JSON.stringify({ data: under }),
      headers: { "content-type": "application/json" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("rate limiting", () => {
  it("rejects requests past the per-IP budget with a 429 envelope", async () => {
    const ip = "10.9.9.1";
    for (let i = 0; i < 3; i++) {
      const ok = await limitedApp.inject({
        method: "GET",
        url: "/ping",
        headers: { "x-forwarded-for": ip },
      });
      expect(ok.statusCode).toBe(200);
    }
    const limited = await limitedApp.inject({
      method: "GET",
      url: "/ping",
      headers: { "x-forwarded-for": ip },
    });
    expect(limited.statusCode).toBe(429);
    const body = limited.json<{
      error: { code: string; message: string; requestId: string };
    }>();
    expect(body.error.code).toBe("rate_limited");
    expect(limited.headers["retry-after"]).toBeDefined();
  });

  it("tracks budgets per client IP", async () => {
    const first = await limitedApp.inject({
      method: "GET",
      url: "/ping",
      headers: { "x-forwarded-for": "10.9.9.2" },
    });
    expect(first.statusCode).toBe(200); // fresh budget for a different IP
  });

  it("does not rate-limit the liveness probe", async () => {
    for (let i = 0; i < 5; i++) {
      const response = await limitedApp.inject({ method: "GET", url: "/health" });
      expect(response.statusCode).toBe(200);
    }
  });

  it("resets the budget when the window elapses", async () => {
    const ip = "10.9.9.3";
    for (let i = 0; i < 2; i++) {
      const ok = await resettingApp.inject({
        method: "GET",
        url: "/ping",
        headers: { "x-forwarded-for": ip },
      });
      expect(ok.statusCode).toBe(200);
    }
    const limited = await resettingApp.inject({
      method: "GET",
      url: "/ping",
      headers: { "x-forwarded-for": ip },
    });
    expect(limited.statusCode).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const again = await resettingApp.inject({
      method: "GET",
      url: "/ping",
      headers: { "x-forwarded-for": ip },
    });
    expect(again.statusCode).toBe(200);
  });
});
