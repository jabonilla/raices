import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { ChannelAdapter } from "../src/adapter.js";
import { FakeChannelAdapter } from "../src/fake.js";
import type { DeliveryUpdate, InboundMessage } from "../src/types.js";

/**
 * A consumer workflow written ONLY against the ChannelAdapter interface:
 * send a message, then drive it to a terminal delivery state purely through
 * interface callbacks. If business logic had to branch on the concrete
 * channel, this function could not exist in this form.
 */
async function notifyThroughInterface(
  adapter: ChannelAdapter,
  to: string,
  body: string,
): Promise<{ terminal: string; inboundBodies: string[] }> {
  const inboundBodies: string[] = [];
  const terminalStates = new Promise<string>((resolve) => {
    adapter.onDeliveryUpdate((update: DeliveryUpdate) => {
      if (update.state === "delivered" || update.state === "read" || update.state === "failed") {
        resolve(update.state);
      }
      return Promise.resolve();
    });
  });
  adapter.onInbound((message: InboundMessage) => {
    inboundBodies.push(message.body);
    return Promise.resolve();
  });

  const { providerMessageId } = await adapter.send({ body, to });
  // The test harness (not business logic) drives the fake here.
  const fake = adapter as unknown as FakeChannelAdapter;
  await fake.simulateDelivery(providerMessageId, "sent");
  await fake.simulateInboundWebhook({
    at: "2026-09-23T12:00:00.000Z",
    body: "gracias",
    from: to,
    kind: "inbound",
    messageId: "wamid-reply-1",
    to: "raices",
  });
  await fake.simulateDelivery(providerMessageId, "delivered");

  return { terminal: await terminalStates, inboundBodies };
}

describe("no business logic branches on channel identity", () => {
  it("the interface module does not depend on the fake module", () => {
    const adapterSrc = readFileSync(
      fileURLToPath(new URL("../src/adapter.ts", import.meta.url)),
      "utf8",
    );
    expect(adapterSrc).not.toMatch(/from\s+["']\.\/fake(\.js)?["']/);
    expect(adapterSrc).not.toContain("FakeChannelAdapter");
  });

  it("the types module names no concrete channel", () => {
    const typesSrc = readFileSync(
      fileURLToPath(new URL("../src/types.ts", import.meta.url)),
      "utf8",
    );
    expect(typesSrc.toLowerCase()).not.toContain("whatsapp");
    expect(typesSrc.toLowerCase()).not.toContain("twilio");
  });

  it("the interface module contains no instanceof narrowing", () => {
    const adapterSrc = readFileSync(
      fileURLToPath(new URL("../src/adapter.ts", import.meta.url)),
      "utf8",
    );
    expect(adapterSrc).not.toContain("instanceof");
  });

  it("the same interface-only workflow completes", async () => {
    const result = await notifyThroughInterface(
      new FakeChannelAdapter({ channel: "whatsapp" }),
      "+50255550100",
      "Tu pago fue aprobado",
    );
    expect(result.terminal).toBe("delivered");
    expect(result.inboundBodies).toEqual(["gracias"]);
  });

  it("the workflow does not depend on the channel label", async () => {
    const a = await notifyThroughInterface(new FakeChannelAdapter({ channel: "a" }), "+1", "hi");
    const b = await notifyThroughInterface(new FakeChannelAdapter({ channel: "b" }), "+1", "hi");
    expect(a.terminal).toBe(b.terminal);
    expect(a.inboundBodies).toEqual(b.inboundBodies);
  });
});
