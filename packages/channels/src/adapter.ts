import type {
  InboundMessage,
  DeliveryUpdate,
  OutboundMessage,
  SentReceipt,
  WebhookEvent,
} from "./types.js";

/**
 * The single seam between Raíces and any messaging provider.
 *
 * Implementations translate provider specifics (webhook envelopes, status
 * vocabularies, auth) into the normalized types; business logic is written
 * only against this interface and must never branch on which implementation
 * backs it.
 *
 * Contract:
 * - `send` resolves once the provider accepts the message, not on delivery.
 *   Delivery progress arrives later through `onDeliveryUpdate` handlers.
 * - `normalizeWebhook` never throws: unrecognized payloads become
 *   `{ type: "unknown" }` for the caller to log and ignore.
 * - Inbound dispatch is idempotent by `providerMessageId`: the same provider
 *   message delivered twice (retried webhook, duplicate POST) reaches
 *   `onInbound` handlers at most once.
 * - Delivery updates are forwarded in the order the provider reports them,
 *   including out-of-order arrivals. Ordering policy belongs to the consumer.
 */
export interface ChannelAdapter {
  /** Opaque channel name, e.g. "whatsapp". For routing/telemetry only. */
  readonly channel: string;

  /** Hand a message to the provider. Resolves with the provider's id. */
  send(message: OutboundMessage): Promise<SentReceipt>;

  /** Normalize one raw provider webhook payload. Never throws. */
  normalizeWebhook(raw: unknown): WebhookEvent;

  /** Register an inbound-message handler. Handlers run in registration order. */
  onInbound(handler: (message: InboundMessage) => Promise<void>): void;

  /** Register a delivery-update handler. Handlers run in registration order. */
  onDeliveryUpdate(handler: (update: DeliveryUpdate) => Promise<void>): void;
}
