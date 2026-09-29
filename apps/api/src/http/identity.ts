import type { FastifyInstance, FastifyRequest } from "fastify";
import { UnauthorizedError } from "../errors.js";
import { IdentityService, RequestCodeSchema, VerifyCodeSchema } from "../identity/service.js";

export function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  const match = typeof header === "string" ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header) : null;
  const token = match?.[1];
  if (token === undefined) throw new UnauthorizedError();
  return token;
}
export interface IdentityHttpOptions {
  identity: IdentityService;
  /** Deployment must supply a resolver restricted to its trusted edge network. */
  clientIp?: (request: FastifyRequest) => string;
}
export function registerIdentityRoutes(app: FastifyInstance, options: IdentityHttpOptions): void {
  const ip =
    options.clientIp ??
    ((request: FastifyRequest) => request.raw.socket.remoteAddress ?? "unknown");
  // Do not trust arbitrary X-Forwarded-For, even if the host does.
  app.post("/auth/otp/request", async (request, reply) => {
    const input = RequestCodeSchema.parse(request.body);
    reply.header("cache-control", "no-store");
    const result = await options.identity.requestCode({ ...input, ip: ip(request) });
    return reply.code(202).send(result);
  });
  app.post("/auth/otp/verify", async (request, reply) => {
    const input = VerifyCodeSchema.parse(request.body);
    reply.header("cache-control", "no-store");
    return options.identity.verifyCode({ ...input, ip: ip(request) });
  });
  app.post("/auth/session/revoke", async (request, reply) => {
    await options.identity.revoke(bearerToken(request));
    return reply.header("cache-control", "no-store").code(204).send();
  });
}
