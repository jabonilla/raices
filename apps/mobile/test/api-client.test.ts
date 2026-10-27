import { describe, expect, it, vi } from "vitest";

import { ApiClientError, createApiClient } from "../src/data/apiClient";

const TOKEN = "a".repeat(43);
const REL_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const RELATIONSHIP_WIRE = {
  id: REL_ID,
  status: "invited",
  displayName: "Mamá",
  userAId: USER_ID,
  userBId: "33333333-3333-4333-8333-333333333333",
  invitedAt: "2026-10-20T00:00:00.000Z",
  activatedAt: null,
};

const REQUEST_WIRE = {
  id: "44444444-4444-4444-8444-444444444444",
  relationshipId: REL_ID,
  requestedBy: "33333333-3333-4333-8333-333333333333",
  amount: { amountMinor: "20000", currency: "GTQ" },
  categoryId: null,
  description: "Medicinas",
  tier: "standard",
  isEmergency: false,
  channelOfOrigin: "app",
  status: "pending",
  resolvedBy: null,
  resolvedAt: null,
  declineReason: null,
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("apiClient (S5)", () => {
  it("requests an OTP challenge and returns the challenge id", async () => {
    let captured: { url: string; init: RequestInit | undefined } | undefined;
    const fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = (url, init) => {
      captured = { url, init };
      return Promise.resolve(jsonResponse(202, { challengeId: REL_ID }));
    };
    const client = createApiClient({ baseUrl: "https://api.example", fetchImpl });
    await expect(client.requestOtp("+50255550100")).resolves.toEqual({ challengeId: REL_ID });
    expect(captured?.url).toBe("https://api.example/auth/otp/request");
    expect(captured?.init?.method).toBe("POST");
    const bodyText = captured?.init?.body;
    if (typeof bodyText !== "string") throw new Error("expected a JSON string body");
    const body = JSON.parse(bodyText) as { phone: string };
    expect(body).toEqual({ phone: "+50255550100" });
  });

  it("verifies an OTP code and returns the session", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse(200, { token: TOKEN, userId: USER_ID, expiresAt: "2026-10-27T00:00:00.000Z" }),
      ),
    );
    const client = createApiClient({ baseUrl: "https://api.example", fetchImpl });
    await expect(client.verifyOtp(REL_ID, "123456")).resolves.toEqual({
      token: TOKEN,
      userId: USER_ID,
      expiresAt: "2026-10-27T00:00:00.000Z",
    });
  });

  it("sends the bearer token on authenticated reads", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = (_url, init) => {
      capturedInit = init;
      return Promise.resolve(jsonResponse(200, [RELATIONSHIP_WIRE]));
    };
    const client = createApiClient({ baseUrl: "https://api.example", fetchImpl });
    await expect(client.listRelationships(TOKEN)).resolves.toHaveLength(1);
    expect((capturedInit?.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("sends an idempotency key on writes", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = (_url, init) => {
      capturedInit = init;
      return Promise.resolve(jsonResponse(200, { id: REL_ID }));
    };
    const client = createApiClient({
      baseUrl: "https://api.example",
      fetchImpl,
      newIdempotencyKey: () => "fixed-key-1",
    });
    await client.inviteRelationship(TOKEN, { phone: "+50255550100", displayName: "Mamá" });
    expect((capturedInit?.headers as Record<string, string>)["idempotency-key"]).toBe(
      "fixed-key-1",
    );
  });

  it("maps a request wire payload to minor units plus currency, never a formatted amount", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(200, REQUEST_WIRE)));
    const client = createApiClient({ baseUrl: "https://api.example", fetchImpl });
    const request = await client.getRequest(TOKEN, REQUEST_WIRE.id);
    expect(request.amountMinor).toBe("20000");
    expect(request.currency).toBe("GTQ");
    expect(request.description).toBe("Medicinas");
    expect(request.status).toBe("pending");
  });

  it("maps a 401 to unauthorized and a network failure to offline", async () => {
    const unauth = createApiClient({
      baseUrl: "https://api.example",
      fetchImpl: () => Promise.resolve(jsonResponse(401, { error: "nope" })),
    });
    await expect(unauth.listRelationships(TOKEN)).rejects.toMatchObject({ kind: "unauthorized" });

    const offline = createApiClient({
      baseUrl: "https://api.example",
      fetchImpl: () => Promise.reject(new Error("network down")),
    });
    await expect(offline.listRelationships(TOKEN)).rejects.toMatchObject({ kind: "offline" });
  });

  it("rejects a payload that does not match the wire shape", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { ...RELATIONSHIP_WIRE, status: "bogus" })),
    );
    const client = createApiClient({ baseUrl: "https://api.example", fetchImpl });
    await expect(client.listRelationships(TOKEN)).rejects.toMatchObject({ kind: "bad-payload" });
  });

  it("never puts the token in an error message", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(500, { error: "boom" })));
    const client = createApiClient({ baseUrl: "https://api.example", fetchImpl });
    try {
      await client.listRelationships(TOKEN);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);
      expect((error as Error).message).not.toContain(TOKEN);
    }
  });
});
