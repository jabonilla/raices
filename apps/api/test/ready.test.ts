import { afterAll, beforeAll, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

it("GET /health returns { ok: true } without checking dependencies", async () => {
  // /health must work even when DATABASE_URL is not set.
  const original = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  } finally {
    if (original !== undefined) {
      process.env.DATABASE_URL = original;
    }
  }
});

it("GET /ready returns 503 when DATABASE_URL is not set", async () => {
  const original = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const response = await app.inject({ method: "GET", url: "/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ ok: false });
  } finally {
    if (original !== undefined) {
      process.env.DATABASE_URL = original;
    }
  }
});

it("GET /ready returns 503 when the DB is unreachable", async () => {
  // Point at a port that's (almost certainly) not listening.
  // The response must not leak the connection string or driver errors.
  const original = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://user:secret-password@localhost:59999/nonexistent";
  try {
    const response = await app.inject({ method: "GET", url: "/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ ok: false });

    const body = response.body;
    expect(body).not.toContain("secret-password");
    expect(body).not.toContain("59999");
    expect(body).not.toContain("ECONNREFUSED");
  } finally {
    if (original === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original;
    }
  }
});

it("GET /ready does not leak connection strings in error responses", async () => {
  // Even with a malformed URL, the response stays generic.
  const original = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "not-a-valid-url";
  try {
    const response = await app.inject({ method: "GET", url: "/ready" });
    // Either 503 (not ready) or 500 (internal error), but never a leak.
    expect([503, 500]).toContain(response.statusCode);
    expect(response.body).not.toContain("not-a-valid-url");
  } finally {
    if (original === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original;
    }
  }
});
