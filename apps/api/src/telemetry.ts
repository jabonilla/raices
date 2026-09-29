import { randomBytes } from "node:crypto";

import type { FastifyInstance } from "fastify";
import type { Kysely, Transaction } from "kysely";

import { CENSOR, SENSITIVE_LOG_KEYS, censorSensitiveKeys } from "./logging.js";
import { withSerializableTx, type WithSerializableTxOptions } from "./db/serializable.js";

/**
 * Basic telemetry for apps/api (K2.25).
 *
 * A minimal, dependency-free tracer with an OpenTelemetry-compatible span
 * shape (traceId/spanId/parentSpanId, name, timestamps, attributes, status).
 * The full OTel SDK was deliberately not pulled in: for request + DB
 * transaction spans with a console exporter, the SDK's dependency tree
 * (dozens of packages) buys nothing over ~150 lines of local code. If a
 * real collector is ever needed, `SpanExporter` is the seam — implement it
 * against the OTLP exporter and call `setSpanExporter`.
 *
 * Spans are created around:
 * - every HTTP request (via `registerTelemetry`, wired in app.ts), and
 * - DB transactions run through `withTracedSerializableTx`.
 *
 * REDACTION: span attributes go through the K2.5 deny-list
 * (`SENSITIVE_LOG_KEYS` / `censorSensitiveKeys` from logging.ts). NO PII and
 * NO amounts in span names or attributes — same rule as the logs, tested the
 * same way (see test/telemetry.test.ts). Span *names* are built by our code
 * from static strings and route patterns only; the raw request URL is never
 * used because it can contain IDs.
 */

export type SpanStatusCode = "ok" | "error" | "unset";

/** OTel-shaped span as exported. Times are unix milliseconds. */
export interface ExportedSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly name: string;
  readonly startTimeUnixMs: number;
  readonly endTimeUnixMs: number;
  readonly durationMs: number;
  readonly attributes: Record<string, unknown>;
  readonly status: {
    readonly code: SpanStatusCode;
    readonly message: string | undefined;
  };
}

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly name: string;
  /**
   * Set a span attribute. The key and value are redacted through the K2.5
   * deny-list: a deny-listed key stores "[Redacted]", and deny-listed keys
   * at any depth inside the value are censored. Callers must still not put
   * amounts under innocent key names — key-based redaction cannot catch
   * that, same limitation as the logs.
   */
  setAttribute(key: string, value: unknown): void;
  setStatus(code: SpanStatusCode, message?: string): void;
  /** Ends the span and hands it to the configured exporter. Idempotent. */
  end(): void;
}

export type SpanExporter = (span: ExportedSpan) => void;

export type TelemetryExporterName = "console" | "none";

/**
 * Which exporter to use. `TELEMETRY_EXPORTER=console|none` wins; otherwise
 * console in dev (NODE_ENV unset or "development") and none elsewhere
 * (test, production). An unrecognized value falls back to the default
 * rather than crashing the API on a typo.
 */
export function resolveTelemetryExporter(
  env: Record<string, string | undefined> = process.env,
): TelemetryExporterName {
  const raw = env["TELEMETRY_EXPORTER"];
  if (raw === "console" || raw === "none") {
    return raw;
  }
  return env["NODE_ENV"] === "development" || env["NODE_ENV"] === undefined ? "console" : "none";
}

/** One JSON line per span on stdout. BigInt can never be valid JSON; a bigint
 *  attribute is caller error (amounts must never be attributes), so it is
 *  replaced rather than letting the exporter throw mid-request. */
function consoleExporter(span: ExportedSpan): void {
  process.stdout.write(
    JSON.stringify(span, (_key, value: unknown) =>
      typeof value === "bigint" ? "[BigInt]" : value,
    ) + "\n",
  );
}

function noopExporter(): void {
  // Exporter disabled (TELEMETRY_EXPORTER=none or non-dev default).
}

let activeExporter: SpanExporter =
  resolveTelemetryExporter() === "console" ? consoleExporter : noopExporter;

/**
 * Replace the span exporter. Used by tests to capture spans; also the seam
 * for wiring a real OTLP exporter later without touching instrumentation.
 */
export function setSpanExporter(exporter: SpanExporter): void {
  activeExporter = exporter;
}

function newTraceId(): string {
  return randomBytes(16).toString("hex");
}

function newSpanId(): string {
  return randomBytes(8).toString("hex");
}

