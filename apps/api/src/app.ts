import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import { checkDatabaseReady } from "./health.js";
import { createPool } from "./db/index.js";
import { REDACT_OPTIONS, censorSensitiveKeys } from "./logging.js";

export interface HealthResponse {
  readonly ok: true;
}

export interface ReadyResponse {
  readonly ok: boolean;
}

const REQUEST_ID_HEADER = "x-request-id";

export function buildApp(): FastifyInstance {
  const isProduction = process.env.NODE_ENV === "production";

  const loggerOptions: Record<string, unknown> = {
    level: isProduction ? "info" : "debug",
    redact: REDACT_OPTIONS,
    // Defense in depth: pino's redact paths only match fixed depths
    // ("*.phone" covers exactly one level). The log formatter walks every
    // logged object recursively and censors deny-listed keys at any depth.
    formatters: { log: censorSensitiveKeys },
  };
  // JSON in prod, pretty in dev.
  if (!isProduction) {
    loggerOptions.transport = {
      target: "pino-pretty",
      options: { colorize: true },
    };
  }

  const app = Fastify({
    logger: loggerOptions,
    // Generate a request ID if the client didn't send one.
    genReqId: (req) => {
      const header = req.headers[REQUEST_ID_HEADER];
      if (typeof header === "string" && header.length > 0) {
        return header;
      }
      return randomUUID();
    },
  });

  // Echo the request ID in the response header, and ensure it's on
  // every log line for the request via the child logger.
  app.addHook("onRequest", (request, reply, done) => {
    const requestId = request.id;
    reply.header(REQUEST_ID_HEADER, requestId);
    request.log = request.log.child({ requestId });
    done();
  });

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
