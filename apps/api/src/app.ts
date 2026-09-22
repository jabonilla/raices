import Fastify, { type FastifyInstance } from "fastify";

export interface HealthResponse {
  readonly ok: true;
}

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", (): HealthResponse => {
    return { ok: true };
  });

  return app;
}
