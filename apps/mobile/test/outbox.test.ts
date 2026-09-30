import { describe, expect, it } from "vitest";

import { InMemoryOutboxStore } from "../src/outbox/memoryStore.js";
import { Outbox } from "../src/outbox/outbox.js";
import type { OutboxEntry, OutboxSender } from "../src/outbox/types.js";

const REQUEST = {
  method: "POST" as const,
  url: "https://api.raices.test/transfers",
  body: { amountMinor: "2500", currency: "USD" },
};

const okSender: OutboxSender = () => Promise.resolve({ ok: true as const, retryable: false });

describe("Outbox (K2.31)", () => {
  it("generates the idempotency key at compose time, not at send time", async () => {
    const store = new InMemoryOutboxStore();
    const outbox = new Outbox(store);
    await outbox.load();

    const key = await outbox.enqueue(REQUEST);

    // UUID v4 format.
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    // The key is stable: the sender receives the SAME key that enqueue returned.
    const seenKeys: string[] = [];
    await outbox.drain((entry) => {
      seenKeys.push(entry.id);
      return Promise.resolve({ ok: true as const, retryable: false });
    });
    expect(seenKeys).toEqual([key]);
  });

  it("compose offline, kill the app, restore connectivity: exactly one send", async () => {
    const store = new InMemoryOutboxStore();

    // 1. Compose while offline.
    const offline = new Outbox(store);
    await offline.load();
    const key = await offline.enqueue(REQUEST);
    expect(offline.pendingCount).toBe(1);

    // 2. Kill the app: drop the instance, create a new one from the same store.
    const restarted = new Outbox(store);
    await restarted.load();
    expect(restarted.pendingCount).toBe(1);

    // 3. Restore connectivity and drain.
    const sends: OutboxEntry[] = [];
    const sent = await restarted.drain((entry) => {
      sends.push(entry);
      return okSender(entry);
    });

    expect(sent).toBe(1);
    expect(sends).toHaveLength(1);
    expect(sends[0]?.id).toBe(key);
    expect(restarted.pendingCount).toBe(0);

    // 4. A second drain sends nothing — exactly once.
    const secondSends: OutboxEntry[] = [];
    const sentAgain = await restarted.drain((entry) => {
      secondSends.push(entry);
      return okSender(entry);
    });
    expect(sentAgain).toBe(0);
    expect(secondSends).toHaveLength(0);
  });

  it("crash mid-send retries with the SAME idempotency key", async () => {
    const store = new InMemoryOutboxStore();
    const outbox = new Outbox(store);
    await outbox.load();
    const key = await outbox.enqueue(REQUEST);

    // Drain starts, sender hangs (app killed mid-flight).
    let release!: (value: { ok: boolean; retryable: boolean }) => void;
    const hanging = new Promise<{ ok: boolean; retryable: boolean }>((r) => {
      release = r;
    });
    const sender = (): Promise<{ ok: boolean; retryable: boolean }> => hanging;
    const drainPromise = outbox.drain(sender);

    // Give the drain a tick to mark the entry as sending and persist.
    await new Promise((r) => setTimeout(r, 20));

    // Kill the app mid-send: new instance from the same store.
    const restarted = new Outbox(store);
    await restarted.load();
    // The interrupted send is back to pending.
    expect(restarted.pendingCount).toBe(1);

    // The retry carries the same key — the server dedupes, effect is exactly-once.
    const retriedKeys: string[] = [];
    const sent = await restarted.drain((entry) => {
      retriedKeys.push(entry.id);
      return okSender(entry);
    });
    expect(sent).toBe(1);
    expect(retriedKeys).toEqual([key]);

    // Let the original (dead) drain finish to avoid an unhandled promise.
    release({ ok: true, retryable: false });
    await drainPromise;
  });

  it("failed sends return to pending for the next drain", async () => {
    const store = new InMemoryOutboxStore();
    const outbox = new Outbox(store);
    await outbox.load();
    await outbox.enqueue(REQUEST);

    // First drain: network fails.
    let attempts = 0;
    await outbox.drain(() => {
      attempts += 1;
      return Promise.resolve({ ok: false as const, retryable: true });
    });
    expect(attempts).toBe(1);
    expect(outbox.pendingCount).toBe(1);

    // Second drain: succeeds.
    const sent = await outbox.drain(okSender);
    expect(sent).toBe(1);
    expect(outbox.pendingCount).toBe(0);
  });

  it("entries survive a serialization round-trip", async () => {
    const store = new InMemoryOutboxStore();
    const outbox = new Outbox(store);
    await outbox.load();
    const key = await outbox.enqueue({
      ...REQUEST,
      headers: { "X-Custom": "value" },
    });

    // Read the raw persisted JSON and rehydrate a new instance.
    const raw = await store.getItem("@raices/outbox");
    expect(raw).toContain(key);
    const parsed = JSON.parse(raw ?? "[]") as Array<{ headers: unknown; body: unknown }>;
    expect(parsed[0]?.headers).toEqual({ "X-Custom": "value" });
    expect(parsed[0]?.body).toEqual(REQUEST.body);
  });
});
