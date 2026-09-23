import type { Currency, Money } from "@raices/money";

/**
 * Terminal lifecycle of a single settlement: money is either still moving,
 * arrived, or failed. Intent state and settlement state are separate fields
 * everywhere in Raíces (rule 4); this enum is the settlement side only.
 */
export type SettlementStatus = "pending" | "settled" | "failed";

export interface QuoteRequest {
  /** Caller-supplied idempotency key: repeating the call replays the quote. */
  readonly idempotencyKey: string;
  /** What the sender provides. Amount is bigint minor units, never number. */
  readonly source: Money;
  readonly destinationCurrency: Currency;
}

export interface Quote {
  readonly id: string;
  readonly source: Money;
  readonly destination: Money;
  /** Decimal string, e.g. "7.845210". Never a number. */
  readonly rate: string;
  /** ISO-8601 timestamp after which the quote must be refreshed. */
  readonly expiresAt: string;
}

export interface InitiateRequest {
  /** Caller-supplied idempotency key: repeating the call replays the transfer. */
  readonly idempotencyKey: string;
  readonly quoteId: string;
  /** Opaque partner-side account reference. */
  readonly destinationAccount: string;
  /** Stated purpose the money moves with. */
  readonly purpose: string;
}

export interface Transfer {
  readonly id: string;
  readonly status: SettlementStatus;
  readonly source: Money;
  readonly destination: Money;
}

export interface GetStatusRequest {
  /** Caller-supplied idempotency key: repeating the call replays the status. */
  readonly idempotencyKey: string;
  readonly transferId: string;
}

export interface TransferStatus {
  readonly transferId: string;
  readonly status: SettlementStatus;
  readonly failureReason?: string | undefined;
}

export interface FetchStatementRequest {
  /** Caller-supplied idempotency key: repeating the call replays the statement. */
  readonly idempotencyKey: string;
  /** ISO-8601 timestamp; lines settled before it may be omitted. */
  readonly since: string;
}

export interface StatementLine {
  readonly transferId: string;
  readonly status: SettlementStatus;
  readonly source: Money;
  readonly destination: Money;
  readonly settledAt?: string | undefined;
}

export interface Statement {
  readonly lines: readonly StatementLine[];
}

/**
 * The custody-agnostic seam every settlement partner sits behind.
 *
 * No business logic may branch on which implementation is in use (rule 7):
 * everything a caller needs is on this interface, and the interface module
 * depends on nothing but the Money type. Every method is idempotent by a
 * caller-supplied key (rule 6): assume at-least-once delivery everywhere.
 */
export interface SettlementProvider {
  quote(request: QuoteRequest): Promise<Quote>;
  initiate(request: InitiateRequest): Promise<Transfer>;
  getStatus(request: GetStatusRequest): Promise<TransferStatus>;
  fetchStatement(request: FetchStatementRequest): Promise<Statement>;
}
