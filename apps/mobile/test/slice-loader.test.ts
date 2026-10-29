import { describe, expect, it, vi } from "vitest";

import { createApiClient, type ApiClient } from "../src/data/apiClient";
import { loadApproval, loadRelationships, mapRelationship } from "../src/data/sliceLoader";

const TOKEN = "Bearer abcdefghijklmnopqrstuvwxyzabcdefghijklmnop";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientWith(fetchImpl: (input: string) => Promise<Response>): ApiClient {
  return createApiClient({
    baseUrl: "https://api.example",
    fetchImpl: (input: string | URL | Request) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return fetchImpl(url);
    },
  });
}

const RELATIONSHIP = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "active" as const,
  displayName: "Mamá",
  userAId: "22222222-2222-4222-8222-222222222222",
  userBId: "33333333-3333-4333-8333-333333333333",
  invitedAt: "2026-10-01T00:00:00.000Z",
  activatedAt: "2026-10-02T00:00:00.000Z",
};

const REQUEST = {
  id: "44444444-4444-4444-8444-444444444444",
  relationshipId: RELATIONSHIP.id,
  requestedBy: RELATIONSHIP.userAId,
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

describe("sliceLoader", () => {
  it("maps a relationship wire, deriving the 14-day expiry", () => {
    const item = mapRelationship({ ...RELATIONSHIP, inviteePhoneE164: "+50255550100" });
    expect(item.id).toBe(RELATIONSHIP.id);
    expect(item.displayName).toBe("Mamá");
    expect(item.phoneE164).toBe("+50255550100");
    expect(item.invitedAtISO).toBe("2026-10-01T00:00:00.000Z");
    expect(item.expiresAtISO).toBe("2026-10-15T00:00:00.000Z");
  });

  it("omits the phone line when the viewer is not the inviter", () => {
    const item = mapRelationship({ ...RELATIONSHIP, inviteePhoneE164: null });
    expect(item.phoneE164).toBeUndefined();
  });

  it("loads the relationship list from the API", async () => {
    const client = clientWith(() => Promise.resolve(jsonResponse(200, [RELATIONSHIP])));
    const data = await loadRelationships(client, TOKEN);
    expect(data.relationships).toHaveLength(1);
    expect(data.relationships[0]?.phoneE164).toBeUndefined();
  });

  it("loads an approval from amountDisplay, never minor units", async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url.endsWith(`/relationships/${RELATIONSHIP.id}`)) {
        return Promise.resolve(jsonResponse(200, RELATIONSHIP));
      }
      return Promise.resolve(jsonResponse(200, { ...REQUEST, amountDisplay: "Q200.00" }));
    });
    const client = clientWith(fetchImpl);
    const approval = await loadApproval(client, TOKEN, REQUEST.id);
    expect(approval).not.toBeNull();
    expect(approval?.amountText).toBe("Q200.00");
    expect(approval?.recipientName).toBe("Mamá");
    expect(approval?.purpose).toBe("Medicinas");
    expect(approval?.planMatchText).toBeUndefined();
    expect(approval?.categoryLabel).toBeUndefined();
  });

  it("returns null when the server has not supplied amountDisplay yet", async () => {
    const client = clientWith(() => Promise.resolve(jsonResponse(200, REQUEST)));
    const approval = await loadApproval(client, TOKEN, REQUEST.id);
    expect(approval).toBeNull();
  });
});
