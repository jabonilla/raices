import type { FastifyInstance } from "fastify";

import { RateLimitedError } from "./errors.js";

export interface RateLimitOptions {
  /** Max requests per window, per client IP. */
  readonly max: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
}

interface WindowState {
  count: number;
  resetAt: number;
}

/**
 * Security headers, dependency-free. Applied on every response including
 * errors, via onSend.
 *
 * Deliberately no `Strict-Transport-Security`: the app terminates TLS at the
 * platform edge (Railway), and emitting HSTS from the app would also send it
 * on plain-HTTP local dev, where it can pin a browser to HTTPS for a host
 * that has none. If the app ever terminates TLS itself, add HSTS here.
 */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header("Cross-Origin-Resource-Policy", "same-origin");
    reply.header("X-DNS-Prefetch-Control", "off");
    return payload;
  });
}

/**
 * Fixed-window rate limiter, per client IP, in memory.
 *
 * Limits: single process only — each replica keeps its own counters, so the
 * effective budget multiplies by the replica count. Budgets are keyed by
 * `request.ip`, which honors `X-Forwarded-For` because the app runs with
 * `trustProxy`; the app must stay behind a proxy the platform controls
 * (Railway's edge) or a client could spoof the header and dodge the limit.
 * Expired windows are pruned opportunistically on each request, so the map
 * cannot grow without bound.
 *
 * The liveness probe is exempt: the platform must always be able to tell a
 * live process from a dead one, even under load.
 */
export function registerRateLimit(app: FastifyInstance, options: RateLimitOptions): void {
  const windows = new Map<string, WindowState>();

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health") {
      return;
    }
    const now = Date.now();
    for (const [key, state] of windows) {
      if (state.resetAt <= now) {
        windows.delete(key);
      }
    }
    let state = windows.get(request.ip);
    if (state === undefined || state.resetAt <= now) {
      state = { count: 0, resetAt: now + options.windowMs };
      windows.set(request.ip, state);
    }
    state.count += 1;
    if (state.count > options.max) {
      reply.header("Retry-After", Math.max(1, Math.ceil((state.resetAt - now) / 1000)));
      throw new RateLimitedError();
    }
  });
}
