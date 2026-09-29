// apps/api/src/app.ts
import Fastify from "fastify";
import { randomUUID } from "node:crypto";

// packages/channels/src/fake.ts
import { z } from "zod";
var FakeWebhookSchema = z.object({
  messageId: z.string().min(1),
  kind: z.enum(["inbound", "delivery"]),
  from: z.string().optional(),
  to: z.string().optional(),
  body: z.string().optional(),
  state: z.enum(["queued", "sent", "delivered", "read", "failed"]).optional(),
  reason: z.string().optional(),
  at: z.string().optional()
}).strict();
var DELIVERY_STATES = /* @__PURE__ */ new Set([
  "queued",
  "sent",
  "delivered",
  "read",
  "failed"
]);
var FakeChannelAdapter = class {
  channel;
  nextId = 1;
  inboundHandlers = [];
  deliveryHandlers = [];
  seenInboundIds = /* @__PURE__ */ new Set();
  outbox = [];
  inboundLog = [];
  deliveryLog = [];
  constructor(options = {}) {
    this.channel = options.channel ?? "fake";
  }
  send(message) {
    const receipt = {
      providerMessageId: `fake-msg-${String(this.nextId)}`
    };
    this.nextId += 1;
    this.outbox.push({ ...message, ...receipt });
    return Promise.resolve(receipt);
  }
  normalizeWebhook(raw) {
    const parsed = FakeWebhookSchema.safeParse(raw);
    if (!parsed.success) return { type: "unknown" };
    const payload = parsed.data;
    if (payload.kind === "inbound") {
      if (payload.from === void 0 || payload.to === void 0 || payload.body === void 0) {
        return { type: "unknown" };
      }
      const message = {
        providerMessageId: payload.messageId,
        channel: this.channel,
        from: payload.from,
        to: payload.to,
        body: payload.body,
        sentAt: payload.at ?? (/* @__PURE__ */ new Date()).toISOString()
      };
      return { type: "inbound", message };
    }
    if (payload.state === void 0 || !DELIVERY_STATES.has(payload.state)) {
      return { type: "unknown" };
    }
    const update = {
      providerMessageId: payload.messageId,
      state: payload.state,
      at: payload.at ?? (/* @__PURE__ */ new Date()).toISOString(),
      ...payload.reason !== void 0 ? { reason: payload.reason } : {}
    };
    return { type: "delivery", update };
  }
  onInbound(handler) {
    this.inboundHandlers.push(handler);
  }
  onDeliveryUpdate(handler) {
    this.deliveryHandlers.push(handler);
  }
  /**
   * Feed a raw webhook through normalization and dispatch, as the HTTP layer
   * would on a provider POST. Duplicate `providerMessageId`s are acknowledged
   * but not redispatched: returns `false` when the message was a duplicate.
   */
  async simulateInboundWebhook(raw) {
    const event = this.normalizeWebhook(raw);
    if (event.type !== "inbound") return false;
    const id = event.message.providerMessageId;
    if (this.seenInboundIds.has(id)) return false;
    this.seenInboundIds.add(id);
    this.inboundLog.push(event.message);
    for (const handler of this.inboundHandlers) {
      await handler(event.message);
    }
    return true;
  }
  /**
   * Inject a delivery update for a sent message. Call in any order, including
   * out-of-order: the fake forwards exactly what it is given.
   */
  async simulateDelivery(providerMessageId, state, options = {}) {
    const update = {
      providerMessageId,
      state,
      at: options.at ?? (/* @__PURE__ */ new Date()).toISOString(),
      ...options.reason !== void 0 ? { reason: options.reason } : {}
    };
    this.deliveryLog.push(update);
    for (const handler of this.deliveryHandlers) {
      await handler(update);
    }
  }
  /** Convenience for the failure path: a `failed` update with a reason. */
  async failDelivery(providerMessageId, reason) {
    await this.simulateDelivery(providerMessageId, "failed", { reason });
  }
  /** Outbound messages handed to `send`, in order. */
  get sentMessages() {
    return this.outbox;
  }
  /** Inbound messages dispatched to handlers (duplicates excluded). */
  get receivedInbound() {
    return this.inboundLog;
  }
  /** Delivery updates dispatched to handlers, in injection order. */
  get deliveryUpdates() {
    return this.deliveryLog;
  }
};

