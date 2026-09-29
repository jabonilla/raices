import Fastify from "fastify";
import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { CENSOR, SENSITIVE_LOG_KEYS } from "../src/logging.js";
import {
  registerTelemetry,
  resolveTelemetryExporter,
  setSpanExporter,
  startSpan,
  withTracedSerializableTx,
  type ExportedSpan,
} from "../src/telemetry.js";

// Telemetry redaction follows the K2.5 deny-list, same as the logs. These
// tests push sensitive values into spans at every depth and assert none of
// the values appear in the exported span. If setAttribute ever stops
// censoring, these fail.

const SENSITIVE_VALUES: Record<string, string> = {
  phone: "+15551234567",
  name: "María García",
  email: "maria.garcia@example.com",
  accountId: "acc_123456789",
  amount: "99999",
  balance: "123456",
};

let exported: ExportedSpan[];

beforeEach(() => {
  exported = [];
  setSpanExporter((span) => {
    exported.push(span);
  });
});

function exportedJson(): string {
  return JSON.stringify(exported);
}

function expectNoSensitiveValues(message: string): void {
  const json = exportedJson();
  for (const [key, value] of Object.entries(SENSITIVE_VALUES)) {
    expect(
      json,
      `Sensitive value for '${key}' (${value}) must not appear in spans: ${message}`,
    ).not.toContain(value);
  }
}

describe("resolveTelemetryExporter", () => {
  it("honors TELEMETRY_EXPORTER=console", () => {
    expect(resolveTelemetryExporter({ TELEMETRY_EXPORTER: "console" })).toBe("console");
  });

  it("honors TELEMETRY_EXPORTER=none", () => {
    expect(resolveTelemetryExporter({ TELEMETRY_EXPORTER: "none" })).toBe("none");
  });

  it("defaults to console in dev", () => {
    expect(resolveTelemetryExporter({ NODE_ENV: "development" })).toBe("console");
    expect(resolveTelemetryExporter({})).toBe("console");
  });

  it("defaults to none outside dev", () => {
    expect(resolveTelemetryExporter({ NODE_ENV: "test" })).toBe("none");
    expect(resolveTelemetryExporter({ NODE_ENV: "production" })).toBe("none");
  });

  it("falls back to the default on an unrecognized value", () => {
    expect(resolveTelemetryExporter({ TELEMETRY_EXPORTER: "otlp", NODE_ENV: "test" })).toBe("none");
  });
});

describe("span attribute redaction", () => {
  it("redacts deny-listed keys at the top level of attributes", () => {
    const span = startSpan("test", {
      phone: SENSITIVE_VALUES.phone,
      email: SENSITIVE_VALUES.email,
      requestId: "req-123",
    });
    span.end();

    expectNoSensitiveValues("top-level attributes");
    expect(exported[0]?.attributes["phone"]).toBe(CENSOR);
    expect(exported[0]?.attributes["requestId"]).toBe("req-123");
  });

  it("redacts a sensitive attribute key itself", () => {
    // The key IS the sensitive name, not nested inside an object.
    const span = startSpan("test");
    span.setAttribute("accountId", SENSITIVE_VALUES.accountId);
    span.end();

    expectNoSensitiveValues("sensitive attribute key");
    expect(exported[0]?.attributes["accountId"]).toBe(CENSOR);
  });

  it("redacts sensitive keys one level deep", () => {
    const span = startSpan("test", {
      user: { name: SENSITIVE_VALUES.name, email: SENSITIVE_VALUES.email },
    });
    span.end();

    expectNoSensitiveValues("one level deep");
  });

  it("redacts sensitive keys three levels deep", () => {
    const span = startSpan("test", {
      req: { body: { contact: { phone: SENSITIVE_VALUES.phone } } },
    });
    span.end();

    expectNoSensitiveValues("three levels deep");
  });

  it("redacts sensitive keys inside arrays", () => {
    const span = startSpan("test", {
      recipients: [
        { accountId: SENSITIVE_VALUES.accountId, amount: SENSITIVE_VALUES.amount },
        { balance: SENSITIVE_VALUES.balance },
      ],
    });
    span.end();

    expectNoSensitiveValues("inside arrays");
  });

  it("covers every key the log deny-list covers", () => {
    // The span deny-list must not drift from the log deny-list.
    for (const key of Object.keys(SENSITIVE_VALUES)) {
      expect(SENSITIVE_LOG_KEYS).toContain(key);
    }
    const span = startSpan("test");
    for (const [key, value] of Object.entries(SENSITIVE_VALUES)) {
      span.setAttribute(key, value);
    }
    span.end();
    expectNoSensitiveValues("every deny-listed key as attribute");
  });

  it("does not mutate the caller's attribute objects", () => {
    const attrs = { user: { phone: SENSITIVE_VALUES.phone } };
    const snapshot = JSON.stringify(attrs);
    const span = startSpan("test", attrs);
    span.end();
    expect(JSON.stringify(attrs)).toBe(snapshot);
  });
});

