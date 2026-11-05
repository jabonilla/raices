import { money, type Money } from "@raices/money";
import type { Kysely } from "kysely";

import type { Channel } from "../audit/schema.js";
import {
  declinePendingContext,
  openPendingContext,
  resolveAffirmative,
  type ConversationDatabase,
} from "../conversation/index.js";
import { submitRequest, type RequestDatabase } from "../requests/index.js";
import type { Tier } from "../requests/tier/index.js";
import { parseInboundMessage, type Ambiguity } from "./parse/index.js";
import {
  clarificationReply,
  confirmationReply,
  declinedReply,
  expiredReply,
  nothingPendingReply,
  requestCreatedReply,
  unparseableReply,
} from "./reply.js";

/**
 * P3.3 — turning an inbound message into a request, or into a question.
 *
 * This is the impure half: the parser decided what the message says, and
 * this decides what to do about it. The division is the point — everything
 * that reads the message is table-testable without a database, and
 * everything that writes is here.
 *
 * Two rules from the ticket govern the shape:
 *
 * - **The channel is an input path, not a shortcut past the rules.** A
 *   request born from WhatsApp goes through `submitRequest` exactly as one
 *   born in the app does, so P2.4 classification, the cap window and the
 *   approval gate all apply unchanged. Nothing here sets a tier or skips a
 *   check.
 * - **When confidence is low, confirm.** Anything the parser would not
 *   commit to becomes a pending context with a deadline (P3.2) and a reply
 *   in Spanish, and no row is written until an explicit yes arrives.
 */

/** What a confirmation remembers, so a later "sí" can become a request. */
export interface RequestDraftPayload {
  readonly kind: "request_draft";
  readonly amountMinor: string;
  readonly currency: string;
  readonly purpose: string | null;
  readonly requestedBy: string;
}

/** A confirmation we cannot turn into anything; the person must restate. */
interface ClarificationPayload {
  readonly kind: "clarification";
  readonly reason: Ambiguity;
}

export type InboundOutcome =
  | {
      readonly kind: "request_created";
      readonly requestId: string;
      readonly tier: Tier;
      readonly reply: string;
    }
  | { readonly kind: "confirmation_requested"; readonly reason: Ambiguity; readonly reply: string }
  | { readonly kind: "confirmation_declined"; readonly reply: string }
  | { readonly kind: "confirmation_expired"; readonly reply: string }
  | { readonly kind: "no_action"; readonly reply: string };

export interface HandleInboundInput {
  readonly relationshipId: string;
  /** The person who sent the message — the one asking for money. */
  readonly requestedBy: string;
  readonly channel: Channel;
  readonly text: string;
  /** What the sender is called, for the reply. Never inferred. */
  readonly senderName?: string | null;
  readonly now?: Date | undefined;
}

type MessagingDatabase = ConversationDatabase & RequestDatabase;

/** The default description when somebody names a sum but no purpose. */
const NO_PURPOSE_DESCRIPTION = "Solicitud por WhatsApp";

function isRequestDraft(payload: unknown): payload is RequestDraftPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const record = payload as Record<string, unknown>;
  return (
    record["kind"] === "request_draft" &&
    typeof record["amountMinor"] === "string" &&
    typeof record["currency"] === "string" &&
    typeof record["requestedBy"] === "string"
  );
}

/**
 * Create the request. The only place in this module that writes one, and it
 * goes through `submitRequest` so the channel buys no exemption from P2.4.
 */
async function createRequest<DB extends MessagingDatabase>(
  db: Kysely<DB>,
  input: HandleInboundInput,
  amount: Money,
  purpose: string | null,
  requestedBy: string,
): Promise<InboundOutcome> {
  const submitted = await submitRequest(db, {
    relationshipId: input.relationshipId,
    requestedBy,
    amount,
    categoryId: null,
    description: purpose ?? NO_PURPOSE_DESCRIPTION,
    channelOfOrigin: input.channel,
    ...(input.now === undefined ? {} : { now: input.now }),
  });

  return {
    kind: "request_created",
    requestId: submitted.id,
    tier: submitted.tier,
    reply: requestCreatedReply(amount, input.senderName ?? null),
  };
}

/**
 * Handle one inbound message.
 *
 * Every branch returns a reply. There is no path that answers with silence
 * or with an error code, which is the ticket's rule for anything we cannot
 * read.
 */
export async function handleInboundMessage<DB extends MessagingDatabase>(
  db: Kysely<DB>,
  input: HandleInboundInput,
): Promise<InboundOutcome> {
  const parsed = parseInboundMessage(input.text);
  const actor = { kind: "user", id: input.requestedBy } as const;
  const context = {
    relationshipId: input.relationshipId,
    channel: input.channel,
    actor,
  };

  switch (parsed.kind) {
    case "affirmative": {
      // P3.2 decides whether the yes still counts. An expired context
      // returns `expired` and clears itself, so nothing is created — which
      // is the whole reason the deadline exists.
      const outcome = await resolveAffirmative(db, context);
      if (!outcome.attached) {
        return outcome.reason === "expired"
          ? { kind: "confirmation_expired", reply: expiredReply() }
          : { kind: "no_action", reply: nothingPendingReply() };
      }
      if (!isRequestDraft(outcome.payload)) {
        // A yes to a question that was never answerable as a request. The
        // context is consumed; we ask again rather than invent a draft.
        return { kind: "no_action", reply: nothingPendingReply() };
      }
      const draft = outcome.payload;
      return createRequest(
        db,
        input,
        money(BigInt(draft.amountMinor), "GTQ"),
        draft.purpose,
        draft.requestedBy,
      );
    }

    case "negative": {
      const outcome = await declinePendingContext(db, context);
      return outcome.discarded
        ? { kind: "confirmation_declined", reply: declinedReply() }
        : { kind: "no_action", reply: nothingPendingReply() };
    }

    case "request":
      return createRequest(db, input, parsed.money, parsed.purpose, input.requestedBy);

    case "confirm": {
      // Exactly one candidate means we know the number and are only
      // checking it, so the confirmation can carry a draft. Anything else
      // needs the person to restate, and a bare "sí" to it creates nothing.
      const only = parsed.candidates.length === 1 ? parsed.candidates[0] : undefined;
      const resolvable = only !== undefined && parsed.reason === "approximate";

      const payload: RequestDraftPayload | ClarificationPayload = resolvable
        ? {
            kind: "request_draft",
            amountMinor: only.amount.toString(),
            currency: only.currency,
            purpose: parsed.purpose,
            requestedBy: input.requestedBy,
          }
        : { kind: "clarification", reason: parsed.reason };

      await openPendingContext(db, {
        ...context,
        state: "awaiting_confirmation",
        payload,
        ...(input.now === undefined ? {} : { proposedAt: input.now }),
      });

      return {
        kind: "confirmation_requested",
        reason: parsed.reason,
        reply: resolvable
          ? confirmationReply({
              money: only,
              purpose: parsed.purpose,
              senderName: input.senderName ?? null,
            })
          : clarificationReply(parsed.reason, parsed.candidates),
      };
    }

    case "unparseable":
      return { kind: "no_action", reply: unparseableReply() };
  }
}
