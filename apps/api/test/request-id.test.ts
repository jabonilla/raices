import { afterAll, beforeAll, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

it("generates a request ID when absent and echoes it in the response header", async () => {
  const response = await app.inject({ method: "GET", url: "/health" });

  const requestId = response.headers["x-request-id"];
  expect(requestId).toBeDefined();
  expect(typeof requestId).toBe("string");
  expect((requestId as string).length).toBeGreaterThan(0);
});

it("uses the client-provided request ID when present", async () => {
  const clientId = "test-request-123";
  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { "x-request-id": clientId },
  });

  expect(response.headers["x-request-id"]).toBe(clientId);
});

it("generates unique request IDs", async () => {
  const r1 = await app.inject({ method: "GET", url: "/health" });
  const r2 = await app.inject({ method: "GET", url: "/health" });

  const id1 = r1.headers["x-request-id"];
  const id2 = r2.headers["x-request-id"];
  expect(id1).toBeDefined();
  expect(id2).toBeDefined();
  expect(id1).not.toBe(id2);
});
