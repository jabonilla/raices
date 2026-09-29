/**
 * Notification copy (K2.32).
 *
 * PRIVACY BY CONSTRUCTION: this module builds every notification's
 * title and body, and its function signature accepts NO amount and NO
 * name. There is no parameter to leak through — a lock-screen preview
 * can never show "$25.00 from Maria" because the copy builder never
 * receives "$25.00" or "Maria".
 *
 * Copy lives in the i18n catalogs (en.json / es.json) under the
 * "notifications" key, so translators own the wording and both locales
 * stay in sync.
 */
import type { NotificationEvent } from "./types.js";

type TranslateFn = (key: string) => string;

const COPY_KEYS: Record<NotificationEvent, { title: string; body: string }> = {
  "transfer.received": {
    title: "notifications.transfer_received.title",
    body: "notifications.transfer_received.body",
  },
  "transfer.approved": {
    title: "notifications.transfer_approved.title",
    body: "notifications.transfer_approved.body",
  },
  "transfer.needs_approval": {
    title: "notifications.transfer_needs_approval.title",
    body: "notifications.transfer_needs_approval.body",
  },
  "invite.received": {
    title: "notifications.invite_received.title",
    body: "notifications.invite_received.body",
  },
  "relationship.updated": {
    title: "notifications.relationship_updated.title",
    body: "notifications.relationship_updated.body",
  },
};

/**
 * Build the title and body for an event. Note what's NOT here: no amount,
 * no name, no recipient, no sender. If a future event needs personal data
 * in the copy, that is a product decision for Claude — not a parameter to
 * add quietly.
 */
export function buildNotificationCopy(
  event: NotificationEvent,
  t: TranslateFn,
): { title: string; body: string } {
  const keys = COPY_KEYS[event];
  return { title: t(keys.title), body: t(keys.body) };
}
