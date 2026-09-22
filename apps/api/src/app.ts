import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { REDACT_OPTIONS } from "./logging.js";

export interface HealthResponse {
  readonly ok: true;
}

const REQUEST_ID_HEADER = "x-request-id";

export function buildApp() {
  const isProduction = process.env.NODE_ENV === "production";

  const loggerOptions: Record<string, unknown> = {
    level: isProduction ? "info" : "debug",
    redact: REDACT_OPTIONS,
  };
  // JSON in prod, pretty in dev.
  if (!isProduction) {
    loggerOptions.transport = {
      target: "pino-pretty",
      options: { colorize: true },
    };
  }

  const app = Fastify({
    logger: loggerOptions,
    // Generate a request ID if the client didn't send one.
    genReqId: (req) => {
      const header = req.headers[REQUEST_ID_HEADER];
      if (typeof header === "string" && header.length > 0) {
        return header;
      }
      return randomUUID();
    },
  });

  // Echo the request ID in the response header, and ensure it's on
  // every log line for the request via the child logger.
  app.addHook("onRequest", (request, reply, done) => {
    const requestId = request.id;
    reply.header(REQUEST_ID_HEADER, requestId);
    request.log = request.log.child({ requestId });
    done();
  });

  app.get("/health", (): HealthResponse => {
    return { ok: true };
  });

  return app;
}
