import { z } from "zod";

import type { ChannelAdapter } from "./adapter.js";
import type {
  DeliveryState,
  DeliveryUpdate,
  InboundMessage,
  OutboundMessage,
  SentReceipt,
  WebhookEvent,
} from "./types.js";

/**
 * The fake's own webhook envelope. Real providers each define their own;
 * this shape exists so tests can exercise `normalizeWebhook` without any
 * provider SDK, network, or credentials.
 */
const FakeWebhookSchema = z
  .object({
    messageId: z.string().min(1),
    kind: z.enum(["inbound", "delivery"]),
    from: z.string().optional(),
    to: z.string().optional(),
    body: z.string().optional(),
    state: z.enum(["queued", "sent", "delivered", "read", "failed"]).optional(),
    reason: z.string().optional(),
    at: z.string().optional(),
  })
  .strict();

const DELIVERY_STATES: ReadonlySet<string> = new Set<DeliveryState>([
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
]);

export interface FakeChannelAdapterOptions {
  /** Opaque channel label. Defaults to "fake". */
  readonly channel?: string | undefined;
}

/**
 * In-memory {@link ChannelAdapter} for tests.
 *
 * No network, no credentials, no timers: every provider-side event is
 * injected explicitly through the `simulate*` methods, so tests control
 * delivery, failure, duplicates, and ordering deterministically.
 *
 * - `send` records the outbound and mints `fake-msg-{n}` ids.
 * - `simulateInboundWebhook(raw)` normalizes and dispatches, dropping
 *   duplicate `providerMessageId`s (idempotent redelivery).
 * - `simulateDelivery(messageId, state, ...)` / `failDelivery(...)` inject
 *   delivery updates in whatever order the test chooses, including
 *   out-of-order arrivals.
 */
export class FakeChannelAdapter implements ChannelAdapter {
  readonly channel: string;

  private nextId = 1;
  private readonly inboundHandlers: Array<(message: InboundMessage) => Promise<void>> = [];
  private readonly deliveryHandlers: Array<(update: DeliveryUpdate) => Promise<void>> = [];
  private readonly seenInboundIds = new Set<string>();
  private readonly outbox: Array<OutboundMessage & SentReceipt> = [];
  private readonly inboundLog: InboundMessage[] = [];
  private readonly deliveryLog: DeliveryUpdate[] = [];

  constructor(options: FakeChannelAdapterOptions = {}) {
    this.channel = options.channel ?? "fake";
  }

  send(message: OutboundMessage): Promise<SentReceipt> {
    const receipt: SentReceipt = {
      providerMessageId: `fake-msg-${String(this.nextId)}`,
    };
    this.nextId += 1;
    this.outbox.push({ ...message, ...receipt });
    return Promise.resolve(receipt);
  }

  normalizeWebhook(raw: unknown): WebhookEvent {
    const parsed = FakeWebhookSchema.safeParse(raw);
    if (!parsed.success) return { type: "unknown" };
    const payload = parsed.data;

    if (payload.kind === "inbound") {
      if (payload.from === undefined || payload.to === undefined || payload.body === undefined) {
        return { type: "unknown" };
      }
      const message: InboundMessage = {
        providerMessageId: payload.messageId,
        channel: this.channel,
        from: payload.from,
        to: payload.to,
        body: payload.body,
        sentAt: payload.at ?? new Date().toISOString(),
      };
      return { type: "inbound", message };
    }

    if (payload.state === undefined || !DELIVERY_STATES.has(payload.state)) {
      return { type: "unknown" };
    }
    const update: DeliveryUpdate = {
      providerMessageId: payload.messageId,
      state: payload.state,
      at: payload.at ?? new Date().toISOString(),
      ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
    };
    return { type: "delivery", update };
  }

  onInbound(handler: (message: InboundMessage) => Promise<void>): void {
    this.inboundHandlers.push(handler);
  }

  onDeliveryUpdate(handler: (update: DeliveryUpdate) => Promise<void>): void {
    this.deliveryHandlers.push(handler);
  }

  /**
   * Feed a raw webhook through normalization and dispatch, as the HTTP layer
   * would on a provider POST. Duplicate `providerMessageId`s are acknowledged
   * but not redispatched: returns `false` when the message was a duplicate.
   */
  async simulateInboundWebhook(raw: unknown): Promise<boolean> {
    const event = this.normalizeWebhook(raw);
    if (event.type !== "inbound") return false;
    const id = event.message.providerMessageId;
    if (this.seenInboundIds.has(id)) return false;
    this.seenInboundIds.add(id);
    this.inboundLog.push(event.message);
    for (const handler of this.inboundHandlers) {
      await handler(event.message);
    }
    return true;
  }

  /**
   * Inject a delivery update for a sent message. Call in any order, including
   * out-of-order: the fake forwards exactly what it is given.
   */
  async simulateDelivery(
    providerMessageId: string,
    state: DeliveryState,
    options: { at?: string | undefined; reason?: string | undefined } = {},
  ): Promise<void> {
    const update: DeliveryUpdate = {
      providerMessageId,
      state,
      at: options.at ?? new Date().toISOString(),
      ...(options.reason !== undefined ? { reason: options.reason } : {}),
    };
    this.deliveryLog.push(update);
    for (const handler of this.deliveryHandlers) {
      await handler(update);
    }
  }

  /** Convenience for the failure path: a `failed` update with a reason. */
  async failDelivery(providerMessageId: string, reason: string): Promise<void> {
    await this.simulateDelivery(providerMessageId, "failed", { reason });
  }

  /** Outbound messages handed to `send`, in order. */
  get sentMessages(): ReadonlyArray<OutboundMessage & SentReceipt> {
    return this.outbox;
  }

  /** Inbound messages dispatched to handlers (duplicates excluded). */
  get receivedInbound(): ReadonlyArray<InboundMessage> {
    return this.inboundLog;
  }

  /** Delivery updates dispatched to handlers, in injection order. */
  get deliveryUpdates(): ReadonlyArray<DeliveryUpdate> {
    return this.deliveryLog;
  }
}
