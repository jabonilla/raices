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
  expect(response.json()).toEqual({ ok: true });
});
