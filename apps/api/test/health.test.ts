import { afterAll, beforeAll, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

it("GET /health returns { ok: true }", async () => {
  const response = await app.inject({ method: "GET", url: "/health" });

  expect(response.statusCode).toBe(200);
  const body = response.json();
  expect(body.ok).toBe(true);
  expect(typeof body.sha).toBe("string");
  expect(Object.keys(body).sort()).toEqual(["ok", "sha"]);
});

it("GET /health reports the deployed SHA from GIT_SHA", async () => {
  const original = process.env.GIT_SHA;
  process.env.GIT_SHA = "abc123";
  try {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.json()).toEqual({ ok: true, sha: "abc123" });
  } finally {
    if (original === undefined) {
      delete process.env.GIT_SHA;
    } else {
      process.env.GIT_SHA = original;
    }
  }
});