// apps/api/src/health.ts
var READY_TIMEOUT_MS = 2e3;
async function checkDatabaseReady(pool, timeoutMs = READY_TIMEOUT_MS) {
  const client = await pool.connect().catch(() => null);
  if (client === null) {
    return { ok: false };
  }
  try {
    const query = client.query("SELECT 1");
    const timeout = new Promise((resolve) => {
      setTimeout(() => {
        resolve(null);
      }, timeoutMs);
    });
    const result = await Promise.race([query, timeout]);
    return { ok: result !== null };
  } catch {
    return { ok: false };
  } finally {
    client.release();
  }
}

// apps/api/src/db/index.ts
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

// apps/api/src/db/serializable.ts
var SerializationRetryExhausted = class extends Error {
  /** Marks this as safe for the caller to retry. */
  retryable = true;
  attempts;
  elapsedMs;
  budgetMs;
  constructor(attempts, elapsedMs, budgetMs, options) {
    super(
      `Transaction still serialization-failing after ${String(attempts)} attempts over ${String(elapsedMs)}ms (budget ${String(budgetMs)}ms)`,
      options
    );
    this.name = "SerializationRetryExhausted";
    this.attempts = attempts;
    this.elapsedMs = elapsedMs;
    this.budgetMs = budgetMs;
  }
};

// apps/api/src/db/index.ts
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => value);
function createPool(connectionString) {
  return new pg.Pool({ connectionString });
}

// apps/api/src/errors.ts
var ApiError = class extends Error {
  code;
  statusCode;
  constructor(code, message, statusCode) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
  }
};
var BadRequestError = class extends ApiError {
  constructor(message) {
    super("invalid_request", message, 400);
    this.name = "BadRequestError";
  }
};
var UnauthorizedError = class extends ApiError {
  constructor(message = "Authentication required.") {
    super("unauthorized", message, 401);
    this.name = "UnauthorizedError";
  }
};
var NotFoundError = class extends ApiError {
  constructor(message = "Not found.") {
    super("not_found", message, 404);
    this.name = "NotFoundError";
  }
};
var RateLimitedError = class extends ApiError {
  constructor(message = "Too many requests.") {
    super("rate_limited", message, 429);
    this.name = "RateLimitedError";
  }
};
var GENERIC_500_MESSAGE = "An unexpected error occurred.";
function envelope(code, message, requestId) {
  return { error: { code, message, requestId } };
}
function codeForStatus(statusCode) {
  switch (statusCode) {
    case 400:
    case 415:
    case 422:
      return "invalid_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 405:
      return "method_not_allowed";
    case 409:
      return "conflict";
    case 429:
      return "rate_limited";
    case 503:
      return "unavailable";
    default:
      return "bad_request";
  }
}
function isZodLike(error) {
  return typeof error === "object" && error !== null && error.name === "ZodError";
}
function toApiError(error, requestId) {
  if (error instanceof ApiError) {
    return {
      statusCode: error.statusCode,
      body: envelope(error.code, error.message, requestId)
    };
  }
  if (error instanceof SerializationRetryExhausted) {
    return {
      statusCode: 503,
      body: envelope("unavailable", "The service is busy. Please retry.", requestId)
    };
  }
  if (isZodLike(error)) {
    return {
      statusCode: 400,
      body: envelope("invalid_request", "Request validation failed.", requestId)
    };
  }
  const candidate = error;
  if (typeof candidate?.statusCode === "number" && candidate.statusCode >= 400 && candidate.statusCode < 500) {
    const message = typeof candidate.message === "string" && candidate.message.length > 0 ? candidate.message : "Bad request.";
    return {
      statusCode: candidate.statusCode,
      body: envelope(codeForStatus(candidate.statusCode), message, requestId)
    };
  }
  return {
    statusCode: 500,
    body: envelope("internal_error", GENERIC_500_MESSAGE, requestId)
  };
}