class SpanImpl implements Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  private spanName: string;
  private readonly attributes: Record<string, unknown> = {};
  private statusCode: SpanStatusCode = "unset";
  private statusMessage: string | undefined = undefined;
  private readonly startMs: number = Date.now();
  private ended = false;

  constructor(name: string, attributes: Record<string, unknown>, parent: Span | undefined) {
    this.spanName = name;
    this.parentSpanId = parent?.spanId;
    // A child shares its parent's trace; a root starts a new one.
    this.traceId = parent?.traceId ?? newTraceId();
    this.spanId = newSpanId();
    for (const [key, value] of Object.entries(attributes)) {
      this.setAttribute(key, value);
    }
  }

  get name(): string {
    return this.spanName;
  }

  setAttribute(key: string, value: unknown): void {
    if (this.ended) {
      return;
    }
    this.attributes[key] = SENSITIVE_LOG_KEYS.includes(key) ? CENSOR : censorSensitiveKeys(value);
  }

  setStatus(code: SpanStatusCode, message?: string): void {
    if (this.ended) {
      return;
    }
    this.statusCode = code;
    this.statusMessage = message;
  }

  end(): void {
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
      status: { code: this.statusCode, message: this.statusMessage },
    });
  }
}

/**
 * Start a span. Prefer static names; never interpolate request data into a
 * name (use attributes, which are redacted).
 */
export function startSpan(
  name: string,
  attributes: Record<string, unknown> = {},
  parent?: Span,
): Span {
  return new SpanImpl(name, attributes, parent);
}

// Fastify request decoration for the per-request span. Declared here so
// registerTelemetry and any handler can reach the current request's span.
declare module "fastify" {
  interface FastifyRequest {
    telemetrySpan: Span | null;
  }
}

/**
 * Instrument a Fastify app: one span per HTTP request.
 *
 * The span name uses the ROUTE PATTERN (`request.routeOptions.url`, e.g.
 * "/postings/:id"), never the raw URL — raw URLs can contain account IDs
 * and other PII, which must not appear in span names. Unmatched routes
 * (404s) keep the generic `HTTP <method>` name. The request ID is recorded
 * as an attribute; it is a UUID we generate (or echo), not PII.
 */
export function registerTelemetry(app: FastifyInstance): void {
  app.decorateRequest("telemetrySpan", null);

  app.addHook("onRequest", (request, _reply, done) => {
    // Fastify types routeOptions as always present, but it is undefined for
    // unmatched routes (verified empirically with app.inject). Read it
    // defensively so a 404 never throws inside this hook.
    const routeOptions = request.routeOptions as { url?: string } | undefined;
    const route = routeOptions?.url;
    const name = route === undefined ? `HTTP ${request.method}` : `HTTP ${request.method} ${route}`;
    const span = startSpan(name, { "http.method": request.method });
    if (route !== undefined) {
      span.setAttribute("http.route", route);
    }
    request.telemetrySpan = span;
    done();
  });

  app.addHook("onResponse", (request, reply, done) => {
    const span: Span | null = request.telemetrySpan;
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

export interface TracedTxOptions extends WithSerializableTxOptions {
  /** Parent span, e.g. the current request's `telemetrySpan`. */
  readonly parentSpan?: Span | undefined;
}

/**
 * Run `fn` inside a SERIALIZABLE transaction with a span around it, without
 * touching the retry logic itself (`withSerializableTx` is used as-is).
 *
 * The retry attempt count is recorded as the `db.tx.attempts` span
 * attribute via the `onAttempt` observer — after the #44 redesign this is
 * the contention signal Claude asked for: attempts are observable on every
 * transaction span instead of inferred from failures. If any attempt hit a
 * serialization conflict, the last SQLSTATE is recorded as
 * `db.tx.last_sql_state`. A caller-supplied `onAttempt` is still honored.
 *
 * `spanName` must be static (e.g. "db.tx.audit.transition"); never build it
 * from request data.
 */
export async function withTracedSerializableTx<DB, T>(
  db: Kysely<DB>,
  spanName: string,
  fn: (trx: Transaction<DB>) => Promise<T>,
  options: TracedTxOptions = {},
): Promise<T> {
  const span = startSpan(spanName, { "db.system": "postgresql" }, options.parentSpan);
  let attempts = 0;
  let lastSqlState: string | undefined;
  try {
    return await withSerializableTx(db, fn, {
      // parentSpan rides along harmlessly; withSerializableTx reads only
      // the fields it knows. The retry behavior is not ours to change.
      ...options,
      onAttempt: (attempt) => {
        attempts = attempt.attempt;
        if (attempt.sqlState !== undefined) {
          lastSqlState = attempt.sqlState;
        }
        options.onAttempt?.(attempt);
      },
    });
  } catch (error) {
    span.setStatus("error");
    throw error;
  } finally {
    span.setAttribute("db.tx.attempts", attempts);
    if (lastSqlState !== undefined) {
      span.setAttribute("db.tx.last_sql_state", lastSqlState);
    }
    span.end();
  }
}
