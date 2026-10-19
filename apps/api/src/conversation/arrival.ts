import type { AffirmativeOutcome } from "./conversation.js";

/**
 * Arrival evidence (ADR-002).
 *
 * We facilitate; we do not transmit. The provider moves the money and is
 * authoritative for whether it settled, so our evidence that it *arrived*
 * comes from asking the person who was supposed to receive it.
 *
 * ADR-002 orders the sources deliberately, and requires that they be
 * pluggable the way settlement is — so bank data can become one more source
 * later rather than a foundation that has to be dug out. Only
 * `recipient_confirmation` is implemented here; the rest are named so the
 * seam exists and nothing has to be reshaped to add them.
 */
export type ArrivalEvidenceSource =
  /** "¿Ya recibiste los Q200?" → "Sí". Primary, per ADR-002. */
  | "recipient_confirmation"
  /** Fallback, for when the recipient does not answer. */
  | "sender_self_report"
  /** Where the partner exposes it. */
  | "provider_status"
  /** Optional, later, never required. */
  | "bank_data";

export interface ArrivalEvidence {
  readonly source: ArrivalEvidenceSource;
  readonly transactionId: string;
  readonly confirmedAt: Date;
}

/** The payload shape an arrival check puts in the pending context. */
interface ArrivalCheckPayload {
  readonly kind: "arrival_check";
  readonly transactionId: string;
}

function isArrivalCheck(payload: unknown): payload is ArrivalCheckPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const record = payload as Record<string, unknown>;
  return record["kind"] === "arrival_check" && typeof record["transactionId"] === "string";
}

/**
 * Read a recipient's affirmative as evidence that money arrived.
 *
 * Returns null rather than evidence in every case where the affirmative was
 * not unambiguously an answer to an arrival question:
 *
 * - the context had expired, so we do not know what she was answering
 * - she was answering something else, such as a request draft
 * - the payload is not an arrival check
 *
 * The expired case is the one that matters most. ADR-002 makes this the
 * primary evidence that money reached someone, and evidence attached to a
 * question the person may not have been answering is worse than no evidence,
 * because it gets recorded as a fact and then contradicts the provider with
 * false confidence.
 */
export function recipientArrivalEvidence(
  outcome: AffirmativeOutcome,
  options: { readonly confirmedAt: Date },
): ArrivalEvidence | null {
  if (!outcome.attached) return null;
  if (outcome.from !== "awaiting_arrival_confirmation") return null;
  if (!isArrivalCheck(outcome.payload)) return null;

  return {
    source: "recipient_confirmation",
    transactionId: outcome.payload.transactionId,
    confirmedAt: options.confirmedAt,
  };
}
