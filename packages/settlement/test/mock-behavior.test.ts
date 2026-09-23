import { describe, expect, it } from "vitest";

import { MockSettlementProvider } from "../src/mock.js";
import type { Money } from "@raices/money";

const usd = (amount: bigint): Money => ({ amount, currency: "USD" });

async function initiate(provider: MockSettlementProvider, key: string) {
  const quote = await provider.quote({
    destinationCurrency: "GTQ",
    idempotencyKey: `${key}:q`,
    source: usd(100_00n),
  });
  return provider.initiate({
    destinationAccount: "partner-acct-1",
    idempotencyKey: `${key}:i`,
    purpose: "family support",
    quoteId: quote.id,
  });
}

async function pollToTerminal(provider: MockSettlementProvider, key: string, transferId: string) {
  let status = "pending";
  for (let poll = 0; poll < 10; poll++) {
    const current = await provider.getStatus({
      idempotencyKey: `${key}:s:${String(poll)}`,
      transferId,
    });
    status = current.status;
    if (status !== "pending") return current;
  }
  throw new Error(`transfer ${transferId} never reached a terminal state`);
}

describe("mock behaviors", () => {
  it("success: a transfer settles", async () => {
    const provider = new MockSettlementProvider({ behavior: "success", seed: 11 });
    const transfer = await initiate(provider, "k1");
    const status = await pollToTerminal(provider, "k1", transfer.id);
    expect(status.status).toBe("settled");
    expect(status.failureReason).toBeUndefined();
  });

  it("delayed: status stays pending twice, then settles", async () => {
    const provider = new MockSettlementProvider({ behavior: "delayed", seed: 11 });
    const transfer = await initiate(provider, "k1");
    const first = await provider.getStatus({ idempotencyKey: "k1:s:0", transferId: transfer.id });
    const second = await provider.getStatus({ idempotencyKey: "k1:s:1", transferId: transfer.id });
    const third = await provider.getStatus({ idempotencyKey: "k1:s:2", transferId: transfer.id });
    expect(first.status).toBe("pending");
    expect(second.status).toBe("pending");
    expect(third.status).toBe("settled");
  });

  it("failure: a transfer fails with a reason", async () => {
    const provider = new MockSettlementProvider({ behavior: "failure", seed: 11 });
    const transfer = await initiate(provider, "k1");
    const status = await pollToTerminal(provider, "k1", transfer.id);
    expect(status.status).toBe("failed");
    expect(typeof status.failureReason).toBe("string");
  });

  it("statement-disagrees: the statement does not match what was initiated", async () => {
    const provider = new MockSettlementProvider({ behavior: "statement-disagrees", seed: 11 });
    const transfer = await initiate(provider, "k1");
    const statement = await provider.fetchStatement({
      idempotencyKey: "k1:stmt",
      since: "2020-01-01T00:00:00.000Z",
    });
    const line = statement.lines.find((l) => l.transferId === transfer.id);
    expect(line).toBeDefined();
    expect(line?.destination.amount).not.toBe(transfer.destination.amount);
  });

  it("success: the statement agrees with what was initiated", async () => {
    const provider = new MockSettlementProvider({ behavior: "success", seed: 11 });
    const transfer = await initiate(provider, "k1");
    await pollToTerminal(provider, "k1", transfer.id);
    const statement = await provider.fetchStatement({
      idempotencyKey: "k1:stmt",
      since: "2020-01-01T00:00:00.000Z",
    });
    const line = statement.lines.find((l) => l.transferId === transfer.id);
    expect(line?.destination).toEqual(transfer.destination);
    expect(line?.source).toEqual(transfer.source);
  });
});

describe("determinism", () => {
  it("the same seed and call sequence produce identical results", async () => {
    const run = async (seed: number) => {
      const provider = new MockSettlementProvider({ behavior: "success", seed });
      const quote = await provider.quote({
        destinationCurrency: "GTQ",
        idempotencyKey: "q",
        source: usd(100_00n),
      });
      const transfer = await provider.initiate({
        destinationAccount: "partner-acct-1",
        idempotencyKey: "i",
        purpose: "family support",
        quoteId: quote.id,
      });
      const status = await provider.getStatus({ idempotencyKey: "s", transferId: transfer.id });
      return { quote, transfer, status };
    };
    expect(await run(42)).toEqual(await run(42));
  });

  it("different seeds produce different ids", async () => {
    const run = async (seed: number) => {
      const provider = new MockSettlementProvider({ behavior: "success", seed });
      return provider.quote({
        destinationCurrency: "GTQ",
        idempotencyKey: "q",
        source: usd(100_00n),
      });
    };
    const a = await run(1);
    const b = await run(2);
    expect(a.id).not.toBe(b.id);
  });
});

describe("error paths", () => {
  it("initiate() rejects an unknown quote id", async () => {
    const provider = new MockSettlementProvider({ behavior: "success", seed: 11 });
    await expect(
      provider.initiate({
        destinationAccount: "partner-acct-1",
        idempotencyKey: "i1",
        purpose: "family support",
        quoteId: "quote_does-not-exist",
      }),
    ).rejects.toThrow(/unknown quote/i);
  });

  it("getStatus() rejects an unknown transfer id", async () => {
    const provider = new MockSettlementProvider({ behavior: "success", seed: 11 });
    await expect(
      provider.getStatus({ idempotencyKey: "s1", transferId: "transfer_does-not-exist" }),
    ).rejects.toThrow(/unknown transfer/i);
  });
});
