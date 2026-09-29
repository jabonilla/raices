/**
 * Offline request queue (outbox) types (K2.31).
 *
 * A request composed offline must survive app restart and send when
 * connectivity returns, exactly once. The idempotency key is generated on
 * the device at COMPOSE time (when `enqueue` is called), not at send time —
 * so a retry after a crash carries the same key and the server dedupes it.
 */

/** HTTP method for an outbox entry. Only mutating methods are queued. */
export type OutboxMethod = "POST" | "PUT" | "PATCH" | "DELETE";

/** What the caller provides when composing a request. */
export interface OutboxRequest {
  readonly method: OutboxMethod;
  readonly url: string;
  readonly headers?: Record<string, string>;
  /** JSON-serializable body. */
  readonly body?: unknown;
}

/**
 * A queued request, as persisted. The `id` IS the idempotency key: a UUID
 * v4 generated at enqueue time, sent as the `Idempotency-Key` header, and
 * stable across app restarts and retries.
 */
export interface OutboxEntry {
  /** Idempotency key (UUID v4), generated at compose time. */
  readonly id: string;
  readonly method: OutboxMethod;
  readonly url: string;
  readonly headers: Record<string, string>;
  /** JSON-serializable body, or undefined. */
  readonly body?: unknown;
  /** ISO-8601 timestamp of when the request was composed. */
  readonly composedAt: string;
  /** How many send attempts have been made. */
  readonly attempts: number;
  readonly status: OutboxStatus;
}

export type OutboxStatus =
  /** Waiting for connectivity. */
  | "pending"
  /** A send is in flight. If the app dies here, the entry returns to pending on next boot. */
  | "sending"
  /** Sent and acknowledged. Removed from the store. */
  | "sent";

/** Result of a single send attempt. */
export type SendResult =
  { readonly ok: true } | { readonly ok: false; readonly retryable: boolean };

/**
 * Sends one entry over the network. The implementation MUST send the entry's
 * `id` as the `Idempotency-Key` header so the server can dedupe retries.
 * Must never throw — return `{ ok: false }` on any failure.
 */
export type OutboxSender = (entry: OutboxEntry) => Promise<SendResult>;

/** Minimal key-value storage for outbox persistence. */
export interface OutboxStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