// apps/api/src/hardening.ts
function registerSecurityHeaders(app2) {
  app2.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header("Cross-Origin-Resource-Policy", "same-origin");
    reply.header("X-DNS-Prefetch-Control", "off");
    return payload;
  });
}
function registerRateLimit(app2, options) {
  const windows = /* @__PURE__ */ new Map();
  const check = async (request, reply) => {
    const now = Date.now();
    for (const [key, state2] of windows) {
      if (state2.resetAt <= now) {
        windows.delete(key);
      }
    }
    let state = windows.get(request.ip);
    if (state === void 0 || state.resetAt <= now) {
      state = { count: 0, resetAt: now + options.windowMs };
      windows.set(request.ip, state);
    }
    state.count += 1;
    if (state.count > options.max) {
      reply.header("Retry-After", Math.max(1, Math.ceil((state.resetAt - now) / 1e3)));
      throw new RateLimitedError();
    }
  };
  app2.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health" || request.url === "/webhooks/channel") {
      return;
    }
    await check(request, reply);
  });
  return check;
}

// apps/api/src/logging.ts
var REDACT_PATHS = [
  // Phone numbers (top-level and one level deep)
  "phone",
  "*.phone",
  "phoneNumber",
  "*.phoneNumber",
  "msisdn",
  "*.msisdn",
  // Names
  "name",
  "*.name",
  "firstName",
  "*.firstName",
  "lastName",
  "*.lastName",
  "fullName",
  "*.fullName",
  "recipientName",
  "*.recipientName",
  // A relationship's display name: what one sender calls one recipient.
  // Both spellings, since the database column and the domain type differ.
  "displayName",
  "*.displayName",
  "display_name",
  "*.display_name",
  "senderName",
  "*.senderName",
  // Emails
  "email",
  "*.email",
  "emailAddress",
  "*.emailAddress",
  // Account identifiers
  "accountId",
  "*.accountId",
  "accountNumber",
  "*.accountNumber",
  "iban",
  "*.iban",
  "clabe",
  "*.clabe",
  "userId",
  "*.userId",
  // Amounts (money is bigint minor units; never log the raw value)
  "amount",
  "*.amount",
  "amountMinor",
  "*.amountMinor",
  "balance",
  "*.balance"
];
var CENSOR = "[Redacted]";
var REDACT_OPTIONS = {
  paths: [...REDACT_PATHS],
  censor: CENSOR
};
var SENSITIVE_KEY_NAMES = new Set(
  REDACT_PATHS.map((path) => path.startsWith("*.") ? path.slice(2) : path)
);
var SENSITIVE_LOG_KEYS = [...SENSITIVE_KEY_NAMES];
function isPlainObject(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function censorSensitiveKeys(value, memo = /* @__PURE__ */ new Map()) {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const cached = memo.get(value);
  if (cached !== void 0) {
    return cached;
  }
  if (Array.isArray(value)) {
    const copy2 = [];
    memo.set(value, copy2);
    for (const item of value) {
      copy2.push(censorSensitiveKeys(item, memo));
    }
    return copy2;
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const copy = {};
  memo.set(value, copy);
  for (const [key, entry] of Object.entries(value)) {
    copy[key] = SENSITIVE_KEY_NAMES.has(key) ? CENSOR : censorSensitiveKeys(entry, memo);
  }
  return copy;
}

// apps/api/src/openapi.ts
import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";

// packages/money/src/currency.ts
var MINOR_UNIT_EXPONENTS = {
  USD: 2,
  GTQ: 2
};
var SUPPORTED_CURRENCIES = Object.keys(MINOR_UNIT_EXPONENTS);
function isCurrency(value) {
  return typeof value === "string" && Object.hasOwn(MINOR_UNIT_EXPONENTS, value);
}

// apps/api/src/ledger/post.ts
import { z as z2 } from "zod";
var CurrencySchema = z2.custom(isCurrency, {
  message: "unsupported currency"
}).meta({ type: "string", enum: [...SUPPORTED_CURRENCIES] });
var MoneySchema = z2.object({
  // Wire representation declared for OpenAPI generation (see CurrencySchema
  // above): positive bigint amounts are decimal strings without leading
  // zeros. Validation behavior is unchanged.
  amount: z2.bigint().positive().meta({ pattern: "^[1-9]\\d*$" }),
  currency: CurrencySchema
});
var EntrySchema = z2.object({
  accountId: z2.uuid(),
  direction: z2.enum(["debit", "credit"]),
  amount: MoneySchema,
  entryType: z2.string().min(1)
});
var PostRequestSchema = z2.object({
  idempotencyKey: z2.string().min(1),
  description: z2.string().min(1),
  occurredAt: z2.date(),
  entries: z2.array(EntrySchema).min(2)
});

// apps/api/src/openapi.ts
var generator = new OpenApiGeneratorV3([
  { type: "schema", schema: CurrencySchema.meta({ id: "Currency" }) },
  { type: "schema", schema: MoneySchema.meta({ id: "Money" }) },
  { type: "schema", schema: EntrySchema.meta({ id: "Entry" }) },
  { type: "schema", schema: PostRequestSchema.meta({ id: "PostRequest" }) }
]);
function buildOpenApiDocument() {
  const { components } = generator.generateComponents();
  return {
    openapi: "3.1.0",
    info: {
      title: "Ra\xEDces API",
      version: "0.0.0",
      description: [
        "Cross-border payments: US sender, Guatemala recipient.",
        "",
        "The schema components below are generated at runtime from the Zod",
        "schemas that validate ledger writes (apps/api/src/ledger/post.ts).",
        "They are published ahead of the ledger HTTP endpoints so the",
        "contract is visible while those endpoints are still unbuilt.",
        "",
        "JSON mapping: bigint amounts are decimal strings on the wire,",
        "Date values are RFC 3339 date-time strings."
      ].join("\n")
    },
    // The route paths are documented inline: /health and /ready have no
    // Zod schemas, so there is nothing to generate them from. Only the
    // components above are generated.
    paths: {
      "/health": {
        get: {
          summary: "Liveness probe",
          description: "Returns 200 when the process is up. No dependencies checked.",
          responses: {
            "200": {
              description: "The process is up.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean", const: true } },
                    required: ["ok"]
                  }
                }
              }
            }
          }
        }
      },
      "/ready": {
        get: {
          summary: "Readiness probe",
          description: "Returns 200 when Postgres is reachable, 503 otherwise.",
          responses: {
            "200": {
              description: "The API can reach the database.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean", const: true } },
                    required: ["ok"]
                  }
                }
              }
            },
            "503": {
              description: "The database is unreachable.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean", const: false } },
                    required: ["ok"]
                  }
                }
              }
            }
          }
        }
      },
      "/openapi.json": {
        get: {
          summary: "This document",
          description: "The OpenAPI document, generated at runtime from the Zod schemas.",
          responses: {
            "200": {
              description: "The OpenAPI 3.1 document.",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      }
    },
    components
  };
}

