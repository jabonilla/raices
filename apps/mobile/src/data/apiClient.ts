/**
 * Typed HTTP client for the Raíces API (S5).
 *
 * Speaks exactly the #153 wire surface: OTP auth, relationships, requests.
 * It knows nothing about screens — it returns wire shapes, and the mapping
 * to screen data lives beside it (see sliceProvider).
 *
 * Rules this module follows:
 * - The bearer token lives in memory only. It is never written to disk,
 *   never logged, and never bundled. Session persistence across restarts
 *   is a separate decision (the token is unencrypted in AsyncStorage),
 *   not something this module sneaks in.
 * - Writes always send an `idempotency-key` header: the API parses it
 *   strictly and a missing key turns a write into a 400. Keys are unique
 *   per attempt; retrying the same attempt reuses its key.
 * - Responses are validated narrowly before they are returned. A payload
 *   that does not match the wire shape is a bad-payload error, never a
 *   half-parsed object reaching a screen.
 * - Errors carry a kind, never a body: response bodies can contain PII
 *   (names, phones) and must not leak into logs or error UI.
 */

export type ApiErrorKind =
  "unauthorized" | "not-found" | "bad-request" | "conflict" | "server" | "offline" | "bad-payload";

export class ApiClientError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;

  constructor(kind: ApiErrorKind, status: number | null = null) {
    super(`API request failed: ${kind}`);
    this.name = "ApiClientError";
    this.kind = kind;
    this.status = status;
  }
}

/** Wire shape: POST /auth/otp/request -> 202. */
export interface OtpChallenge {
  readonly challengeId: string;
}

/** Wire shape: POST /auth/otp/verify. Token is the 43-char bearer token. */
export interface Session {
  readonly token: string;
  readonly userId: string;
  readonly expiresAt: string;
}

/** Wire shape: RelationshipResponseSchema (#153). No phone field. */
export interface RelationshipWire {
  readonly id: string;
  readonly status: "invited" | "active" | "paused" | "terminated";
  readonly displayName: string | null;
  readonly userAId: string;
  readonly userBId: string;
  readonly invitedAt: string;
  readonly activatedAt: string | null;
}

/** Wire shape: RequestResponseSchema (#153). Amount is minor units + code. */
export interface RequestWire {
  readonly id: string;
  readonly relationshipId: string;
  readonly requestedBy: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly categoryId: string | null;
  readonly description: string;
  readonly tier: string;
  readonly isEmergency: boolean;
  readonly channelOfOrigin: "app" | "whatsapp" | "sms";
  readonly status: "pending" | "approved" | "declined" | "expired";
  readonly resolvedBy: string | null;
  readonly resolvedAt: string | null;
  readonly declineReason: string | null;
}

export type RelationshipAction = "accept" | "pause" | "resume" | "terminate" | "resend-invitation";
export type RequestAction = "approve" | "decline";

export interface SubmitRequestInput {
  readonly amountMinor: string;
  readonly currency: string;
  readonly description: string;
  readonly categoryId?: string | null;
  readonly isEmergency?: boolean;
}

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: FetchImpl;
  /** Override for tests. Defaults to a time+random unique key per attempt. */
  readonly newIdempotencyKey?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function parseOtpChallenge(value: unknown): OtpChallenge {
  if (!isRecord(value) || !isUuid(value.challengeId)) throw new ApiClientError("bad-payload");
  return { challengeId: value.challengeId };
}

function parseSession(value: unknown): Session {
  if (
    !isRecord(value) ||
    !/^[A-Za-z0-9_-]{43}$/.test(typeof value.token === "string" ? value.token : "") ||
    !isUuid(value.userId) ||
    !isIsoDateTime(value.expiresAt)
  ) {
    throw new ApiClientError("bad-payload");
  }
  return { token: value.token as string, userId: value.userId, expiresAt: value.expiresAt };
}

function parseRelationship(value: unknown): RelationshipWire {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !["invited", "active", "paused", "terminated"].includes(value.status as string) ||
    !(value.displayName === null || typeof value.displayName === "string") ||
    !isUuid(value.userAId) ||
    !isUuid(value.userBId) ||
    !isIsoDateTime(value.invitedAt) ||
    !(value.activatedAt === null || isIsoDateTime(value.activatedAt))
  ) {
    throw new ApiClientError("bad-payload");
  }
  return {
    id: value.id,
    status: value.status as RelationshipWire["status"],
    displayName: value.displayName,
    userAId: value.userAId,
    userBId: value.userBId,
    invitedAt: value.invitedAt,
    activatedAt: value.activatedAt,
  };
}

function parseRequest(value: unknown): RequestWire {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isUuid(value.relationshipId) ||
    !isUuid(value.requestedBy) ||
    !isRecord(value.amount) ||
    !/^[1-9]\d{0,18}$/.test(
      typeof value.amount.amountMinor === "string" ? value.amount.amountMinor : "",
    ) ||
    !isNonEmptyString(value.amount.currency) ||
    !(value.categoryId === null || isUuid(value.categoryId)) ||
    !isNonEmptyString(value.description) ||
    !isNonEmptyString(value.tier) ||
    typeof value.isEmergency !== "boolean" ||
    !["app", "whatsapp", "sms"].includes(value.channelOfOrigin as string) ||
    !["pending", "approved", "declined", "expired"].includes(value.status as string) ||
    !(value.resolvedBy === null || isUuid(value.resolvedBy)) ||
    !(value.resolvedAt === null || isIsoDateTime(value.resolvedAt)) ||
    !(value.declineReason === null || typeof value.declineReason === "string")
  ) {
    throw new ApiClientError("bad-payload");
  }
  const amount = value.amount;
  return {
    id: value.id,
    relationshipId: value.relationshipId,
    requestedBy: value.requestedBy,
    amountMinor: amount.amountMinor as string,
    currency: amount.currency as string,
    categoryId: value.categoryId,
    description: value.description,
    tier: value.tier,
    isEmergency: value.isEmergency,
    channelOfOrigin: value.channelOfOrigin as RequestWire["channelOfOrigin"],
    status: value.status as RequestWire["status"],
    resolvedBy: value.resolvedBy,
    resolvedAt: value.resolvedAt,
    declineReason: value.declineReason,
  };
}

