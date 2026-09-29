import { defineStateMachine } from "../audit/index.js";
import type { RelationshipStatus } from "./schema.js";

/**
 * The relationship lifecycle.
 *
 * `invited -> invited` is the resend: the ticket says an invitation "may be
 * resent", and modelling that as a declared self-transition means it goes
 * through the same audited path as every other change rather than being a
 * quiet UPDATE beside it.
 *
 * `terminated` is terminal. PRD section 10: either party can end a
 * relationship, history is retained and remains viewable by both, and no new
 * requests are permitted. Reviving one would make that promise unenforceable.
 */
export const relationshipMachine = defineStateMachine<RelationshipStatus>({
  entityType: "relationship",
  transitions: {
    invited: ["invited", "active", "terminated"],
    active: ["paused", "terminated"],
    paused: ["active", "terminated"],
    terminated: [],
  },
});
