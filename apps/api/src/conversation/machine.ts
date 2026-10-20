import { defineStateMachine } from "../audit/index.js";
import type { ConversationState } from "./schema.js";

/**
 * The conversation state machine.
 *
 * Note what is absent: there is no edge from one pending state to another.
 * Replacing a proposal in place would overwrite it with no record that the
 * first one was ever dropped, and "what happened to the thing I said yes to"
 * is exactly the question this table has to be able to answer. Proposing
 * something new therefore returns to `idle` first, and both moves are
 * audited.
 */
export const conversationMachine = defineStateMachine<ConversationState>({
  entityType: "conversation",
  transitions: {
    idle: ["awaiting_disambiguation", "awaiting_confirmation", "awaiting_arrival_confirmation"],
    awaiting_disambiguation: ["idle"],
    awaiting_confirmation: ["idle"],
    awaiting_arrival_confirmation: ["idle"],
  },
});

/** One relationship an inbound message from a given phone could concern. */
export interface RelationshipCandidate {
  readonly relationshipId: string;
  readonly counterpartyUserId: string;
}

export type InboundRouting =
  /** Exactly one relationship. Safe to act on. */
  | { readonly kind: "routed"; readonly relationshipId: string }
  /** More than one. We ask; we do not pick. */
  | { readonly kind: "ambiguous"; readonly candidates: readonly RelationshipCandidate[] }
  /** The number is not in any relationship we know about. */
  | { readonly kind: "unknown" };

/**
 * Decide which relationship an inbound message concerns.
 *
 * A phone may belong to a user with several relationships — a recipient
 * receiving from two siblings, say. When more than one is possible this
 * returns `ambiguous` and the caller asks. It deliberately does not rank,
 * score, or prefer the most recent: every tie-break here is a guess about
 * whose money is being discussed, and a wrong guess attaches a request to
 * the wrong family member.
 *
 * Pure, so the decision is testable without a database and cannot quietly
 * grow a lookup that makes it "smarter".
 */
export function routeInbound(candidates: readonly RelationshipCandidate[]): InboundRouting {
  const only = candidates[0];
  if (only === undefined) return { kind: "unknown" };
  if (candidates.length > 1) return { kind: "ambiguous", candidates };
  return { kind: "routed", relationshipId: only.relationshipId };
}
