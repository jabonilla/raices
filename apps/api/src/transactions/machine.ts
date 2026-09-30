import { defineStateMachine } from "../audit/index.js";
import type { IntentState, SettlementState } from "./schema.js";

/**
 * What the two parties agreed to do.
 *
 * One move: a commitment can be withdrawn, and a withdrawal cannot be taken
 * back. Re-committing would be a new agreement, which is a new request and a
 * new transaction — not a revival of the one that was called off.
 */
export const transactionIntentMachine = defineStateMachine<IntentState>({
  entityType: "transaction_intent",
  transitions: {
    committed: ["cancelled"],
    cancelled: [],
  },
});

/**
 * What the money actually did.
 *
 * Forward through the provider's stages, with `failed` reachable from any of
 * them before it lands. `reversed` only from `settled`, because there is
 * nothing to reverse until something arrived. Both ends are terminal: a
 * failed payout is retried as a new transfer with its own record, so that
 * "this attempt failed" stays true afterwards rather than being overwritten.
 */
export const transactionSettlementMachine = defineStateMachine<SettlementState>({
  entityType: "transaction_settlement",
  transitions: {
    not_started: ["instructed", "failed"],
    instructed: ["in_flight", "failed"],
    in_flight: ["settled", "failed"],
    settled: ["reversed"],
    failed: [],
    reversed: [],
  },
});
