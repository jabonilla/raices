/** Thrown when a quote id has never been issued by this provider. */
export class UnknownQuoteError extends Error {
  readonly quoteId: string;

  constructor(quoteId: string) {
    super(`unknown quote id: ${quoteId}`);
    this.name = "UnknownQuoteError";
    this.quoteId = quoteId;
  }
}

/** Thrown when a transfer id has never been initiated with this provider. */
export class UnknownTransferError extends Error {
  readonly transferId: string;

  constructor(transferId: string) {
    super(`unknown transfer id: ${transferId}`);
    this.name = "UnknownTransferError";
    this.transferId = transferId;
  }
}

/**
 * Thrown when a value presented as Money is not `{ amount: bigint,
 * currency: ISO-4217 }`. Money is bigint minor units plus an ISO code
 * (rule 1); a `number` amount must fail loudly here, never reach money math.
 */
export class InvalidSettlementAmountError extends Error {
  readonly value: unknown;

  constructor(value: unknown) {
    super(
      `invalid money: expected { amount: bigint, currency: ISO-4217 code }, received ${String(value)}`,
    );
    this.name = "InvalidSettlementAmountError";
    this.value = value;
  }
}
