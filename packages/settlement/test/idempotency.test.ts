import { describe, expect, it } from "vitest";

import { MockSettlementProvider } from "../src/mock.js";
import type { Money } from "@raices/money";

const usd = (amount: bigint): Money => ({ amount, currency: "USD" });

describe("idempotency by caller-supplied key", () => {
  it("quote() replays the identical quote for the same key", async () => {
    const provider = new MockSettlementProvider({ behavior: "success", seed: 3 });
    const request = {
      destinationCurrency: "GTQ" as const,
      idempotencyKey: "q1",
      source: usd(25_00n),
    };
    const first = await provider.quote(request);
    const second = await provider.quote(request);
    expect(second).toBe(first);
    expect(second.id).toBe(first.id);
  });

  it("initiate() does not create a duplicate transfer for the same key", async () => {
    const provider = new MockSettlementProvider({ behavior: "success", seed: 3 });
    const quote = await provider.quote({
      destinationCurrency: "GTQ",
      idempotencyKey: "q1",
      source: usd(25_00n),
    });
    const request = {
      destinationAccount: "partner-acct-1",
      idempotencyKey: "i1",
      purpose: "family support",
      quoteId: quote.id,
    };
    const first = await provider.initiate(request);
    const second = await provider.initiate(request);
    expect(second).toBe(first);
    const statement = await provider.fetchStatement({
      idempotencyKey: "s1",
      since: "2020-01-01T00:00:00.000Z",
    });
    expect(statement.lines).toHaveLength(1);
  });

  it("getStatus() replays the identical status for the same key", async () => {
    const provider = new MockSettlementProvider({ behavior: "success", seed: 3 });
    const quote = await provider.quote({
      destinationCurrency: "GTQ",
      idempotencyKey: "q1",
      source: usd(25_00n),
    });
    const transfer = await provider.initiate({
      destinationAccount: "partner-acct-1",
      idempotencyKey: "i1",
      purpose: "family support",
      quoteId: quote.id,
    });
    const request = { idempotencyKey: "st1", transferId: transfer.id };
    const first = await provider.getStatus(request);
    const second = await provider.getStatus(request);
    expect(second).toBe(first);
  });

  it("fetchStatement() replays the identical statement for the same key", async () => {
    const provider = new MockSettlementProvider({ behavior: "success", seed: 3 });
    const first = await provider.fetchStatement({
      idempotencyKey: "s1",
      since: "2020-01-01T00:00:00.000Z",
    });
    const second = await provider.fetchStatement({
      idempotencyKey: "s1",
      since: "2020-01-01T00:00:00.000Z",
    });
    expect(second).toBe(first);
  });

  it("different keys produce different ids (replay does not leak across keys)", async () => {
    const provider = new MockSettlementProvider({ behavior: "success", seed: 3 });
    const a = await provider.quote({
      destinationCurrency: "GTQ",
      idempotencyKey: "qa",
      source: usd(25_00n),
    });
    const b = await provider.quote({
      destinationCurrency: "GTQ",
      idempotencyKey: "qb",
      source: usd(25_00n),
    });
    expect(a.id).not.toBe(b.id);
  });
});
