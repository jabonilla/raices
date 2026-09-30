import type { OutboxEntry, OutboxSender } from "./types.js";

/**
 * UUID v4 generator. Uses Math.random — these keys need uniqueness for
 * idempotency, not cryptographic strength. (Hermes doesn't reliably
 * provide crypto.randomUUID, and pulling in expo-crypto for one call is
 * overkill at this stage.)
 */
function newIdempotencyKey(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * The outbox (K2.31): a durable queue of outbound requests.
 *
 * - `enqueue` generates the idempotency key at compose time and persists
 *   the entry before returning. The caller gets the key.
 * - `drain` sends pending entries via the provided sender. Entries are
 *   marked `sending` BEFORE the network call; on success they're removed,
 *   on failure they return to `pending` for the next drain.
 * - Crash safety: if the app dies mid-send, the entry is left as `sending`.
 *   `load()` (called at boot) resets `sending` entries to `pending` — the
 *   retry carries the SAME idempotency key, so the server dedupes it and
 *   the effect is exactly-once.
 * - The outbox never sends two entries concurrently; drains are serialized
 *   so a slow network can't duplicate sends.
 */
export class Outbox {
  private entries: OutboxEntry[] = [];
  private draining = false;
  private loaded = false;
  /** Serializes enqueue operations to prevent read-modify-write races. */
  private enqueueQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: {
      getItem(key: string): Promise<string | null>;
      setItem(key: string, value: string): Promise<void>;
      removeItem(key: string): Promise<void>;
    },
    private readonly storageKey: string = "@raices/outbox",
  ) {}

  /**
   * Load persisted entries. Resets any `sending` entries to `pending`
   * (they were interrupted by an app kill — safe to retry with the same key).
   * Idempotent; call once at boot.
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const raw = await this.store.getItem(this.storageKey);
    if (raw === null) return;
    const parsed = JSON.parse(raw) as OutboxEntry[];
    const next = parsed.map((e) =>
      e.status === "sending" ? { ...e, status: "pending" as const } : e,
    );
    await this.store.setItem(this.storageKey, JSON.stringify(next));
    this.entries = next;
  }

  /**
   * Compose a request: generate the idempotency key, persist, return the key.
   *
   * Atomic: if persistence fails (e.g., storage full), the in-memory state
   * is unchanged and the error propagates to the caller. The request is
   * never silently dropped, and memory never diverges from disk.
   *
   * Serialized: concurrent enqueues are queued to prevent read-modify-write
   * races on the entries array.
   */
  async enqueue(request: {
    method: OutboxEntry["method"];
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
  }): Promise<string> {
    // Serialize enqueues through a promise chain.
    const result = this.enqueueQueue.then(() => this.doEnqueue(request));
    // Keep the chain alive even if this enqueue fails.
    this.enqueueQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async doEnqueue(request: {
    method: OutboxEntry["method"];
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
  }): Promise<string> {
    const entry: OutboxEntry = {
      id: newIdempotencyKey(),
      method: request.method,
      url: request.url,
      headers: request.headers ?? {},
      body: request.body,
      composedAt: new Date().toISOString(),
      attempts: 0,
      status: "pending",
    };
    // Persist BEFORE mutating in-memory state. If setItem throws
    // (storage full), this.entries is untouched and the caller sees
    // the failure — no silent loss, no divergence.
    const next = [...this.entries, entry];
    await this.store.setItem(this.storageKey, JSON.stringify(next));
    this.entries = next;
    return entry.id;
  }

  /** Number of entries awaiting send. */
  get pendingCount(): number {
    return this.entries.filter((e) => e.status === "pending").length;
  }

  /**
   * Send all pending entries via `sender`, in compose order. Serialized:
   * a concurrent drain call waits for the in-flight one. Returns the number
   * of entries successfully sent.
   *
   * Persistence is atomic: state transitions are persisted BEFORE the
   * in-memory array is updated. If persistence fails (storage full), the
   * drain aborts with the error — in-memory state matches disk, and the
   * caller sees the failure instead of a silent divergence.
   */
  async drain(sender: OutboxSender): Promise<number> {
    while (this.draining) {
      await new Promise((r) => setTimeout(r, 10));
    }
    this.draining = true;
    try {
      let sent = 0;
      // Snapshot the pending entries at drain start; the array may be
      // replaced during the loop.
      const pending = this.entries.filter((e) => e.status === "pending");
      for (const entry of pending) {
        const sending: OutboxEntry = { ...entry, status: "sending", attempts: entry.attempts + 1 };
        await this.atomicReplace(sending);

        const result = await sender(sending);
        if (result.ok) {
          await this.atomicRemove(entry.id);
          sent += 1;
        } else {
          // Back to pending for the next drain, whether retryable or not —
          // dropping a user's composed request silently is worse than
          // retrying it. A dead-letter policy belongs in Phase 3.
          await this.atomicReplace({ ...sending, status: "pending" });
        }
      }
      return sent;
    } finally {
      this.draining = false;
    }
  }

  /**
   * Replace an entry atomically: persist the new array first, then swap
   * the in-memory reference. If persist throws, this.entries is unchanged.
   */
  private async atomicReplace(entry: OutboxEntry): Promise<void> {
    const next = this.entries.map((e) => (e.id === entry.id ? entry : e));
    await this.store.setItem(this.storageKey, JSON.stringify(next));
    this.entries = next;
  }

  /**
   * Remove an entry atomically: persist first, then swap.
   */
  private async atomicRemove(id: string): Promise<void> {
    const next = this.entries.filter((e) => e.id !== id);
    await this.store.setItem(this.storageKey, JSON.stringify(next));
    this.entries = next;
  }
}
