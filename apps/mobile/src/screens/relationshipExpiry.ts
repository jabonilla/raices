/**
 * Invitation-expiry helpers (K2.27), shared by the relationship list and
 * detail screens so both render the same countdown.
 *
 * P2.2 derives expiry as invitedAt + 14 days (db/migrations/0004); the data
 * layer carries `expiresAtISO` and these helpers only compare it against the
 * clock. An invitation whose status is still "invited" but whose expiry has
 * passed is EXPIRED: visibly expired with a resend action, never a
 * dead-looking row.
 */

/** True when the invitation window has closed. */
export function isInvitationExpired(expiresAtISO: string, nowMs: number = Date.now()): boolean {
  return nowMs >= new Date(expiresAtISO).getTime();
}

/**
 * Whole days remaining before expiry, for the "Vence en N días" line.
 * Callers must check `isInvitationExpired` first: this returns 0 past expiry.
 */
export function fullDaysRemaining(expiresAtISO: string, nowMs: number = Date.now()): number {
  const ms = new Date(expiresAtISO).getTime() - nowMs;
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

/**
 * Whole hours remaining, for the boundary case under 24 hours
 * ("Vence en N horas"). At least 1: anything past expiry is expired, not
 * "0 hours".
 */
export function fullHoursRemaining(expiresAtISO: string, nowMs: number = Date.now()): number {
  const ms = new Date(expiresAtISO).getTime() - nowMs;
  return Math.max(1, Math.floor(ms / (60 * 60 * 1000)));
}

/**
 * Numeric date without Intl: Hermes' Intl support is unreliable (issue #12),
 * and a DD/MM/YYYY numeral string is unambiguous for the es locale. Padded
 * so 5/3/2026 never renders.
 */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${String(d.getFullYear())}`;
}
