/**
 * At-least-once delivery deduplication (K2.28).
 *
 * Providers retry webhooks; the same provider message id must never be
 * processed twice. This store is IN-MEMORY and behind an interface on
 * purpose: the durable store is Claude Code's in Phase 3, and this ticket
 * explicitly does not add a migration or touch `db/`. A process restart
 * loses the seen-set — acceptable for the skeleton, documented here so it
 * is a conscious tradeoff rather than a surprise.
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
