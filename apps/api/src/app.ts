import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";

import { FakeChannelAdapter } from "@raices/channels";

import { checkDatabaseReady } from "./health.js";
import { registerClientIpDiagnostic } from "./client-ip-diagnostic.js";
import type { Database } from "./db/schema.js";
import { createPool } from "./db/index.js";
import { NotFoundError, UnauthorizedError, toApiError } from "./errors.js";
import { registerRateLimit, registerSecurityHeaders } from "./hardening.js";
import type { IdentityService } from "./identity/service.js";
import { buildHttpOpenApiDocument } from "./http/document.js";
import type { DurableReceiptStore } from "./http/idempotency.js";
import { registerIdentityRoutes } from "./http/identity.js";
import type { InviteLimiter } from "./http/invite-limit.js";
import { installAuthorization } from "./http/policy.js";
import { registerRelationshipRoutes } from "./http/relationships.js";
import { registerRequestRoutes } from "./http/requests.js";
import { REDACT_OPTIONS, censorSensitiveKeys } from "./logging.js";
import { buildOpenApiDocument } from "./openapi.js";
import { registerTelemetry } from "./telemetry.js";
import { InMemoryInboundDeduplicator } from "./webhooks/dedupe.js";
import { registerWebhookRoutes, type WebhookRouteDeps } from "./webhooks/routes.js";
import { FakeSignatureVerifier } from "./webhooks/signature.js";

export interface HealthResponse {
  readonly ok: true;
  /** Deployed git SHA, for the deployed-probe workflow to wait on. Set via GIT_SHA or RAILWAY_GIT_COMMIT_SHA at build time; "unknown" if unset. */
  readonly sha?: string;
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
  /**
   * Webhook seam dependencies (K2.28). Defaults are the skeleton fakes: a
   * FakeChannelAdapter, a FakeSignatureVerifier accepting the documented
   * test signature, and an in-memory deduplicator. Tests inject their own.
   */
  readonly webhooks?: Partial<WebhookRouteDeps> | undefined;
  /**
   * Everything the identity, relationship and request routes need.
   *
   * Left out, those routes are not registered and the app serves only the
   * host routes — which is what the many `buildApp()` calls in the test
   * suite want, and what a deployment without the identity and receipt
   * secrets gets (see `index.ts`). The authorization guard is installed
   * either way, so a route added without a policy still fails at boot.
   */
  readonly api?: ApiDependencies | undefined;
}

/**
 * The collaborators the authenticated routes are built from.
 *
 * All injected rather than constructed here: the peppers are secrets, the
 * OTP deliverer is a provider seam, and the test suite composes its own.
 */
export interface ApiDependencies {
  readonly db: Kysely<Database>;
  readonly identity: IdentityService;
  readonly receipts: DurableReceiptStore;
  readonly inviteLimiter: InviteLimiter;
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
  "GET /__diagnostics/client-ip": "public",
  "POST /webhooks/channel": "signature-verified",
} as const;

/**
 * The route-level config a host route is registered with.
 *
 * Reading the policy out of `HOST_ROUTE_POLICIES` rather than repeating it
 * at the route is what makes that constant load-bearing: edit the table and
 * the route changes, so the table cannot drift into being a comment.
 */
function hostPolicy(route: keyof typeof HOST_ROUTE_POLICIES) {
  return { config: { authorizationPolicy: { kind: HOST_ROUTE_POLICIES[route] } } } as const;
}

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
    // Trust only the immediately connected platform proxy, not arbitrary
    // client-supplied entries in the X-Forwarded-For chain (K3.21).
    trustProxy: (_address: string, hop: number) => hop < 1,
  });

  registerSecurityHeaders(app);

  // Authorization is installed here, before ANY route is registered, because
  // its `onRoute` hook is what enforces deny-by-default and that hook only
  // sees routes added after it. A route registered above this line would be
  // silently unpoliced, which is the failure this whole arrangement exists
  // to make impossible.
  //
  // Without `api` there is no database and no real identity service, so the
  // policy gets one that refuses every credential. Nothing authenticated is
  // registered in that configuration, so it is never consulted — but if a
  // route is added later and forgets its deps, it denies rather than admits.
  installAuthorization(app, {
    identity: options.api?.identity ?? {
      authenticate: () => Promise.reject(new UnauthorizedError()),
    },
    ...(options.api === undefined ? {} : { db: options.api.db }),
  });

  const checkRateLimit = registerRateLimit(app, {
    max: options.rateLimitMax ?? 600,
    windowMs: options.rateLimitWindowMs ?? 60_000,
  });

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

  // Explicitly opt-in, non-production-only diagnostic for K3.21.
  registerClientIpDiagnostic(app);

  // /health: process is up. No dependencies checked.
  // Includes the deployed git SHA so the deployed-probe workflow can wait
  // until the expected commit is live (K2.50 follow-up).
  app.get("/health", hostPolicy("GET /health"), (): HealthResponse => {
    const sha = process.env.GIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? "unknown";
    return { ok: true, sha };
  });

  // /ready: can we reach Postgres? Returns 503 when the DB is unreachable.
  // Never leaks connection strings or driver errors into the response body.
  app.get("/ready", hostPolicy("GET /ready"), async (_, reply): Promise<ReadyResponse> => {
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
  // The document describes what this instance actually serves. With the
  // authenticated routes wired it is the full contract; without them it is
  // the host routes alone. Advertising paths that are not registered would
  // make the document a plan rather than a description.
  app.get("/openapi.json", hostPolicy("GET /openapi.json"), () => {
    return options.api === undefined ? buildOpenApiDocument() : buildHttpOpenApiDocument();
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

  // The point of the ticket: identity, relationships and requests have been
  // domain code with tests and no way in. `installAuthorization` above has
  // already run, so each of these registers through the policy router and
  // every one of their routes carries an explicit policy.
  if (options.api !== undefined) {
    const { db, identity, receipts, inviteLimiter } = options.api;
    // `request.ip` is the trusted resolver these modules ask for: the Fastify
    // instance above sets `trustProxy` to hop 0, so it is the address of the
    // platform proxy we are actually behind and not an attacker-chosen entry
    // in X-Forwarded-For (K3.21).
    const clientIp = (request: FastifyRequest) => request.ip;
    registerIdentityRoutes(app, { identity, rateLimitCheck: checkRateLimit, clientIp });
    registerRelationshipRoutes(app, { db, identity, receipts, inviteLimiter, clientIp });
    registerRequestRoutes(app, { db, identity, receipts });
  }

  return app;
}
