import { registerReadModelRoutes } from "./http/read-models.js";
import { registerRequestRoutes, type RequestHttpOptions } from "./http/requests.js";
import { registerIdentityRoutes, type IdentityHttpOptions } from "./http/identity.js";
import { installAuthorization } from "./http/policy.js";
import { buildHttpOpenApiDocument } from "./http/document.js";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import { FakeChannelAdapter } from "@raices/channels";

import { checkDatabaseReady } from "./health.js";
import { createPool } from "./db/index.js";
import { NotFoundError, toApiError } from "./errors.js";
import { createRateLimiter, registerRateLimit, registerSecurityHeaders } from "./hardening.js";
import { REDACT_OPTIONS, censorSensitiveKeys } from "./logging.js";
import { buildOpenApiDocument } from "./openapi.js";
import { registerTelemetry } from "./telemetry.js";
import { InMemoryInboundDeduplicator } from "./webhooks/dedupe.js";
import { registerWebhookRoutes, type WebhookRouteDeps } from "./webhooks/routes.js";
import { FakeSignatureVerifier } from "./webhooks/signature.js";

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
  /** Explicit demo dependencies; no production credentials or account mapping defaults. */
  readonly demoApi?: RequestHttpOptions & Pick<IdentityHttpOptions, "identity" | "clientIp">;

  /** Max requests per rate-limit window, per client IP. Defaults to 600. */
  readonly rateLimitMax?: number;
  /** Rate-limit window length in ms. Defaults to one minute. */
  readonly rateLimitWindowMs?: number;
  /**
   * Webhook seam dependencies (K2.28). Defaults are the skeleton fakes: a
   * FakeChannelAdapter, a FakeSignatureVerifier accepting the documented
   * test signature, and an in-memory deduplicator. Tests inject their own.
   */
  readonly webhooks?: Partial<WebhookRouteDeps> | undefined;
}

/**
 * Authorization policies for K2-owned host routes (K3 integration).
 *
 * K3's installAuthorization (K3.10) must run before all routes in the host
 * scope. These declarations state the policy for each K2-owned route so
 * the authorization system can enforce coverage: every registered route
 * must have an explicit policy, deny by default.
 *
 * - /health, /ready, /openapi.json: public — the platform and clients need
 *   these without credentials (liveness, readiness, API contract).
 * - /webhooks/channel: signature-verified — not user auth, but the webhook
 *   signature verifier (see webhooks/signature.ts) authenticates the sender.
 *   The rate limiter also applies as a cheap outer bound.
 */
export const HOST_ROUTE_POLICIES = {
  "GET /health": "public",
  "GET /ready": "public",
  "GET /openapi.json": "public",
  "POST /webhooks/channel": "signature-verified",
} as const;

export type HostRoutePolicy = (typeof HOST_ROUTE_POLICIES)[keyof typeof HOST_ROUTE_POLICIES];

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

  if (options.demoApi !== undefined) {
    // Only the four enumerated host endpoints are public/provider authenticated.
    app.addHook("onRoute", (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      if (
        methods.every((method) => ["GET", "HEAD"].includes(method)) &&
        ["/health", "/ready", "/openapi.json"].includes(route.url)
      ) {
        route.config = { ...route.config, authorizationPolicy: { kind: "public" } };
      } else if (
        methods.every((method) => method === "POST") &&
        route.url === "/webhooks/channel"
      ) {
        route.config = { ...route.config, authorizationPolicy: { kind: "signature-verified" } };
      }
    });
    installAuthorization(app, options.demoApi);
  }
  registerSecurityHeaders(app);

  const rateLimitOptions = {
    max: options.rateLimitMax ?? 600,
    windowMs: options.rateLimitWindowMs ?? 60_000,
  };
  const checkRateLimit =
    options.demoApi === undefined
      ? registerRateLimit(app, rateLimitOptions)
      : createRateLimiter({
          ...rateLimitOptions,
          keyResolver:
            options.demoApi.clientIp ??
            ((request) => request.raw.socket.remoteAddress ?? "unknown"),
        });
  if (options.demoApi !== undefined) {
    app.addHook("onRequest", async (request, reply) => {
      // Auth and webhooks invoke this limiter in their own route hooks.
      // Do not consume the same budget twice when the host mounts them.
      const route = request.routeOptions.url;
      if (
        [
          "/health",
          "/webhooks/channel",
          "/auth/otp/request",
          "/auth/otp/verify",
          "/auth/session/revoke",
        ].includes(route ?? "")
      )
        return;
      await checkRateLimit(request, reply);
    });
  }

  // One span per HTTP request (K2.25). Registered before the other hooks so
  // the span covers the whole request lifecycle.
  registerTelemetry(app);

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

  // /openapi.json: the API contract, generated at runtime from the Zod
  // schemas. Served as JSON; see src/openapi.ts.
  app.get("/openapi.json", () => {
    return options.demoApi === undefined ? buildOpenApiDocument() : buildHttpOpenApiDocument();
  });

  // POST /webhooks/channel: the receiving half of the channel seam (K2.28).
  // Skeleton wiring — fake adapter, fake signature verifier, in-memory
  // dedupe. Phase 3 replaces these with the real provider and the durable
  // store; the route and its contract stay the same.
  registerWebhookRoutes(app, {
    adapter: options.webhooks?.adapter ?? new FakeChannelAdapter({ channel: "fake" }),
    verifier: options.webhooks?.verifier ?? new FakeSignatureVerifier(),
    deduplicator: options.webhooks?.deduplicator ?? new InMemoryInboundDeduplicator(),
    rateLimitCheck: options.webhooks?.rateLimitCheck ?? checkRateLimit,
    handleEvent: options.webhooks?.handleEvent,
  });

  if (options.demoApi !== undefined) {
    registerIdentityRoutes(app, { ...options.demoApi, rateLimitCheck: checkRateLimit });
    registerRequestRoutes(app, options.demoApi);
    registerReadModelRoutes(app, options.demoApi);
  }

  return app;
}
