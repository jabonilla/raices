import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";

/**
 * Staging-only IP diagnostic. The route is entirely absent unless staging
 * identity and a secret salt are both present. Never emit raw addresses.
 */
export function registerClientIpDiagnostic(
  app: FastifyInstance,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const enabled = env.RAICES_ENV === "staging" && Boolean(env.DIAGNOSTIC_IP_SALT);
  if (env.RAICES_ENV === "production" && env.K3_IP_DIAGNOSTIC_ENABLED === "true") {
    throw new Error("IP diagnostic must never be enabled in production");
  }
  if (!enabled) return;

  const salt = env.DIAGNOSTIC_IP_SALT;
  if (!salt) return;
  app.get("/__diagnostics/client-ip", { logLevel: "silent" }, (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return {
      clientIpHash: createHmac("sha256", salt).update(request.ip).digest("hex"),
    };
  });
}
