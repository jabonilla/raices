import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import { checkDatabaseReady } from "./health.js";
import { createPool } from "./db/index.js";
import { NotFoundError, toApiError } from "./errors.js";
import { registerRateLimit, registerSecurityHeaders } from "./hardening.js";
import { REDACT_OPTIONS, censorSensitiveKeys } from "./logging.js";

export interface HealthResponse {
  readonly ok: true;
}

export interface ReadyResponse {
  readonly ok: boolean;
}

const REQUEST_ID_HEADER = "x-request-id";

/** Largest JSON body the API will parse: 256 KiB. Anything bigger is a 413. */
export const MAX_JSON_BODY_BYTES = 256 * 1024;

export interface BuildAppOptions {
  /** Max requests per rate-limit window, per client IP. Defaults to 600. */
  readonly rateLimitMax?: number;
  /** Rate-limit window length in ms. Defaults to one minute. */
  readonly rateLimitWindowMs?: number;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
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
    // Cap parsed bodies so a huge payload cannot exhaust the process.
    bodyLimit: MAX_JSON_BODY_BYTES,
    // Client IPs come from X-Forwarded-For: the app runs behind the
    // platform edge, which sets it. See hardening.ts for the caveat.
    trustProxy: true,
  });

  registerSecurityHeaders(app);
  registerRateLimit(app, {
    max: options.rateLimitMax ?? 600,
    windowMs: options.rateLimitWindowMs ?? 60_000,
  });

  // Echo the request ID in the response header, and ensure it's on
  // every log line for the request via the child logger.
  app.addHook("onRequest", (request, reply, done) => {
    const requestId = request.id;
    reply.header(REQUEST_ID_HEADER, requestId);
    request.log = request.log.child({ requestId });
    done();
  });

  // One error shape for every response. Internal details never leave the
  // server: 5xx originals are logged with the request id, the client gets
  // the envelope.
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;
    const mapped = toApiError(error, requestId);
    if (mapped.statusCode >= 500) {
      request.log.error({ err: error, requestId }, "unhandled error");
    }
    reply.status(mapped.statusCode).send(mapped.body);
  });

  app.setNotFoundHandler((request, reply) => {
    const error = new NotFoundError();
    reply.status(error.statusCode).send(toApiError(error, request.id).body);
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
