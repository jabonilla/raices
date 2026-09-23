import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import {
  ApiError,
  BadRequestError,
  ConflictError,
  NotFoundError,
  toApiError,
} from "../src/errors.js";

/** Must never appear in any response body. */
const SECRET = "s3cret-pw";
const FAKE_CONNECTION_STRING = `postgres://k2user:${SECRET}@db.internal:5432/raices`;

const app = buildApp();

// Test-only routes that fail in controlled ways. Registered before ready().
app.get("/boom-unknown", () => {
  throw new Error(`failed to connect: ${FAKE_CONNECTION_STRING}`);
});
app.get("/boom-db", () => {
  // Shaped like a pg driver error, with the secret in the message.
  const pgError = new Error(
    `password authentication failed: ${FAKE_CONNECTION_STRING}`,
  ) as Error & {
    code?: string;
  };
  pgError.code = "28P01";
  throw pgError;
});
app.get("/boom-bad-request", () => {
  throw new BadRequestError("width must be positive");
});
app.get("/boom-not-found", () => {
  throw new NotFoundError("transfer not found");
});
app.post("/echo", (request) => ({ got: request.body }));

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("error envelope", () => {
  it("unknown errors become a generic 500 with a request id", async () => {
    const response = await app.inject({ method: "GET", url: "/boom-unknown" });
    expect(response.statusCode).toBe(500);
    const body = response.json<{ error: { code: string; message: string; requestId: string } }>();
    expect(body.error.code).toBe("internal_error");
    expect(body.error.message).toBe("An unexpected error occurred.");
    expect(typeof body.error.requestId).toBe("string");
    expect(body.error.requestId).toBe(response.headers["x-request-id"]);
  });

  it("a forced DB error never leaks internals into the response body", async () => {
    const response = await app.inject({ method: "GET", url: "/boom-db" });
    expect(response.statusCode).toBe(500);
    const raw = response.body;
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain("db.internal");
    expect(raw).not.toContain("28P01");
    expect(raw).not.toContain("password authentication failed");
    // No stack frames leak either.
    expect(raw).not.toMatch(/^\s*at /m);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("internal_error");
  });

  it("known ApiError subclasses keep their code, message, and status", async () => {
    const badRequest = await app.inject({ method: "GET", url: "/boom-bad-request" });
    expect(badRequest.statusCode).toBe(400);
    expect(badRequest.json()).toEqual({
      error: {
        code: "invalid_request",
        message: "width must be positive",
        requestId: badRequest.headers["x-request-id"],
      },
    });

    const notFound = await app.inject({ method: "GET", url: "/boom-not-found" });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toEqual({
      error: {
        code: "not_found",
        message: "transfer not found",
        requestId: notFound.headers["x-request-id"],
      },
    });
  });

  it("unknown routes return the not_found envelope", async () => {
    const response = await app.inject({ method: "GET", url: "/definitely-not-a-route" });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error: { code: string; requestId: string } }>();
    expect(body.error.code).toBe("not_found");
    expect(body.error.requestId).toBe(response.headers["x-request-id"]);
  });

  it("malformed JSON keeps its 400 status inside the envelope", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/echo",
      payload: "{not json",
      headers: { "content-type": "application/json" },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe("invalid_request");
    expect(typeof body.error.message).toBe("string");
  });
});

describe("toApiError mapping", () => {
  const requestId = "req-123";

  it("maps ApiError subclasses to their status, code, and message", () => {
    const mapped = toApiError(new ConflictError("duplicate transfer"), requestId);
    expect(mapped.statusCode).toBe(409);
    expect(mapped.body).toEqual({
      error: { code: "conflict", message: "duplicate transfer", requestId },
    });
  });

  it("maps a Zod-shaped validation error to 400 invalid_request", () => {
    const zodLike = Object.assign(new Error("validation failed"), {
      name: "ZodError",
      issues: [{ path: ["amount"], message: "expected bigint" }],
    });
    const mapped = toApiError(zodLike, requestId);
    expect(mapped.statusCode).toBe(400);
    expect(mapped.body.error.code).toBe("invalid_request");
  });

  it("maps Fastify 4xx framework errors to their status inside the envelope", () => {
    const fastifyError = Object.assign(new Error("Unsupported Media Type"), {
      code: "FST_ERR_CTP_INVALID_MEDIA_TYPE",
      statusCode: 415,
    });
    const mapped = toApiError(fastifyError, requestId);
    expect(mapped.statusCode).toBe(415);
    expect(mapped.body.error.code).toBe("invalid_request");
  });

  it("maps everything else to a generic 500 without leaking the message", () => {
    const mapped = toApiError(
      new Error(`boom: ${FAKE_CONNECTION_STRING}\n    at evil (stack:1:1)`),
      requestId,
    );
    expect(mapped.statusCode).toBe(500);
    expect(mapped.body.error.code).toBe("internal_error");
    expect(mapped.body.error.message).toBe("An unexpected error occurred.");
    expect(JSON.stringify(mapped.body)).not.toContain(SECRET);
  });

  it("maps non-Error throws to a generic 500", () => {
    const mapped = toApiError("just a string", requestId);
    expect(mapped.statusCode).toBe(500);
    expect(mapped.body.error.code).toBe("internal_error");
  });

  it("ApiError is an Error with a stable code", () => {
    const error = new BadRequestError("nope");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("invalid_request");
    expect(error.statusCode).toBe(400);
  });
});
