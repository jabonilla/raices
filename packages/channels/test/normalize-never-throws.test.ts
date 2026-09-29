import { describe, expect, it } from "vitest";

import { FakeChannelAdapter } from "../src/fake.js";

/**
 * Issue #41: "normalization never throws" stops being a convention and
 * becomes a test. `normalizeWebhook` is total over unknown input: malformed,
 * truncated, and hostile payloads return a `WebhookEvent` (possibly
 * `{ type: "unknown" }`) instead of throwing.
 */
describe("normalizeWebhook never throws (issue #41)", () => {
  const adapter = new FakeChannelAdapter();

  const hostile: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["null", null],
    ["number", 42],
    ["string", "hello"],
    ["array", [1, 2, 3]],
    ["empty object", {}],
    ["missing kind", { messageId: "m1" }],
    ["empty messageId", { messageId: "", kind: "inbound" }],
    ["non-string messageId", { messageId: 42, kind: "inbound" }],
    ["unknown kind", { messageId: "m1", kind: "teleport" }],
    ["inbound missing fields", { messageId: "m1", kind: "inbound" }],
    ["inbound wrong types", { messageId: "m1", kind: "inbound", from: 1, to: [], body: {} }],
    ["delivery missing state", { messageId: "m1", kind: "delivery" }],
    ["delivery bad state", { messageId: "m1", kind: "delivery", state: "exploded" }],
    [
      "extra unknown fields",
      { messageId: "m1", kind: "inbound", from: "a", to: "b", body: "c", x: 1 },
    ],
    [
      "strict violation",
      { messageId: "m1", kind: "inbound", from: "a", to: "b", body: "c", extra: true },
    ],
    [
      "huge strings",
      { messageId: "m1", kind: "inbound", from: "x".repeat(100_000), to: "y", body: "z" },
    ],
    ["deeply nested", { a: { b: { c: { d: { e: [1, 2, { f: "g" }] } } } } }],
    ["boolean", true],
    ["NaN", Number.NaN],
    ["negative zero", -0],
  ];

  it.each(hostile)("returns instead of throwing for %s", (_label, raw) => {
    let event: unknown;
    expect(() => {
      event = adapter.normalizeWebhook(raw);
    }).not.toThrow();
    expect(event).toBeDefined();
    expect(["inbound", "delivery", "unknown"]).toContain((event as { type: string }).type);
  });

  it("truncated JSON parses are still total", () => {
    // Simulate receiving half a payload: whatever survives JSON.parse (or
    // fails to) must not throw the normalizer.
    const fragments = ['{"messageId": "m1", "kind": "inb', '{"messageId":', "[1,2,", ""];
    for (const fragment of fragments) {
      let raw: unknown;
      try {
        raw = JSON.parse(fragment);
      } catch {
        raw = fragment;
      }
      expect(() => adapter.normalizeWebhook(raw)).not.toThrow();
    }
  });
});
