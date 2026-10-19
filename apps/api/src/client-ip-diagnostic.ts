import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";

/**
 * K3.21: Opt-in diagnostic for isolated non-production environments.
 *
 * Never expose the raw address, salt, or forwarded headers. The route is
 * absent unless explicitly enabled. Production NODE_ENV fails closed.
 * The staging deployment must be verified as non-production before enabling.
 */
export function registerClientIpDiagnostic(
  app: FastifyInstance,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.K3_IP_DIAGNOSTIC_ENABLED !== "true") return;
  if (env.NODE_ENV !== "test" && env.NODE_ENV !== "development") {
    throw new Error("K3 IP diagnostic is forbidden outside test/development");
  }
  const salt = env.K3_IP_DIAGNOSTIC_SALT;
  if (!salt || salt.length < 32) {
    throw new Error("K3 IP diagnostic requires a secret salt of at least 32 characters");
  }
  app.get("/__diagnostics/client-ip", { logLevel: "silent" }, (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return {
      clientIpHash: createHmac("sha256", salt).update(request.ip).digest("hex"),
    };
  });
}
