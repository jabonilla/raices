import { describe, expect, it } from "vitest";

import { MockSettlementProvider } from "../src/mock.js";

/** Recursively collect every value stored under an `amount` key. */
function collectAmounts(value: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) collectAmounts(item, out);
    return out;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "amount") out.push(entry);
      else collectAmounts(entry, out);
    }
  }
  return out;
}

describe("money is always the Money type, never number", () => {
  it("quote() rejects a source amount given as number", async () => {
    const provider = new MockSettlementProvider({ behavior: "success", seed: 5 });
    await expect(
      provider.quote({
        destinationCurrency: "GTQ",
        idempotencyKey: "q1",
        // A `number` smuggled past the type system must not reach money math.
        source: { amount: 100, currency: "USD" } as unknown as {
          amount: bigint;
          currency: "USD";
        },
      }),
    ).rejects.toThrow(/bigint/i);
  });

  it("quote() rejects an unknown currency", async () => {
    const provider = new MockSettlementProvider({ behavior: "success", seed: 5 });
    await expect(
      provider.quote({
        destinationCurrency: "XXX" as "GTQ",
        idempotencyKey: "q1",
        source: { amount: 100_00n, currency: "USD" },
      }),
    ).rejects.toThrow(/currency/i);
  });

  it("every amount the mock returns is a bigint", async () => {
    const provider = new MockSettlementProvider({ behavior: "success", seed: 5 });
    const quote = await provider.quote({
      destinationCurrency: "GTQ",
      idempotencyKey: "q1",
      source: { amount: 100_00n, currency: "USD" },
    });
    const transfer = await provider.initiate({
      destinationAccount: "partner-acct-1",
      idempotencyKey: "i1",
      purpose: "family support",
      quoteId: quote.id,
    });
    const statement = await provider.fetchStatement({
      idempotencyKey: "s1",
      since: "2020-01-01T00:00:00.000Z",
    });
    for (const amount of collectAmounts({ quote, transfer, statement })) {
      expect(typeof amount).toBe("bigint");
    }
  });

  it("the quoted rate is a decimal string, never a number", async () => {
    const provider = new MockSettlementProvider({ behavior: "success", seed: 5 });
    const quote = await provider.quote({
      destinationCurrency: "GTQ",
      idempotencyKey: "q1",
      source: { amount: 100_00n, currency: "USD" },
    });
    expect(typeof quote.rate).toBe("string");
    expect(quote.rate).toMatch(/^\d+\.\d+$/);
  });

  it("the quote destination is denominated in the requested currency", async () => {
    const provider = new MockSettlementProvider({ behavior: "success", seed: 5 });
    const quote = await provider.quote({
      destinationCurrency: "GTQ",
      idempotencyKey: "q1",
      source: { amount: 100_00n, currency: "USD" },
    });
    expect(quote.destination.currency).toBe("GTQ");
    expect(quote.source.currency).toBe("USD");
  });
});
