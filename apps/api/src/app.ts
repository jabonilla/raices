import Fastify, { type FastifyInstance } from "fastify";

import { checkDatabaseReady } from "./health.js";
import { createPool } from "./db/index.js";

export interface HealthResponse {
  readonly ok: true;
}

export interface ReadyResponse {
  readonly ok: boolean;
}

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  // /health: process is up. No dependencies checked.
  app.get("/health", (): HealthResponse => {
    return { ok: true };
  });

  // /ready: can we reach Postgres? Returns 503 when the DB is unreachable.
  // Never leaks connection strings or driver errors into the response body.
  app.get("/ready", async (_, reply): Promise<ReadyResponse> => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined || databaseUrl === "") {
      // No DATABASE_URL configured — not ready, but don't leak anything.
      reply.status(503);
      return { ok: false };
    }

    const pool = createPool(databaseUrl);
    try {
      const result = await checkDatabaseReady(pool);
      if (!result.ok) {
        reply.status(503);
      }
      return { ok: result.ok };
    } finally {
      await pool.end().catch(() => {
        // Ignore pool shutdown errors; we're already responding.
      });
    }
  });

  return app;
}
