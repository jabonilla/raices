import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

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
 *
 * Returns the check function so security-sensitive routes (webhooks) can
 * also enforce it explicitly in a preHandler, where static analysis can see
 * it — the global onRequest hook is invisible to CodeQL's taint tracking.
 */
export function registerRateLimit(
  app: FastifyInstance,
  options: RateLimitOptions,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const windows = new Map<string, WindowState>();

  const check = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
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
  };

  app.addHook("onRequest", async (request, reply) => {
    // /health is exempt (liveness must always answer); /webhooks/channel
    // enforces the same check explicitly in its own preHandler, where the
    // protection is visible at the route.
    if (request.url === "/health" || request.url === "/webhooks/channel") {
      return;
    }
    await check(request, reply);
  });

  return check;
}
