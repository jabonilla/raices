import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MockSettlementProvider } from "../src/mock.js";
import type { Money } from "@raices/money";
import type { SettlementProvider } from "../src/provider.js";

const usd = (amount: bigint): Money => ({ amount, currency: "USD" });

function successProvider(seed = 7): MockSettlementProvider {
  return new MockSettlementProvider({ behavior: "success", seed });
}

/**
 * A consumer workflow written ONLY against the SettlementProvider interface.
 * It must drive any provider to a terminal state without ever knowing which
 * implementation it talks to. If business logic had to branch on the
 * concrete provider, this function could not exist in this form.
 */
async function settleThroughInterface(
  provider: SettlementProvider,
  key: string,
  source: Money,
): Promise<{ status: string; statementLines: number }> {
  const quote = await provider.quote({
    destinationCurrency: "GTQ",
    idempotencyKey: `${key}:quote`,
    source,
  });
  const transfer = await provider.initiate({
    destinationAccount: "partner-acct-1",
    idempotencyKey: `${key}:initiate`,
    purpose: "family support",
    quoteId: quote.id,
  });
  let status = "pending";
  for (let poll = 0; poll < 10; poll++) {
    const current = await provider.getStatus({
      idempotencyKey: `${key}:status:${String(poll)}`,
      transferId: transfer.id,
    });
    status = current.status;
    if (status !== "pending") break;
  }
  const statement = await provider.fetchStatement({
    idempotencyKey: `${key}:statement`,
    since: "2020-01-01T00:00:00.000Z",
  });
  return { status, statementLines: statement.lines.length };
}

describe("no business logic branches on provider identity", () => {
  it("the interface module does not depend on the mock module", () => {
    const providerSrc = readFileSync(
      fileURLToPath(new URL("../src/provider.ts", import.meta.url)),
      "utf8",
    );
    expect(providerSrc).not.toMatch(/from\s+["']\.\/mock(\.js)?["']/);
    expect(providerSrc).not.toContain("MockSettlementProvider");
  });

  it("the interface module contains no instanceof narrowing", () => {
    const providerSrc = readFileSync(
      fileURLToPath(new URL("../src/provider.ts", import.meta.url)),
      "utf8",
    );
    expect(providerSrc).not.toContain("instanceof");
  });

  it("the same interface-only workflow settles successfully", async () => {
    const result = await settleThroughInterface(successProvider(), "k1", usd(10_00n));
    expect(result.status).toBe("settled");
    expect(result.statementLines).toBe(1);
  });

  it("the same interface-only workflow observes delayed settlement", async () => {
    const provider = new MockSettlementProvider({ behavior: "delayed", seed: 7 });
    const result = await settleThroughInterface(provider, "k1", usd(10_00n));
    expect(result.status).toBe("settled");
  });

  it("the same interface-only workflow observes failure", async () => {
    const provider = new MockSettlementProvider({ behavior: "failure", seed: 7 });
    const result = await settleThroughInterface(provider, "k1", usd(10_00n));
    expect(result.status).toBe("failed");
  });

  it("outcomes do not depend on which seed backs the mock", async () => {
    const a = await settleThroughInterface(successProvider(1), "k1", usd(10_00n));
    const b = await settleThroughInterface(successProvider(2), "k1", usd(10_00n));
    expect(a.status).toBe(b.status);
    expect(a.statementLines).toBe(b.statementLines);
  });
});