let keyCounter = 0;

function defaultIdempotencyKey(): string {
  keyCounter += 1;
  return `${String(Date.now())}-${String(keyCounter)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface ApiClient {
  requestOtp(phone: string): Promise<OtpChallenge>;
  verifyOtp(challengeId: string, code: string): Promise<Session>;
  revokeSession(token: string): Promise<void>;
  listRelationships(token: string): Promise<readonly RelationshipWire[]>;
  getRelationship(token: string, id: string): Promise<RelationshipWire>;
  inviteRelationship(
    token: string,
    input: { phone: string; displayName?: string },
  ): Promise<{ id: string }>;
  actOnRelationship(token: string, id: string, action: RelationshipAction): Promise<void>;
  listRequests(token: string, relationshipId: string): Promise<readonly RequestWire[]>;
  getRequest(token: string, id: string): Promise<RequestWire>;
  submitRequest(
    token: string,
    relationshipId: string,
    input: SubmitRequestInput,
  ): Promise<{ id: string; tier: string }>;
  resolveRequest(token: string, id: string, action: RequestAction, reason?: string): Promise<void>;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl: FetchImpl =
    options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const newKey = options.newIdempotencyKey ?? defaultIdempotencyKey;

  async function call<T>(
    path: string,
    init: {
      method: string;
      token?: string;
      body?: unknown;
      write?: boolean;
      parse: (value: unknown) => T;
    },
  ): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
    if (init.write === true) headers["idempotency-key"] = newKey();
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new ApiClientError("offline");
    }
    if (response.status === 401) throw new ApiClientError("unauthorized", 401);
    if (response.status === 404) throw new ApiClientError("not-found", 404);
    if (response.status === 400) throw new ApiClientError("bad-request", 400);
    if (response.status === 409) throw new ApiClientError("conflict", 409);
    if (response.status < 200 || response.status >= 300) {
      throw new ApiClientError("server", response.status);
    }
    if (response.status === 204) return undefined as T;
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ApiClientError("bad-payload");
    }
    return init.parse(json);
  }

  function parseId(value: unknown): { id: string } {
    if (!isRecord(value) || !isUuid(value.id)) throw new ApiClientError("bad-payload");
    return { id: value.id };
  }

  function parseIdAndTier(value: unknown): { id: string; tier: string } {
    if (!isRecord(value) || !isUuid(value.id) || !isNonEmptyString(value.tier)) {
      throw new ApiClientError("bad-payload");
    }
    return { id: value.id, tier: value.tier };
  }

  function parseRelationshipList(value: unknown): readonly RelationshipWire[] {
    if (!Array.isArray(value)) throw new ApiClientError("bad-payload");
    return value.map(parseRelationship);
  }

  function parseRequestList(value: unknown): readonly RequestWire[] {
    if (!Array.isArray(value)) throw new ApiClientError("bad-payload");
    return value.map(parseRequest);
  }

  return {
    requestOtp: (phone: string) =>
      call("/auth/otp/request", { method: "POST", body: { phone }, parse: parseOtpChallenge }),
    verifyOtp: (challengeId: string, code: string) =>
      call("/auth/otp/verify", {
        method: "POST",
        body: { challengeId, code },
        parse: parseSession,
      }),
    revokeSession: (token: string) =>
      call("/auth/session/revoke", {
        method: "POST",
        token,
        body: {},
        write: true,
        parse: () => undefined,
      }),
    listRelationships: (token: string) =>
      call("/relationships", { method: "GET", token, parse: parseRelationshipList }),
    getRelationship: (token: string, id: string) =>
      call(`/relationships/${id}`, { method: "GET", token, parse: parseRelationship }),
    inviteRelationship: (token: string, input: { phone: string; displayName?: string }) =>
      call("/relationships/invite", {
        method: "POST",
        token,
        body: input,
        write: true,
        parse: parseId,
      }),
    actOnRelationship: (token: string, id: string, action: RelationshipAction) =>
      call(`/relationships/${id}/${action}`, {
        method: "POST",
        token,
        body: {},
        write: true,
        parse: () => undefined,
      }),
    listRequests: (token: string, relationshipId: string) =>
      call(`/relationships/${relationshipId}/requests`, {
        method: "GET",
        token,
        parse: parseRequestList,
      }),
    getRequest: (token: string, id: string) =>
      call(`/requests/${id}`, { method: "GET", token, parse: parseRequest }),
    submitRequest: (token: string, relationshipId: string, input: SubmitRequestInput) =>
      call(`/relationships/${relationshipId}/requests`, {
        method: "POST",
        token,
        body: {
          amount: { amountMinor: input.amountMinor, currency: input.currency },
          description: input.description,
          categoryId: input.categoryId ?? null,
          isEmergency: input.isEmergency ?? false,
        },
        write: true,
        parse: parseIdAndTier,
      }),
    resolveRequest: (token: string, id: string, action: RequestAction, reason?: string) =>
      call(`/requests/${id}/${action}`, {
        method: "POST",
        token,
        body: action === "decline" ? { reason: reason ?? "" } : {},
        write: true,
        parse: () => undefined,
      }),
  };
}
