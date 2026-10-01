import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { IdentityService, RequestCodeSchema, VerifyCodeSchema } from "../identity/service.js";

export { bearerToken } from "./policy.js";
import { bearerToken, installAuthorization } from "./policy.js";
export interface IdentityHttpOptions {
  identity: IdentityService;
  /** K2.11 cheap in-memory bound. Must run before any identity/database work. */
  rateLimitCheck: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Deployment must supply a resolver restricted to its trusted edge network. */
  clientIp?: (request: FastifyRequest) => string;
}
export function registerIdentityRoutes(app: FastifyInstance, options: IdentityHttpOptions): void {
  if (typeof options.rateLimitCheck !== "function")
    throw new Error("Auth routes require rateLimitCheck");
  if (process.env.NODE_ENV === "production" && typeof options.clientIp !== "function")
    throw new Error("Production auth routes require a trusted clientIp resolver");
  const router = installAuthorization(app, { identity: options.identity });
  const ip =
    options.clientIp ??
    ((request: FastifyRequest) => request.raw.socket.remoteAddress ?? "unknown");
  const clientIps = new WeakMap<FastifyRequest, string>();
  const onRequest = async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header("cache-control", "no-store");
    const resolved = ip(request);
    clientIps.set(request, resolved);
    // K2.11 reads request.ip. Give it the same vetted identity used below,
    // without changing the host request or trusting its broad trustProxy setting.
    const limitedRequest = new Proxy(request, {
      get(target, property, receiver) {
        return property === "ip" ? resolved : (Reflect.get(target, property, receiver) as unknown);
      },
    });
    await options.rateLimitCheck(limitedRequest, reply);
  };
  const clientIp = (request: FastifyRequest): string => {
    const value = clientIps.get(request);
    if (value === undefined) throw new Error("Auth rate-limit hook did not run");
    return value;
  };
  // Do not trust arbitrary X-Forwarded-For, even if the host does.
  router.route({
    method: "POST",
    url: "/auth/otp/request",
    policy: { kind: "public" },
    onRequest,
    handler: async (request, reply) => {
      const input = RequestCodeSchema.parse(request.body);
      reply.header("cache-control", "no-store");
      const result = await options.identity.requestCode({ ...input, ip: clientIp(request) });
      return reply.code(202).send(result);
    },
  });
  router.route({
    method: "POST",
    url: "/auth/otp/verify",
    policy: { kind: "public" },
    onRequest,
    handler: async (request, reply) => {
      const input = VerifyCodeSchema.parse(request.body);
      reply.header("cache-control", "no-store");
      return options.identity.verifyCode({ ...input, ip: clientIp(request) });
    },
  });
  router.route({
    method: "POST",
    url: "/auth/session/revoke",
    policy: { kind: "sender" },
    onRequest,
    handler: async (request, reply) => {
      await options.identity.revoke(bearerToken(request));
      return reply.header("cache-control", "no-store").code(204).send();
    },
  });
}
