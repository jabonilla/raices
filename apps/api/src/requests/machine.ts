import { defineStateMachine } from "../audit/index.js";
import type { RequestStatus } from "./schema.js";

/**
 * The request lifecycle.
 *
 * Every resolution is terminal. PRD section 10 says a recipient "may resubmit
 * once with additional context" after a decline — that is a new request, not
 * a revival of this one. Reopening a resolved request would mean the record
 * of what was decided, and of what the sender was told, could change
 * afterwards.
 *
 * `expired` is the absence of a decision rather than one: nobody resolved it
 * in time. It is terminal for the same reason.
 */
export const requestMachine = defineStateMachine<RequestStatus>({
  entityType: "request",
  transitions: {
    pending: ["approved", "declined", "expired"],
    approved: [],
    declined: [],
    expired: [],
  },
});