// apps/api/src/telemetry.ts
import { randomBytes } from "node:crypto";
function resolveTelemetryExporter(env = process.env) {
  const raw = env["TELEMETRY_EXPORTER"];
  if (raw === "console" || raw === "none") {
    return raw;
  }
  return env["NODE_ENV"] === "development" || env["NODE_ENV"] === void 0 ? "console" : "none";
}
function consoleExporter(span) {
  process.stdout.write(
    JSON.stringify(
      span,
      (_key, value) => typeof value === "bigint" ? "[BigInt]" : value
    ) + "\n"
  );
}
function noopExporter() {
}
var activeExporter = resolveTelemetryExporter() === "console" ? consoleExporter : noopExporter;
function newTraceId() {
  return randomBytes(16).toString("hex");
}
function newSpanId() {
  return randomBytes(8).toString("hex");
}
var SpanImpl = class {
  traceId;
  spanId;
  parentSpanId;
  spanName;
  attributes = {};
  statusCode = "unset";
  statusMessage = void 0;
  startMs = Date.now();
  ended = false;
  constructor(name, attributes, parent) {
    this.spanName = name;
    this.parentSpanId = parent?.spanId;
    this.traceId = parent?.traceId ?? newTraceId();
    this.spanId = newSpanId();
    for (const [key, value] of Object.entries(attributes)) {
      this.setAttribute(key, value);
    }
  }
  get name() {
    return this.spanName;
  }
  setAttribute(key, value) {
    if (this.ended) {
      return;
    }
    this.attributes[key] = SENSITIVE_LOG_KEYS.includes(key) ? CENSOR : censorSensitiveKeys(value);
  }
  setStatus(code, message) {
    if (this.ended) {
      return;
    }
    this.statusCode = code;
    this.statusMessage = message;
  }
  end() {
    if (this.ended) {
      return;
    }
    this.ended = true;
    const endMs = Date.now();
    activeExporter({
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.spanName,
      startTimeUnixMs: this.startMs,
      endTimeUnixMs: endMs,
      durationMs: endMs - this.startMs,
      attributes: this.attributes,
      status: { code: this.statusCode, message: this.statusMessage }
    });
  }
};
function startSpan(name, attributes = {}, parent) {
  return new SpanImpl(name, attributes, parent);
}
function registerTelemetry(app2) {
  app2.decorateRequest("telemetrySpan", null);
  app2.addHook("onRequest", (request, _reply, done) => {
    const routeOptions = request.routeOptions;
    const route = routeOptions?.url;
    const name = route === void 0 ? `HTTP ${request.method}` : `HTTP ${request.method} ${route}`;
    const span = startSpan(name, { "http.method": request.method });
    if (route !== void 0) {
      span.setAttribute("http.route", route);
    }
    request.telemetrySpan = span;
    done();
  });
  app2.addHook("onResponse", (request, reply, done) => {
    const span = request.telemetrySpan;
    if (span !== null) {
      span.setAttribute("http.status_code", reply.statusCode);
      span.setAttribute("request.id", request.id);
      if (reply.statusCode >= 500) {
        span.setStatus("error");
      }
      span.end();
    }
    done();
  });
}

