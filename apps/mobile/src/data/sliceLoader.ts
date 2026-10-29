import type { ApiClient, RelationshipWire, RequestWire } from "./apiClient";
import type { ApprovalData, RelationshipsData, RelationshipItem } from "./types";

/**
 * Async loaders for the S5 vertical slice (K2.52): the route containers
 * fetch through these, hold a screenState, and pass a sync snapshot
 * provider to the screen. The sync ScreenDataProvider interface is
 * unchanged — the async boundary lives in the route, not the screen.
 *
 * Honesty rules, per the S5 contract decisions (Claude, 2026-10-27):
 * - The phone line appears only when the API supplies inviteePhoneE164
 *   (inviter-only). Absent means "not your view", never "no phone".
 * - The approval amount is amountDisplay, the server-formatted string.
 *   When the server has not supplied it yet, loadApproval returns null
 *   and the route renders its error state — never minor units, never
 *   a client-side format (issue #12).
 * - The API serves no role label, no category lookup, and no plan/cap
 *   data, so those ApprovalData fields are omitted and the screen hides
 *   those blocks rather than showing invented copy.
 * - Nothing here logs display names, phones, or amounts.
 */

/** P2.2 invitation window: invitedAt + 14 days (db/migrations/0004). */
function expiresAtISO(invitedAtISO: string): string {
  return new Date(new Date(invitedAtISO).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
}

export function mapRelationship(wire: RelationshipWire): RelationshipItem {
  return {
    id: wire.id,
    displayName: wire.displayName ?? "",
    ...(wire.inviteePhoneE164 === null ? {} : { phoneE164: wire.inviteePhoneE164 }),
    status: wire.status,
    invitedAtISO: wire.invitedAt,
    expiresAtISO: expiresAtISO(wire.invitedAt),
  };
}

export async function loadRelationships(
  client: ApiClient,
  token: string,
): Promise<RelationshipsData> {
  const wires = await client.listRelationships(token);
  return { relationships: wires.map(mapRelationship) };
}

export async function inviteRelationship(
  client: ApiClient,
  token: string,
  phoneE164: string,
  displayName: string,
): Promise<void> {
  await client.inviteRelationship(token, { phone: phoneE164, displayName });
}

/**
 * Loads one request for the Approval screen. Returns null when the
 * server has not supplied amountDisplay yet (the API PR adding it is
 * still open): the route renders its error state in that case.
 */
export async function loadApproval(
  client: ApiClient,
  token: string,
  requestId: string,
): Promise<ApprovalData | null> {
  const request: RequestWire = await client.getRequest(token, requestId);
  if (request.amountDisplay === null) {
    return null;
  }
  const relationship: RelationshipWire = await client.getRelationship(
    token,
    request.relationshipId,
  );
  return {
    recipientName: relationship.displayName ?? "",
    purpose: request.description,
    amountText: request.amountDisplay,
  };
}
