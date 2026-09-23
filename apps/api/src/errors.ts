/**
 * One error shape for every API response: a stable machine-readable code,
 * a human-readable message, and the request id the logs can be matched on.
 *
 * Internal details — SQL errors, stack traces, connection strings — must
 * NEVER reach the response body. Only `ApiError` subclasses and Fastify
 * framework 4xx errors keep their own messages; everything else becomes a
 * generic 500. The full error is logged server-side instead.
 */
export type ApiErrorCode =
  | "internal_error"
  | "invalid_request"
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "method_not_allowed"
  | "conflict"
  | "rate_limited";

export interface ApiErrorBody {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly requestId: string;
  };
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;

  constructor(code: ApiErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class BadRequestError extends ApiError {
  constructor(message: string) {
    super("invalid_request", message, 400);
    this.name = "BadRequestError";
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Authentication required.") {
    super("unauthorized", message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Not allowed.") {
    super("forbidden", message, 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Not found.") {
    super("not_found", message, 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends ApiError {
  constructor(message: string) {
    super("conflict", message, 409);
    this.name = "ConflictError";
  }
}

export class RateLimitedError extends ApiError {
  constructor(message = "Too many requests.") {
    super("rate_limited", message, 429);
    this.name = "RateLimitedError";
  }
}

export interface MappedApiError {
  readonly statusCode: number;
  readonly body: ApiErrorBody;
}

const GENERIC_500_MESSAGE = "An unexpected error occurred.";

function envelope(code: ApiErrorCode, message: string, requestId: string): ApiErrorBody {
  return { error: { code, message, requestId } };
}

function codeForStatus(statusCode: number): ApiErrorCode {
  switch (statusCode) {
    case 400:
    case 415:
    case 422:
      return "invalid_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 405:
      return "method_not_allowed";
    case 409:
      return "conflict";
    case 429:
      return "rate_limited";
    default:
      return "bad_request";
  }
}

/**
 * Zod is the validation library at every boundary, but apps/api does not
 * depend on it yet. Duck-type the shape instead of importing it: a
 * validation failure is a 400 no matter which package threw it.
 */
function isZodLike(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { name?: unknown }).name === "ZodError"
  );
}

/**
 * Map anything thrown in a request handler to a status code and a safe
 * response body. The caller's message only survives when it is known-safe:
 * an `ApiError` authored by us, or a Fastify framework 4xx. Everything else
 * — including pg driver errors carrying connection strings — becomes a
 * generic 500. Log the original server-side; the request id ties them.
 */
export function toApiError(error: unknown, requestId: string): MappedApiError {
  if (error instanceof ApiError) {
    return {
      statusCode: error.statusCode,
      body: envelope(error.code, error.message, requestId),
    };
  }
  if (isZodLike(error)) {
    return {
      statusCode: 400,
      body: envelope("invalid_request", "Request validation failed.", requestId),
    };
  }
  const candidate = error as { statusCode?: unknown; message?: unknown } | null;
  if (
    typeof candidate?.statusCode === "number" &&
    candidate.statusCode >= 400 &&
    candidate.statusCode < 500
  ) {
    // Fastify framework errors (FST_*): their messages are framework text,
    // never driver internals, so the status and message are safe to keep.
    const message =
      typeof candidate.message === "string" && candidate.message.length > 0
        ? candidate.message
        : "Bad request.";
    return {
      statusCode: candidate.statusCode,
      body: envelope(codeForStatus(candidate.statusCode), message, requestId),
    };
  }
  return {
    statusCode: 500,
    body: envelope("internal_error", GENERIC_500_MESSAGE, requestId),
  };
}