// apps/api/src/webhooks/dedupe.ts
var InMemoryInboundDeduplicator = class {
  seen = /* @__PURE__ */ new Set();
  checkAndMark(providerMessageId) {
    if (this.seen.has(providerMessageId)) {
      return true;
    }
    this.seen.add(providerMessageId);
    return false;
  }
};

// apps/api/src/webhooks/routes.ts
import { z as z3 } from "zod";

// apps/api/src/webhooks/handler.ts
function handleWebhookEvent(event, log) {
  switch (event.type) {
    case "inbound":
      log.debug(
        { providerMessageId: event.message.providerMessageId, channel: event.message.channel },
        "webhook inbound accepted (no-op handler)"
      );
      return;
    case "delivery":
      log.debug(
        { providerMessageId: event.update.providerMessageId, state: event.update.state },
        "webhook delivery update accepted (no-op handler)"
      );
      return;
    case "unknown":
      log.info("webhook payload not recognized; ignored");
      return;
  }
}

// apps/api/src/webhooks/routes.ts
var WebhookPayloadSchema = z3.record(z3.string(), z3.unknown());
var WEBHOOK_SIGNATURE_HEADER = "x-webhook-signature";
function registerWebhookRoutes(app2, deps) {
  app2.post("/webhooks/channel", async (request, reply) => {
    await deps.rateLimitCheck(request, reply);
    const rawBody = Buffer.from(JSON.stringify(request.body ?? null));
    const header = request.headers[WEBHOOK_SIGNATURE_HEADER];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!deps.verifier.verify({ rawBody, signature })) {
      throw new UnauthorizedError("Invalid webhook signature.");
    }
    const parsed = WebhookPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError("Webhook payload must be a JSON object.");
    }
    const event = deps.adapter.normalizeWebhook(parsed.data);
    if (event.type === "inbound") {
      const duplicate = deps.deduplicator.checkAndMark(event.message.providerMessageId);
      if (duplicate) {
        request.log.debug(
          { providerMessageId: event.message.providerMessageId },
          "duplicate webhook ignored"
        );
        return { ok: true, deduped: true };
      }
    }
    const handleEvent = deps.handleEvent ?? handleWebhookEvent;
    await handleEvent(event, request.log);
    const statusCode = event.type === "inbound" ? 202 : 200;
    reply.status(statusCode);
    return { ok: true, deduped: false };
  });
}

