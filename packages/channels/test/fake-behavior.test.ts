import { describe, expect, it } from "vitest";

import { FakeChannelAdapter } from "../src/fake.js";
import type { DeliveryUpdate, InboundMessage } from "../src/types.js";

function inboundWebhook(id: string, body = "hola"): Record<string, unknown> {
  return {
    messageId: id,
    kind: "inbound",
    from: "+50255550100",
    to: "+15055550100",
    body,
    at: "2026-09-23T12:00:00.000Z",
  };
}

describe("FakeChannelAdapter", () => {
  it("sends and returns a provider message id", async () => {
    const adapter = new FakeChannelAdapter();
    const receipt = await adapter.send({ body: "Tu pago fue aprobado", to: "+50255550100" });
    expect(receipt.providerMessageId).toBe("fake-msg-1");
    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0]?.body).toBe("Tu pago fue aprobado");
  });

  it("delivers inbound webhooks to handlers", async () => {
    const adapter = new FakeChannelAdapter();
    const seen: InboundMessage[] = [];
    adapter.onInbound((m) => {
      seen.push(m);
      return Promise.resolve();
    });
    const dispatched = await adapter.simulateInboundWebhook(inboundWebhook("wamid-1"));
    expect(dispatched).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.providerMessageId).toBe("wamid-1");
    expect(seen[0]?.body).toBe("hola");
  });

  it("drops duplicate webhooks by provider message id", async () => {
    const adapter = new FakeChannelAdapter();
    let calls = 0;
    adapter.onInbound(() => {
      calls += 1;
      return Promise.resolve();
    });
    const raw = inboundWebhook("wamid-dup");
    expect(await adapter.simulateInboundWebhook(raw)).toBe(true);
    expect(await adapter.simulateInboundWebhook(raw)).toBe(false);
    expect(await adapter.simulateInboundWebhook(structuredClone(raw))).toBe(false);
    expect(calls).toBe(1);
    expect(adapter.receivedInbound).toHaveLength(1);
  });

  it("delivers messages and reports delivery states in order", async () => {
    const adapter = new FakeChannelAdapter();
    const updates: DeliveryUpdate[] = [];
    adapter.onDeliveryUpdate((u) => {
      updates.push(u);
      return Promise.resolve();
    });
    const { providerMessageId } = await adapter.send({ body: "x", to: "+50255550100" });
    await adapter.simulateDelivery(providerMessageId, "sent");
    await adapter.simulateDelivery(providerMessageId, "delivered");
    await adapter.simulateDelivery(providerMessageId, "read");
    expect(updates.map((u) => u.state)).toEqual(["sent", "delivered", "read"]);
    expect(adapter.deliveryUpdates).toHaveLength(3);
  });

  it("supports out-of-order delivery updates", async () => {
    const adapter = new FakeChannelAdapter();
    const updates: DeliveryUpdate[] = [];
    adapter.onDeliveryUpdate((u) => {
      updates.push(u);
      return Promise.resolve();
    });
    // Provider reports "delivered" before "sent": forwarded as-is, no reordering.
    await adapter.simulateDelivery("fake-msg-9", "delivered", { at: "2026-09-23T12:02:00.000Z" });
    await adapter.simulateDelivery("fake-msg-9", "sent", { at: "2026-09-23T12:01:00.000Z" });
    expect(updates.map((u) => u.state)).toEqual(["delivered", "sent"]);
  });

  it("fails delivery with a reason", async () => {
    const adapter = new FakeChannelAdapter();
    const updates: DeliveryUpdate[] = [];
    adapter.onDeliveryUpdate((u) => {
      updates.push(u);
      return Promise.resolve();
    });
    await adapter.failDelivery("fake-msg-3", "recipient unreachable");
    expect(updates).toHaveLength(1);
    expect(updates[0]?.state).toBe("failed");
    expect(updates[0]?.reason).toBe("recipient unreachable");
  });

  it("normalizes unrecognized payloads to unknown instead of throwing", () => {
    const adapter = new FakeChannelAdapter();
    expect(adapter.normalizeWebhook(null)).toEqual({ type: "unknown" });
    expect(adapter.normalizeWebhook("nope")).toEqual({ type: "unknown" });
    expect(adapter.normalizeWebhook({ kind: "inbound" })).toEqual({ type: "unknown" });
    expect(adapter.normalizeWebhook({ messageId: "x", kind: "delivery" })).toEqual({
      type: "unknown",
    });
  });

  it("runs handlers in registration order", async () => {
    const adapter = new FakeChannelAdapter();
    const order: string[] = [];
    adapter.onInbound(() => {
      order.push("first");
      return Promise.resolve();
    });
    adapter.onInbound(() => {
      order.push("second");
      return Promise.resolve();
    });
    await adapter.simulateInboundWebhook(inboundWebhook("wamid-order"));
    expect(order).toEqual(["first", "second"]);
  });
});
