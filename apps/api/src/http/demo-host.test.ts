import { expect, it } from "vitest";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.js";
import { IdentityService } from "../identity/service.js";
import { buildApp } from "../app.js";

it("enforces host policies before database work and exposes demo OpenAPI", async () => {
  // No DB operation is permitted in this unauthenticated perimeter test.
  const db = {} as Kysely<Database>;
  const identity = new IdentityService(db, {
    pepper: "synthetic-demo-host-pepper-32-bytes",
    deliver: () => Promise.resolve(),
  });
  const app = buildApp({ demoApi: { db, identity } });
  try {
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    for (const url of [
      "/screen/relationships",
      "/screen/history",
      "/screen/requests",
      "/relationships/00000000-0000-4000-8000-000000000001/requests",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(401);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(response.statusCode).toBe(200);
    const document = response.json<{ paths: Record<string, unknown> }>();
    expect(document.paths).toHaveProperty("/screen/history");
    expect(document.paths).toHaveProperty("/relationships/{id}/requests/{requestId}/approve");
  } finally {
    await app.close();
  }
});
