import { describe, expect, it } from "vitest";

import { InMemoryOutboxStore } from "../src/outbox/memoryStore.js";
import { Outbox } from "../src/outbox/outbox.js";
import type { OutboxSender } from "../src/outbox/types.js";

const REQUEST = {
  method: "POST" as const,
  url: "https://api.raices.test/transfers",
  body: { amountMinor: "2500", currency: "USD" },
};

const okSender: OutboxSender = () => Promise.resolve({ ok: true as const, retryable: false });

/** A store that throws on setItem to simulate storage-full. */
class FailingStore extends InMemoryOutboxStore {
  constructor(private readonly failOnSet: boolean = true) {
    super();
  }
  override async setItem(key: string, value: string): Promise<void> {
    if (this.failOnSet) {
      throw new Error("QuotaExceededError: storage full");
    }
    return super.setItem(key, value);
  }
}

describe("Outbox edge cases (K2.39)", () => {
  it("airplane mode toggled repeatedly during a send: exactly once", async () => {
    const store = new InMemoryOutboxStore();
    const outbox = new Outbox(store);
    await outbox.load();
    const key = await outbox.enqueue(REQUEST);

    // Simulate airplane mode flapping: sender fails, succeeds, fails, succeeds.
    // The entry must be sent exactly once with the same idempotency key.
    const seenKeys: string[] = [];
    let attempt = 0;
    const flakySender: OutboxSender = (entry) => {
      attempt += 1;
      seenKeys.push(entry.id);
      // Fail on odd attempts (airplane mode on), succeed on even.
      if (attempt % 2 === 1) {
        return Promise.resolve({ ok: false as const, retryable: true });
      }
      return Promise.resolve({ ok: true as const, retryable: false });
    };

    // Drain 1: fails (attempt 1)
    await outbox.drain(flakySender);
    expect(outbox.pendingCount).toBe(1);

    // Drain 2: succeeds (attempt 2)
    const sent = await outbox.drain(flakySender);
    expect(sent).toBe(1);
    expect(outbox.pendingCount).toBe(0);

    // All attempts used the same key — server dedupes, effect is exactly-once.
    expect(seenKeys).toEqual([key, key]);
    expect(new Set(seenKeys).size).toBe(1);
  });

  it("device clock moved backwards: idempotency unaffected", async () => {
    const store = new InMemoryOutboxStore();
    const outbox = new Outbox(store);
    await outbox.load();

    // Enqueue with normal clock.
    const key1 = await outbox.enqueue(REQUEST);

    // Simulate clock moving backwards by 1 hour (mock Date.now).
    const realNow = Date.now;
    const backwardsTime = realNow() - 3600_000;
    Date.now = () => backwardsTime;

    try {
      const key2 = await outbox.enqueue({ ...REQUEST, body: { amountMinor: "3000" } });

      // Keys are distinct (UUID, not time-based).
      expect(key1).not.toBe(key2);

      // Both drain successfully.
      const sent = await outbox.drain(okSender);
      expect(sent).toBe(2);
      expect(outbox.pendingCount).toBe(0);
    } finally {
      Date.now = realNow;
    }
  });

  it("device clock moved forwards: no expiry, no loss", async () => {
    const store = new InMemoryOutboxStore();
    const outbox = new Outbox(store);
    await outbox.load();
    await outbox.enqueue(REQUEST);

    // Clock jumps forward by 1 year.
    const realNow = Date.now;
    const forwardsTime = realNow() + 365 * 24 * 3600_000;
    Date.now = () => forwardsTime;

    try {
      // Kill and restart (simulating app reopen after clock change).
      const restarted = new Outbox(store);
      await restarted.load();
      expect(restarted.pendingCount).toBe(1);

      const sent = await restarted.drain(okSender);
      expect(sent).toBe(1);
      expect(restarted.pendingCount).toBe(0);
    } finally {
      Date.now = realNow;
    }
  });

  it("storage full on enqueue: fails visibly, never silently drops", async () => {
    const store = new FailingStore(true);
    const outbox = new Outbox(store);
    await outbox.load();

    // Enqueue must throw — the caller sees the failure.
    await expect(outbox.enqueue(REQUEST)).rejects.toThrow("storage full");

    // In-memory state is unchanged (no divergence from disk).
    expect(outbox.pendingCount).toBe(0);

    // After "freeing storage", the next enqueue succeeds.
    const workingStore = new InMemoryOutboxStore();
    const workingOutbox = new Outbox(workingStore);
    await workingOutbox.load();
    const key = await workingOutbox.enqueue(REQUEST);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(workingOutbox.pendingCount).toBe(1);
  });

  it("storage full mid-drain: aborts, state stays consistent", async () => {
    const store = new InMemoryOutboxStore();
    const outbox = new Outbox(store);
    await outbox.load();
    await outbox.enqueue(REQUEST);
    await outbox.enqueue({ ...REQUEST, body: { amountMinor: "3000" } });
    expect(outbox.pendingCount).toBe(2);

    // Make the store fail on the second persist (during drain).
    let setCount = 0;
    const originalSet = store.setItem.bind(store);
    store.setItem = async (k: string, v: string) => {
      setCount += 1;
      if (setCount === 2) {
        throw new Error("QuotaExceededError: storage full");
      }
      return originalSet(k, v);
    };

    // Drain aborts with the error.
    await expect(outbox.drain(okSender)).rejects.toThrow("storage full");

    // In-memory matches disk: the drain aborted before removing the
    // first entry (persist threw), so both entries are still present.
    // Verify by reloading from disk.
    const reloaded = new Outbox(store);
    // Restore working setItem for the reload.
    store.setItem = originalSet;
    await reloaded.load();
    // Both entries survived — no silent loss, no divergence.
    // The first was marked "sending" when the abort happened; load()
    // resets it to "pending" for retry.
    expect(reloaded.pendingCount).toBe(2);
  });

  it("two rapid enqueues get distinct idempotency keys", async () => {
    const store = new InMemoryOutboxStore();
    const outbox = new Outbox(store);
    await outbox.load();

    // Enqueue 100 requests as fast as possible.
    const keys = await Promise.all(Array.from({ length: 100 }, () => outbox.enqueue(REQUEST)));

    // All keys are distinct.
    expect(new Set(keys).size).toBe(100);
    expect(outbox.pendingCount).toBe(100);

    // All drain successfully.
    const sent = await outbox.drain(okSender);
    expect(sent).toBe(100);
  });

  it("concurrent drains do not duplicate sends", async () => {
    const store = new InMemoryOutboxStore();
    const outbox = new Outbox(store);
    await outbox.load();
    await outbox.enqueue(REQUEST);

    const seenKeys: string[] = [];
    const slowSender: OutboxSender = async (entry) => {
      seenKeys.push(entry.id);
      await new Promise((r) => setTimeout(r, 50));
      return { ok: true as const, retryable: false };
    };

    // Start two drains concurrently.
    const [sent1, sent2] = await Promise.all([outbox.drain(slowSender), outbox.drain(slowSender)]);

    // Exactly one send total.
    expect(sent1 + sent2).toBe(1);
    expect(seenKeys).toHaveLength(1);
    expect(outbox.pendingCount).toBe(0);
  });
});
