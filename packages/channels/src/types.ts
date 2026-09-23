/**
 * Normalized, provider-agnostic channel types.
 *
 * Business logic only ever sees these shapes. Provider-specific payload
 * details (field names, envelope structure, auth) live behind the
 * {@link ChannelAdapter} implementation and never leak into callers.
 */

/** Terminal lifecycle of one outbound message. */
export type DeliveryState = "queued" | "sent" | "delivered" | "read" | "failed";

/**
 * An inbound message from a recipient, normalized from a provider webhook.
 * Identity for idempotency is `providerMessageId`: the provider's own stable
 * identifier for this message.
 */
export interface InboundMessage {
  /** Provider-stable id; duplicates of this id must not be redelivered. */
  readonly providerMessageId: string;
  /** Channel the message arrived on. Opaque to callers. */
  readonly channel: string;
  /** Sender address as the provider reports it (phone, handle, ...). */
  readonly from: string;
  /** Our address the message was sent to. */
  readonly to: string;
  /** Text content. Media-bearing messages are out of scope for MVP. */
  readonly body: string;
  /** ISO-8601 timestamp from the provider. */
  readonly sentAt: string;
}

/** A message we want delivered to a recipient. */
export interface OutboundMessage {
  /** Recipient address as the provider expects it. */
  readonly to: string;
  /** Text content. Pre-rendered by the caller; the adapter never formats. */
  readonly body: string;
}

/** What `send` resolves with once the provider has accepted the message. */
export interface SentReceipt {
  readonly providerMessageId: string;
}

/** A delivery-state change for a previously sent message. */
export interface DeliveryUpdate {
  readonly providerMessageId: string;
  readonly state: DeliveryState;
  /** ISO-8601 timestamp from the provider. */
  readonly at: string;
  /** Present when `state` is "failed". Provider-supplied, untranslated. */
  readonly reason?: string | undefined;
}

/**
 * Result of normalizing one raw provider webhook payload.
 * `unknown` covers payloads the adapter does not recognize; callers log and
 * ignore those rather than throwing.
 */
export type WebhookEvent =
  | { readonly type: "inbound"; readonly message: InboundMessage }
  | { readonly type: "delivery"; readonly update: DeliveryUpdate }
  | { readonly type: "unknown" };
