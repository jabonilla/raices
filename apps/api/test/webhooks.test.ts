import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FakeChannelAdapter, type WebhookEvent } from "@raices/channels";

import { buildApp } from "../src/app.js";
import { InMemoryInboundDeduplicator } from "../src/webhooks/dedupe.js";
import { WEBHOOK_SIGNATURE_HEADER } from "../src/webhooks/routes.js";
import { FakeSignatureVerifier } from "../src/webhooks/signature.js";

const SIGNATURE = FakeSignatureVerifier.TEST_SIGNATURE;

function inboundPayload(messageId: string, extra: Record<string, unknown> = {}) {
  return {
    messageId,
    kind: "inbound",
    from: "+50255501111",
    to: "+15025550000",
    body: "Hola",
    ...extra,
  };
}

describe("POST /webhooks/channel (K2.28)", () => {
  const seen: WebhookEvent[] = [];
  const app = buildApp({
    webhooks: {
      adapter: new FakeChannelAdapter({ channel: "fake" }),
      verifier: new FakeSignatureVerifier(),
      deduplicator: new InMemoryInboundDeduplicator(),
      handleEvent: (event) => {
        seen.push(event);
      },
    },
  });

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const NO_SIGNATURE = Symbol("no-signature");

  function envelopeCode(response: { json(): unknown }): string {
    const body = response.json() as { error: { code: string } };
    return body.error.code;
  }

  function post(payload: unknown, signature: string | typeof NO_SIGNATURE = SIGNATURE) {
    return app.inject({
      method: "POST",
      url: "/webhooks/channel",
      headers: {
        "content-type": "application/json",
        ...(signature === NO_SIGNATURE ? {} : { [WEBHOOK_SIGNATURE_HEADER]: signature }),
      },
      payload: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
  }

  it("accepts a valid inbound webhook exactly once", async () => {
    const response = await post(inboundPayload("m-1"));
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ok: true, deduped: false });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.type).toBe("inbound");
  });

  it("accepts a duplicate webhook but ignores it: 200, never 500, never reprocessed", async () => {
    const first = await post(inboundPayload("m-dup"));
    expect(first.statusCode).toBe(202);
    const callsAfterFirst = seen.length;

    const second = await post(inboundPayload("m-dup"));
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ ok: true, deduped: true });
    expect(seen.length).toBe(callsAfterFirst);

    const third = await post(inboundPayload("m-dup"));
    expect(third.statusCode).toBe(200);
    expect(seen.length).toBe(callsAfterFirst);
  });

  it("accepts out-of-order arrivals as independent messages", async () => {
    const callsBefore = seen.length;
    const r2 = await post(inboundPayload("m-3"));
    const r1 = await post(inboundPayload("m-2"));
    expect(r2.statusCode).toBe(202);
    expect(r1.statusCode).toBe(202);
    expect(seen.length).toBe(callsBefore + 2);
  });

  it("accepts delivery updates", async () => {
    const response = await post({
      messageId: "m-1",
      kind: "delivery",
      state: "delivered",
      at: new Date().toISOString(),
    });
    expect(response.statusCode).toBe(200);
    expect(seen.at(-1)?.type).toBe("delivery");
  });

  it("logs and ignores unrecognized payloads instead of erroring", async () => {
    const response = await post({ messageId: "m-x", kind: "inbound" });
    // Missing from/to/body: the adapter maps it to { type: "unknown" }.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, deduped: false });
    expect(seen.at(-1)).toEqual({ type: "unknown" });
  });

  it("rejects a bad signature with 401 through the envelope", async () => {
    const response = await post(inboundPayload("m-bad"), "wrong");
    expect(response.statusCode).toBe(401);
    expect(envelopeCode(response)).toBe("unauthorized");
  });

  it("rejects a missing signature with 401", async () => {
    const response = await post(inboundPayload("m-nosig"), NO_SIGNATURE);
    expect(response.statusCode).toBe(401);
    expect(envelopeCode(response)).toBe("unauthorized");
  });

  it.each([
    ["array", [1, 2, 3]],
    ["string", "hello"],
    ["number", 42],
    ["null", null],
  ])("returns 400 for a malformed %s body", async (_label, payload) => {
    const response = await post(payload);
    expect(response.statusCode).toBe(400);
    expect(envelopeCode(response)).toBe("invalid_request");
  });

  it("fuzz: truncated and hostile payloads get 4xx, never 500, and the process survives", async () => {
    const hostile: unknown[] = [
      {},
      { messageId: "" },
      { messageId: "m-h1", kind: "inbound", from: 1, to: [], body: {} },
      { messageId: "m-h2", kind: "delivery", state: "exploded" },
      { messageId: "m-h3", kind: "inbound", from: "x".repeat(10_000), to: "y", body: "z" },
      { __proto__: { polluted: true } },
      { messageId: "m-h4", kind: "inbound", from: "+502", to: "+1", body: "a".repeat(200_000) },
      { messageId: null, kind: null },
      { nested: { deeply: { nested: { value: [1, { two: 2 }] } } } },
    ];
    for (const payload of hostile) {
      const response = await post(payload);
      expect(
        response.statusCode,
        `hostile payload ${JSON.stringify(payload).slice(0, 80)} must not 500`,
      ).toBeLessThan(500);
    }
    // The process is still alive and serving: a valid webhook works after
    // the fuzz battery.
    const after = await post(inboundPayload("m-after-fuzz"));
    expect(after.statusCode).toBe(202);
  });

  it("enforces rate limiting on the webhook route", async () => {
    const limited = buildApp({
      rateLimitMax: 2,
      rateLimitWindowMs: 60_000,
      webhooks: {
        adapter: new FakeChannelAdapter({ channel: "fake" }),
        verifier: new FakeSignatureVerifier(),
        deduplicator: new InMemoryInboundDeduplicator(),
      },
    });
    await limited.ready();
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        const response = await limited.inject({
          method: "POST",
          url: "/webhooks/channel",
          headers: {
            "content-type": "application/json",
            [WEBHOOK_SIGNATURE_HEADER]: SIGNATURE,
          },
          payload: JSON.stringify(inboundPayload(`m-rl-${String(i)}`)),
        });
        statuses.push(response.statusCode);
      }
      expect(statuses.slice(0, 2)).toEqual([202, 202]);
      expect(statuses.slice(2)).toEqual([429, 429]);
    } finally {
      await limited.close();
    }
  });
});
