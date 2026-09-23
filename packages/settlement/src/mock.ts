import { isCurrency, multiply, type Money } from "@raices/money";

import { InvalidSettlementAmountError, UnknownQuoteError, UnknownTransferError } from "./errors.js";
import type {
  FetchStatementRequest,
  GetStatusRequest,
  InitiateRequest,
  Quote,
  QuoteRequest,
  SettlementProvider,
  SettlementStatus,
  Statement,
  StatementLine,
  Transfer,
  TransferStatus,
} from "./provider.js";

/** Scripted outcomes the mock can produce. Set per instance, switchable. */
export type MockBehavior = "success" | "delayed" | "failure" | "statement-disagrees";

export interface MockSettlementProviderOptions {
  /** Seeds the deterministic PRNG behind ids and quotes. Same seed, same run. */
  readonly seed: number;
  readonly behavior?: MockBehavior | undefined;
}

/**
 * A deterministic PRNG (mulberry32). All randomness in the mock flows
 * through this, so a seed fully determines ids, rates, and quotes.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertMoney(value: unknown): asserts value is Money {
  if (typeof value !== "object" || value === null) {
    throw new InvalidSettlementAmountError(value);
  }
  const candidate = value as { amount?: unknown; currency?: unknown };
  if (typeof candidate.amount !== "bigint") {
    throw new InvalidSettlementAmountError(candidate.amount);
  }
  if (!isCurrency(candidate.currency)) {
    throw new InvalidSettlementAmountError(candidate.currency);
  }
}

const RATE_DENOMINATOR = 1_000_000n;

/** Render a num/den rate as a decimal string. Never a number. */
function formatRate(num: bigint, den: bigint): string {
  const whole = num / den;
  const frac = num % den;
  const decimals = den.toString().length - 1;
  return `${whole.toString()}.${frac.toString().padStart(decimals, "0")}`;
}

interface TransferRecord {
  transfer: Transfer;
  /** Distinct-key getStatus calls so far; drives the delayed behavior. */
  polls: number;
}

/**
 * In-memory SettlementProvider for tests. No credentials, no network.
 *
 * Deterministic from its seed: the same seed and the same call sequence
 * produce identical ids, quotes, and outcomes. The scripted `behavior`
 * covers the cases settlement code must survive: success, delayed
 * settlement, failure, and a partner statement that disagrees with what
 * was initiated (the reconciliation path).
 *
 * Idempotency: every method replays the stored result when called again
 * with the same idempotency key, with no additional side effects. A new
 * key is a new call — retries reuse the key, polls use fresh keys.
 */
export class MockSettlementProvider implements SettlementProvider {
  private readonly rand: () => number;
  private readonly quotes = new Map<string, Quote>();
  private readonly transfers = new Map<string, TransferRecord>();
  private readonly replay = new Map<string, unknown>();
  private behavior: MockBehavior;

  constructor(options: MockSettlementProviderOptions) {
    this.rand = mulberry32(options.seed);
    this.behavior = options.behavior ?? "success";
  }

  /** Switch the scripted behavior. Terminal transfers keep their status. */
  setBehavior(behavior: MockBehavior): void {
    this.behavior = behavior;
  }

  private cached<T>(method: string, key: string, compute: () => T): T {
    const cacheKey = `${method}:${key}`;
    const hit = this.replay.get(cacheKey);
    if (hit !== undefined) return hit as T;
    const result = compute();
    this.replay.set(cacheKey, result);
    return result;
  }

  private nextId(prefix: string): string {
    const n = Math.floor(this.rand() * 0xffff_ffff);
    return `${prefix}_${n.toString(16).padStart(8, "0")}`;
  }

  quote(request: QuoteRequest): Promise<Quote> {
    return Promise.resolve().then(() =>
      this.cached("quote", request.idempotencyKey, () => {
        assertMoney(request.source);
        if (!isCurrency(request.destinationCurrency)) {
          throw new InvalidSettlementAmountError(request.destinationCurrency);
        }
        // Deterministic rate in [7.70, 8.00) for the mock corridor.
        const rateNum = 7_700_000n + BigInt(Math.floor(this.rand() * 300_000));
        const converted = multiply(request.source, { den: RATE_DENOMINATOR, num: rateNum }, "DOWN");
        const quote: Quote = {
          destination: { amount: converted.amount, currency: request.destinationCurrency },
          expiresAt: "2026-01-01T00:00:00.000Z",
          id: this.nextId("quote"),
          rate: formatRate(rateNum, RATE_DENOMINATOR),
          source: request.source,
        };
        this.quotes.set(quote.id, quote);
        return quote;
      }),
    );
  }

  initiate(request: InitiateRequest): Promise<Transfer> {
    return Promise.resolve().then(() =>
      this.cached("initiate", request.idempotencyKey, () => {
        const quote = this.quotes.get(request.quoteId);
        if (quote === undefined) throw new UnknownQuoteError(request.quoteId);
        const transfer: Transfer = {
          destination: quote.destination,
          id: this.nextId("transfer"),
          source: quote.source,
          status: "pending",
        };
        this.transfers.set(transfer.id, { polls: 0, transfer });
        return transfer;
      }),
    );
  }

  getStatus(request: GetStatusRequest): Promise<TransferStatus> {
    return Promise.resolve().then(() =>
      this.cached("getStatus", request.idempotencyKey, () => {
        const record = this.transfers.get(request.transferId);
        if (record === undefined) throw new UnknownTransferError(request.transferId);
        record.polls += 1;
        const status = this.resolveStatus(record.polls);
        if (status !== "pending") {
          record.transfer = { ...record.transfer, status };
        }
        const result: TransferStatus = {
          failureReason: status === "failed" ? "mock partner rejected the transfer" : undefined,
          status,
          transferId: request.transferId,
        };
        return result;
      }),
    );
  }

  fetchStatement(request: FetchStatementRequest): Promise<Statement> {
    return Promise.resolve().then(() =>
      this.cached("fetchStatement", request.idempotencyKey, () => {
        const lines: StatementLine[] = [...this.transfers.values()].map(({ transfer }, index) => {
          // The disagreeing statement: the first line's payout differs from
          // what was initiated, exercising the reconciliation path.
          const disagree = this.behavior === "statement-disagrees" && index === 0;
          return {
            destination: disagree
              ? { ...transfer.destination, amount: transfer.destination.amount + 1n }
              : transfer.destination,
            settledAt: transfer.status === "settled" ? "2026-01-02T00:00:00.000Z" : undefined,
            source: transfer.source,
            status: transfer.status,
            transferId: transfer.id,
          };
        });
        return { lines };
      }),
    );
  }

  private resolveStatus(polls: number): SettlementStatus {
    switch (this.behavior) {
      case "success":
        return "settled";
      case "delayed":
        return polls >= 3 ? "settled" : "pending";
      case "failure":
        return "failed";
      case "statement-disagrees":
        return "settled";
    }
  }
}