// apps/api/src/webhooks/signature.ts
var FakeSignatureVerifier = class _FakeSignatureVerifier {
  static TEST_SIGNATURE = "test-signature";
  expected;
  constructor(expected = _FakeSignatureVerifier.TEST_SIGNATURE) {
    this.expected = expected;
  }
  verify(input) {
    return input.signature !== void 0 && input.signature === this.expected;
  }
};

// apps/api/src/app.ts
var REQUEST_ID_HEADER = "x-request-id";
var MAX_JSON_BODY_BYTES = 256 * 1024;
function buildApp(options = {}) {
  const isProduction = process.env.NODE_ENV === "production";
  const loggerOptions = {
    level: isProduction ? "info" : "debug",
    redact: REDACT_OPTIONS,
    // Defense in depth: pino's redact paths only match fixed depths
    // ("*.phone" covers exactly one level). The log formatter walks every
    // logged object recursively and censors deny-listed keys at any depth.
    formatters: { log: censorSensitiveKeys }
  };
  if (!isProduction) {
    loggerOptions.transport = {
      target: "pino-pretty",
      options: { colorize: true }
    };
  }
  const app2 = Fastify({
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
    trustProxy: true
  });
  registerSecurityHeaders(app2);
  const checkRateLimit = registerRateLimit(app2, {
    max: options.rateLimitMax ?? 600,
    windowMs: options.rateLimitWindowMs ?? 6e4
  });
  registerTelemetry(app2);
  app2.addHook("onRequest", (request, reply, done) => {
    const requestId = request.id;
    reply.header(REQUEST_ID_HEADER, requestId);
    request.log = request.log.child({ requestId });
    done();
  });
  app2.setErrorHandler((error, request, reply) => {
    const requestId = request.id;
    const mapped = toApiError(error, requestId);
    if (mapped.statusCode >= 500) {
      request.log.error({ err: error, requestId }, "unhandled error");
    }
    reply.status(mapped.statusCode).send(mapped.body);
  });
  app2.setNotFoundHandler((request, reply) => {
    const error = new NotFoundError();
    reply.status(error.statusCode).send(toApiError(error, request.id).body);
  });
  app2.get("/health", () => {
    return { ok: true };
  });
  app2.get("/ready", async (_, reply) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === void 0 || databaseUrl === "") {
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
      });
    }
  });
  app2.get("/openapi.json", () => {
    return buildOpenApiDocument();
  });
  registerWebhookRoutes(app2, {
    adapter: options.webhooks?.adapter ?? new FakeChannelAdapter({ channel: "fake" }),
    verifier: options.webhooks?.verifier ?? new FakeSignatureVerifier(),
    deduplicator: options.webhooks?.deduplicator ?? new InMemoryInboundDeduplicator(),
    rateLimitCheck: options.webhooks?.rateLimitCheck ?? checkRateLimit,
    handleEvent: options.webhooks?.handleEvent
  });
  return app2;
}

// apps/api/src/index.ts
var PORT = Number(process.env["PORT"] ?? 3e3);
var app = buildApp();
try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
