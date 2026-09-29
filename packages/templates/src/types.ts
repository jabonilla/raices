/**
 * Message template catalog types (K2.20).
 *
 * WhatsApp Business requires pre-approved templates for anything sent outside
 * a 24-hour session window, so these templates are product surface, not an
 * implementation detail. The catalog is consumed by the future WhatsApp
 * channel adapter; it performs no network I/O and holds no credentials.
 */

/** The template categories Meta requires at submission time. */
export type MetaTemplateCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";

/** Locales the catalog ships copy for. Spanish-first, per the copy sheet. */
export type TemplateLocale = "es" | "en";

/**
 * The single source of truth for template slots. `TemplateVariables` is
 * derived from this map, so the declared slots and the variables the
 * renderer accepts cannot drift apart.
 *
 * Amounts are opaque strings supplied by the caller. The renderer never
 * formats money (issue #12): whatever string arrives is interpolated
 * verbatim, so `"90071992547409.93"` stays exactly that.
 */
const TEMPLATE_SLOTS = {
  /** Recipient-side: a money request was received and awaits the sender. */
  request_received: ["senderName", "amount", "purpose"],
  /** Recipient-side: the sender approved the request; money is on its way. */
  request_approved: ["senderName", "amount"],
  /** Recipient-side: the sender deferred the request ("ahorita no"). */
  request_declined: ["senderName", "amount"],
  /** Recipient-side: the sender sent money. */
  money_sent: ["senderName", "amount"],
  /** Recipient-side: the money arrived and is available. */
  money_arrived: ["senderName", "amount"],
  /** Prospective recipient: invitation to join Raíces. */
  invitation: ["inviterName"],
} as const;

/**
 * Stable template identifiers. These are the contract with Meta's template
 * registry: once a template is submitted, its id never changes.
 */
export type TemplateId = keyof typeof TEMPLATE_SLOTS;

export const TEMPLATE_IDS = Object.keys(TEMPLATE_SLOTS) as TemplateId[];

/** The variables each template accepts, derived from `TEMPLATE_SLOTS`. */
export type TemplateVariables = {
  [Id in TemplateId]: { [Slot in (typeof TEMPLATE_SLOTS)[Id][number]]: string };
};

/** Declared slot names for a template, in canonical order. */
export function slotsOf(id: TemplateId): readonly string[] {
  return TEMPLATE_SLOTS[id];
}

/**
 * One catalog entry: identity, Meta category, and declared slots.
 * Copy lives in `src/locales/{es,en}.json`, keyed by template id, following
 * the K2.4 i18n conventions (parallel es/en files, `{{slot}}` interpolation).
 */
export interface TemplateDefinition {
  readonly id: TemplateId;
  readonly category: MetaTemplateCategory;
  readonly slots: readonly string[];
}
