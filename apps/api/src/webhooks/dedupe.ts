/**
 * At-least-once delivery deduplication (K2.28).
 *
 * Providers retry webhooks; the same provider message id must never be
 * processed twice. This store is IN-MEMORY and behind an interface on
 * purpose: the durable store is Claude Code's in Phase 3, and this ticket
 * explicitly does not add a migration or touch `db/`. A process restart
 * loses the seen-set — acceptable for the skeleton, documented here so it
 * is a conscious tradeoff rather than a surprise.
 *
 * P3.1 UPDATE — the durable store now exists in `./inbound.ts`, but this is
 * still what `app.ts` wires in, so a restart still replays.
 *
 * The swap is not a swap. `checkAndMark` is the wrong shape to hold a
 * durable claim: it answers "seen or not" in one step and leaves the caller
 * to do the work in another, and the gap between those two steps is exactly
 * the bug P3.1 exists to prevent — a claim that commits while the work rolls
 * back. `withInboundClaim` therefore takes the work as a callback and runs
 * both in one transaction, which this route can only adopt once it has a
 * transaction to hand over. That belongs with the ticket where the handler
 * stops being a no-op: wrapping a handler that does nothing proves nothing,
 * and would settle the seam before there is anything to put through it.
 */
export interface InboundDeduplicator {
  /**
   * Returns true when `providerMessageId` was already seen (the caller must
   * accept the webhook but ignore it — 200, never 500, never reprocess).
   * Returns false and records the id otherwise.
   */
  checkAndMark(providerMessageId: string): boolean;
}

/** In-memory set. Unbounded by design for the skeleton; Phase 3 persists. */
export class InMemoryInboundDeduplicator implements InboundDeduplicator {
  private readonly seen = new Set<string>();

  checkAndMark(providerMessageId: string): boolean {
    if (this.seen.has(providerMessageId)) {
      return true;
    }
    this.seen.add(providerMessageId);
    return false;
  }
}
