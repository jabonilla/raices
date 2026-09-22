/**
 * Every error this package throws. They exist so a caller can tell a currency
 * mistake from a malformed input without matching on message text.
 */

export class CurrencyMismatchError extends Error {
  readonly left: string;
  readonly right: string;

  constructor(left: string, right: string) {
    super(`Cannot combine ${left} with ${right}: currencies must match`);
    this.name = "CurrencyMismatchError";
    this.left = left;
    this.right = right;
  }
}

export class InvalidAmountError extends Error {
  constructor(received: unknown) {
    super(
      `Money amounts are bigint minor units, received ${describe(received)}. ` +
        `Write 1000n rather than 1000, and never a float.`,
    );
    this.name = "InvalidAmountError";
  }
}

export class InvalidCurrencyError extends Error {
  constructor(received: unknown, supported: readonly string[]) {
    super(`Unsupported currency ${describe(received)}. Supported: ${supported.join(", ")}.`);
    this.name = "InvalidCurrencyError";
  }
}

export class InvalidDecimalStringError extends Error {
  constructor(received: unknown, reason: string) {
    super(`Cannot parse ${describe(received)} as a decimal amount: ${reason}`);
    this.name = "InvalidDecimalStringError";
  }
}

export class InvalidRatioError extends Error {
  constructor(reason: string) {
    super(`Invalid ratio: ${reason}`);
    this.name = "InvalidRatioError";
  }
}

export class InvalidRoundingModeError extends Error {
  constructor(received: unknown, supported: readonly string[]) {
    super(
      `Unknown rounding mode ${describe(received)}. Supported: ${supported.join(", ")}. ` +
        `Rounding is always explicit; there is no default.`,
    );
    this.name = "InvalidRoundingModeError";
  }
}

export class InvalidWeightsError extends Error {
  constructor(reason: string) {
    super(`Invalid allocation weights: ${reason}`);
    this.name = "InvalidWeightsError";
  }
}

/** A short, safe rendering of an arbitrary value for an error message. */
function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "a function";
  if (typeof value === "number") return `number ${value.toString()}`;
  if (typeof value === "boolean") return `boolean ${value.toString()}`;
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  return Array.isArray(value) ? "an array" : "an object";
}