describe("span shape", () => {
  it("emits OTel-compatible ids and timestamps", () => {
    const span = startSpan("test.parent");
    const child = startSpan("test.child", {}, span);
    child.end();
    span.end();

    expect(exported).toHaveLength(2);
    const [childSpan, parentSpan] = exported;
    expect(childSpan?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(childSpan?.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(childSpan?.parentSpanId).toBe(parentSpan?.spanId);
    expect(childSpan?.traceId).toBe(parentSpan?.traceId);
    expect(childSpan?.endTimeUnixMs).toBeGreaterThanOrEqual(childSpan?.startTimeUnixMs ?? 0);
    expect(childSpan?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("end() is idempotent", () => {
    const span = startSpan("test");
    span.end();
    span.end();
    expect(exported).toHaveLength(1);
  });

  it("ignores setAttribute after end", () => {
    const span = startSpan("test");
    span.end();
    span.setAttribute("after", "end");
    expect(exported[0]?.attributes).not.toHaveProperty("after");
  });
});

describe("HTTP request spans", () => {
  it("names the span from the route pattern, never the raw URL", async () => {
    const app = Fastify();
    registerTelemetry(app);
    app.get("/users/:id", () => ({ ok: true }));

    // The raw URL carries a realistic account id; the span name must not.
    await app.inject({ method: "GET", url: "/users/acc_123456789" });

    expect(exported).toHaveLength(1);
    const span = exported[0];
    expect(span?.name).toBe("HTTP GET /users/:id");
    expect(span?.attributes["http.method"]).toBe("GET");
    expect(span?.attributes["http.route"]).toBe("/users/:id");
    expect(span?.attributes["http.status_code"]).toBe(200);
    expectNoSensitiveValues("http span");
    await app.close();
  });

  it("gives unmatched routes a generic name", async () => {
    const app = Fastify();
    registerTelemetry(app);

    await app.inject({ method: "GET", url: "/nope" });

    expect(exported).toHaveLength(1);
    expect(exported[0]?.name).toBe("HTTP GET");
    expect(exported[0]?.attributes["http.status_code"]).toBe(404);
    await app.close();
  });

  it("marks 5xx spans as errors", async () => {
    const app = Fastify();
    registerTelemetry(app);
    app.get("/boom", () => {
      throw new Error("kaboom");
    });

    await app.inject({ method: "GET", url: "/boom" });

    expect(exported).toHaveLength(1);
    expect(exported[0]?.status.code).toBe("error");
    expect(exported[0]?.attributes["http.status_code"]).toBe(500);
    await app.close();
  });

  it("buildApp emits one span per request", async () => {
    const app = buildApp();
    await app.inject({ method: "GET", url: "/health" });

    expect(exported).toHaveLength(1);
    expect(exported[0]?.name).toBe("HTTP GET /health");
    expect(exported[0]?.attributes["http.status_code"]).toBe(200);
    expect(exported[0]?.attributes["request.id"]).toBeDefined();
    await app.close();
  });
});

/** A Kysely stand-in that fails `failures` times with 40001, then succeeds. */
function flakyDb(failures: number): {
  db: Kysely<Record<string, never>>;
  calls: { count: number };
} {
  const calls = { count: 0 };
  const db = {
    transaction: () => ({
      setIsolationLevel: () => ({
        execute: async <T>(fn: (trx: unknown) => Promise<T>): Promise<T> => {
          calls.count += 1;
          if (calls.count <= failures) {
            throw Object.assign(new Error("serialization failure"), { code: "40001" });
          }
          return fn({});
        },
      }),
    }),
  } as unknown as Kysely<Record<string, never>>;
  return { db, calls };
}

const deterministic = {
  random: () => 0,
  sleep: () => Promise.resolve(),
  now: () => 0,
};

describe("withTracedSerializableTx", () => {
  it("records the retry attempt count as a span attribute", async () => {
    const { db } = flakyDb(2);
    const parent = startSpan("parent");
    const result = await withTracedSerializableTx(db, "db.tx.test", () => Promise.resolve("ok"), {
      ...deterministic,
      parentSpan: parent,
    });
    parent.end();

    expect(result).toBe("ok");
    expect(exported).toHaveLength(2);
    const txSpan = exported.find((s) => s.name === "db.tx.test");
    expect(txSpan?.attributes["db.system"]).toBe("postgresql");
    // Two serialization failures, then the commit: three attempts observed.
    expect(txSpan?.attributes["db.tx.attempts"]).toBe(3);
    expect(txSpan?.attributes["db.tx.last_sql_state"]).toBe("40001");
    expect(txSpan?.status.code).toBe("unset");
  });

  it("nests the transaction span under the given parent", async () => {
    const { db } = flakyDb(0);
    const parent = startSpan("HTTP GET /health");
    await withTracedSerializableTx(db, "db.tx.test", () => Promise.resolve(1), {
      ...deterministic,
      parentSpan: parent,
    });
    parent.end();

    const txSpan = exported.find((s) => s.name === "db.tx.test");
    const parentSpan = exported.find((s) => s.name === "HTTP GET /health");
    expect(txSpan?.parentSpanId).toBe(parentSpan?.spanId);
    expect(txSpan?.traceId).toBe(parentSpan?.traceId);
  });

  it("marks the span error and rethrows when the transaction fails", async () => {
    // Non-retryable errors propagate on the first attempt without an
    // onAttempt event, so attempts stays 0 and the span is marked error.
    const db = {
      transaction: () => ({
        setIsolationLevel: () => ({
          execute: <T>(): Promise<T> => {
            throw new Error("constraint violation");
          },
        }),
      }),
    } as unknown as Kysely<Record<string, never>>;

    await expect(
      withTracedSerializableTx(db, "db.tx.test", () => Promise.resolve(1), deterministic),
    ).rejects.toThrow("constraint violation");

    const txSpan = exported.find((s) => s.name === "db.tx.test");
    expect(txSpan?.status.code).toBe("error");
    expect(txSpan?.attributes["db.tx.attempts"]).toBe(0);
  });

  it("still honors a caller-supplied onAttempt", async () => {
    const { db } = flakyDb(1);
    const seen: number[] = [];
    await withTracedSerializableTx(db, "db.tx.test", () => Promise.resolve(1), {
      ...deterministic,
      onAttempt: (attempt) => {
        seen.push(attempt.attempt);
      },
    });
    expect(seen).toEqual([1, 2]);
    expect(exported.find((s) => s.name === "db.tx.test")?.attributes["db.tx.attempts"]).toBe(2);
  });
});
