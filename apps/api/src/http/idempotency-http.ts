import { createHmac, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ConflictError, ServiceUnavailableError } from "../errors.js";

export interface HttpOutcome {
  statusCode: number;
  headers: Record<string, string>;
  body: string | null;
}
export type HttpClaim =
  | { kind: "owner" }
  | { kind: "completed"; outcome: HttpOutcome }
  | { kind: "pending"; outcome: Promise<HttpOutcome> };
/** Durable implementation belongs to Claude Code; admission must be atomic. */
export interface HttpIdempotencyStore {
  claim(scopeKey: string, fingerprint: string): Promise<HttpClaim>;
  complete(scopeKey: string, outcome: HttpOutcome): Promise<void>;
}
interface Entry {
  fingerprint: string;
  outcome: Promise<HttpOutcome>;
  resolve: (outcome: HttpOutcome) => void;
  completed?: HttpOutcome;
  expiresAt?: number;
}
export class InMemoryHttpIdempotencyStore implements HttpIdempotencyStore {
  private readonly entries = new Map<string, Entry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  constructor(options: { maxEntries?: number; ttlMs?: number; now?: () => number } = {}) {
    this.maxEntries = options.maxEntries ?? 10_000;
    this.ttlMs = options.ttlMs ?? 15 * 60_000;
    this.now = options.now ?? Date.now;
    for (const n of [this.maxEntries, this.ttlMs])
      if (!Number.isSafeInteger(n) || n < 1) throw new Error("Invalid HTTP receipt policy");
  }
  claim(scopeKey: string, fingerprint: string): Promise<HttpClaim> {
    for (const [key, entry] of this.entries)
      if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) this.entries.delete(key);
    const existing = this.entries.get(scopeKey);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint)
        return Promise.reject(new ConflictError("Idempotency key was used for another request."));
      return Promise.resolve(
        existing.completed === undefined
          ? { kind: "pending", outcome: existing.outcome }
          : { kind: "completed", outcome: structuredClone(existing.completed) },
      );
    }
    if (this.entries.size >= this.maxEntries) return Promise.reject(new ServiceUnavailableError());
    let resolve!: (outcome: HttpOutcome) => void;
    const outcome = new Promise<HttpOutcome>((done) => {
      resolve = done;
    });
    this.entries.set(scopeKey, { fingerprint, outcome, resolve });
    return Promise.resolve({ kind: "owner" });
  }
  complete(scopeKey: string, outcome: HttpOutcome): Promise<void> {
    const entry = this.entries.get(scopeKey);
    if (entry === undefined || entry.completed !== undefined)
      return Promise.reject(new ServiceUnavailableError());
    entry.completed = structuredClone(outcome);
    entry.expiresAt = this.now() + this.ttlMs;
    entry.resolve(structuredClone(outcome));
    return Promise.resolve();
  }
}
function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
}
const keySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\x21-\x7e]+$/);
export interface HttpIdempotencyOptions {
  store?: HttpIdempotencyStore;
  /** Authenticated principal ID, or an explicitly declared public namespace. */
  scope: (request: FastifyRequest) => string;
  /** Routes with an independent provider-event deduplicator may opt out. */
  skip?: (request: FastifyRequest) => boolean;
  waitMs?: number;
  /** Share a server-side secret across replicas when supplying a shared store. */
  fingerprintSecret?: string;
}
const installed = new WeakSet<FastifyInstance>();
export function installHttpIdempotency(
  app: FastifyInstance,
  options: HttpIdempotencyOptions,
): void {
  if (installed.has(app)) throw new Error("HTTP idempotency already installed on this scope");
  installed.add(app);
  const store = options.store ?? new InMemoryHttpIdempotencyStore();
  const secret = options.fingerprintSecret ?? randomBytes(32).toString("hex");
  if (Buffer.byteLength(secret) < 32)
    throw new Error("HTTP fingerprint secret must be at least 32 bytes");
  const waitMs = options.waitMs ?? 2_000;
  if (!Number.isSafeInteger(waitMs) || waitMs < 1)
    throw new Error("Invalid HTTP receipt wait budget");
  const owners = new WeakMap<FastifyRequest, string>();
  const digest = (value: unknown) =>
    createHmac("sha256", secret).update(canonical(value)).digest("hex");
  app.addHook("preHandler", async (request, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    if (options.skip?.(request) === true) return;
    const key = keySchema.parse(request.headers["idempotency-key"]);
    const scopeKey = digest([options.scope(request), key]);
    const fingerprint = digest({
      method: request.method,
      route: request.routeOptions.url,
      params: request.params,
      query: request.query,
      body: request.body,
      authorization: request.headers.authorization,
    });
    const claim = await store.claim(scopeKey, fingerprint);
    if (claim.kind === "owner") {
      owners.set(request, scopeKey);
      return;
    }
    let outcome: HttpOutcome;
    if (claim.kind === "completed") outcome = claim.outcome;
    else {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        outcome = await Promise.race([
          claim.outcome,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              reject(new ServiceUnavailableError());
            }, waitMs);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
    for (const [name, value] of Object.entries(outcome.headers)) reply.header(name, value);
    return reply.code(outcome.statusCode).send(outcome.body);
  });
  app.addHook("onSend", async (request, reply, payload) => {
    const scopeKey = owners.get(request);
    if (scopeKey === undefined) return payload;
    // Current owned routes return JSON or an empty body. Never buffer streams.
    if (
      payload !== null &&
      payload !== undefined &&
      typeof payload !== "string" &&
      !Buffer.isBuffer(payload)
    )
      throw new ServiceUnavailableError();
    const headers: Record<string, string> = {};
    for (const name of ["content-type", "cache-control", "location", "retry-after"]) {
      const value = reply.getHeader(name);
      if (value !== undefined)
        headers[name] = Array.isArray(value) ? value.join(", ") : String(value);
    }
    owners.delete(request);
    await store.complete(scopeKey, {
      statusCode: reply.statusCode,
      headers,
      body:
        payload === null || payload === undefined
          ? null
          : Buffer.isBuffer(payload)
            ? payload.toString("utf8")
            : payload,
    });
    return payload;
  });
}
