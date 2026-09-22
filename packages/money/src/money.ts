import { assertCurrency, minorUnitExponent, type Currency } from "./currency.js";
import {
  CurrencyMismatchError,
  InvalidAmountError,
  InvalidDecimalStringError,
  InvalidRatioError,
  InvalidRoundingModeError,
  InvalidWeightsError,
} from "./errors.js";

/**
 * An amount of money, as integer minor units plus its currency.
 *
 * 1000n USD is $10.00. The value is frozen, so it can be shared without
 * anyone mutating it underneath a caller.
 */
export interface Money {
  readonly amount: bigint;
  readonly currency: Currency;
}

/** Rounding is always explicit. There is no default anywhere in this package. */
export type RoundingMode = "HALF_EVEN" | "HALF_UP" | "DOWN" | "UP";

const ROUNDING_MODES: readonly RoundingMode[] = ["HALF_EVEN", "HALF_UP", "DOWN", "UP"];

/** Optional sign, digits, optionally a point and at least one more digit. */
const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;

function assertRoundingMode(value: unknown): asserts value is RoundingMode {
  if (typeof value !== "string" || !ROUNDING_MODES.includes(value as RoundingMode)) {
    throw new InvalidRoundingModeError(value, ROUNDING_MODES);
  }
}

/**
 * These validators take `unknown` rather than their narrowed type on purpose.
 * The types already say a caller cannot pass a float, but `as any` at a call
 * site defeats that, and a float reaching the ledger is the failure this
 * package exists to prevent. Typing the parameter `unknown` keeps the runtime
 * check live instead of being dead code the compiler can see past.
 */
function assertMoney(value: unknown): asserts value is Money {
  if (typeof value !== "object" || value === null) throw new InvalidAmountError(value);
  const candidate = value as { amount?: unknown; currency?: unknown };
  if (typeof candidate.amount !== "bigint") throw new InvalidAmountError(candidate.amount);
  assertCurrency(candidate.currency);
}

function assertRatio(value: unknown): asserts value is { num: bigint; den: bigint } {
  if (typeof value !== "object" || value === null) {
    throw new InvalidRatioError("expected { num, den }");
  }
  const candidate = value as { num?: unknown; den?: unknown };
  if (typeof candidate.num !== "bigint" || typeof candidate.den !== "bigint") {
    throw new InvalidRatioError("num and den must both be bigint");
  }
  if (candidate.den === 0n) {
    throw new InvalidRatioError("den must not be zero");
  }
}

function assertWeights(value: unknown): asserts value is readonly bigint[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidWeightsError("expected a non-empty array of weights");
  }
  // Array.isArray widens `unknown` to `any[]`; step back to `unknown` so each
  // element is actually checked rather than silently trusted.
  for (const weight of value as readonly unknown[]) {
    if (typeof weight !== "bigint") {
      throw new InvalidWeightsError("every weight must be a bigint");
    }
    if (weight < 0n) {
      throw new InvalidWeightsError("weights must not be negative");
    }
  }
}

function assertSameCurrency(left: Money, right: Money): void {
  assertMoney(left);
  assertMoney(right);
  if (left.currency !== right.currency) {
    throw new CurrencyMismatchError(left.currency, right.currency);
  }
}

/**
 * Build a Money from integer minor units.
 *
 * The bigint check is enforced at runtime as well as in the types, because a
 * `number` reaching here is the exact failure this package exists to prevent
 * and `as any` at a call site would otherwise slip it through.
 */
export function money(amount: bigint, currency: Currency): Money {
  if (typeof amount !== "bigint") throw new InvalidAmountError(amount);
  assertCurrency(currency);
  return Object.freeze({ amount, currency });
}

/**
 * Parse an exact decimal string in major units, e.g. "10.50" USD -> 1000n + 50n.
 *
 * Strict by design: no exponent notation, no thousands separators, no leading
 * "+", no surrounding whitespace, and never more decimal places than the
 * currency has minor units. Anything ambiguous is rejected rather than rounded.
 */
export function fromMajorString(value: string, currency: Currency): Money {
  assertCurrency(currency);

  if (typeof value !== "string") {
    throw new InvalidDecimalStringError(value, "expected a string");
  }
  if (!DECIMAL_PATTERN.test(value)) {
    throw new InvalidDecimalStringError(
      value,
      "expected an optional '-' followed by digits, optionally '.' and more digits",
    );
  }

  const exponent = minorUnitExponent(currency);
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const pointIndex = unsigned.indexOf(".");
  const integerPart = pointIndex === -1 ? unsigned : unsigned.slice(0, pointIndex);
  const fractionPart = pointIndex === -1 ? "" : unsigned.slice(pointIndex + 1);

  if (fractionPart.length > exponent) {
    throw new InvalidDecimalStringError(
      value,
      `${currency} has ${String(exponent)} minor-unit decimal places, found ${String(fractionPart.length)}`,
    );
  }

  const magnitude = BigInt(integerPart + fractionPart.padEnd(exponent, "0"));
  return money(negative ? -magnitude : magnitude, currency);
}

export function add(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return money(left.amount + right.amount, left.currency);
}

export function subtract(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return money(left.amount - right.amount, left.currency);
}

export function negate(value: Money): Money {
  assertMoney(value);
  return money(-value.amount, value.currency);
}

export function isZero(value: Money): boolean {
  assertMoney(value);
  return value.amount === 0n;
}

export function isNegative(value: Money): boolean {
  assertMoney(value);
  return value.amount < 0n;
}

/** -1 if left is smaller, 1 if larger, 0 if equal. Throws across currencies. */
export function compare(left: Money, right: Money): -1 | 0 | 1 {
  assertSameCurrency(left, right);
  if (left.amount < right.amount) return -1;
  if (left.amount > right.amount) return 1;
  return 0;
}

/**
 * Throws across currencies rather than returning false, so that comparing USD
 * to GTQ is reported as the mistake it is instead of silently being "not
 * equal".
 */
export function equals(left: Money, right: Money): boolean {
  assertSameCurrency(left, right);
  return left.amount === right.amount;
}

/**
 * Divide `numerator / denominator` to a whole number under an explicit mode.
 *
 * DOWN and UP are relative to zero, not to the number line: DOWN truncates
 * toward zero and UP moves away from it, so both are symmetric for negatives.
 */
function divideRounded(numerator: bigint, denominator: bigint, rounding: RoundingMode): bigint {
  // Normalise the sign onto the numerator so the remainder stays positive.
  const signedNumerator = denominator < 0n ? -numerator : numerator;
  const positiveDenominator = denominator < 0n ? -denominator : denominator;

  const negative = signedNumerator < 0n;
  const magnitude = negative ? -signedNumerator : signedNumerator;

  const quotient = magnitude / positiveDenominator;
  const remainder = magnitude % positiveDenominator;

  let result = quotient;
  if (remainder !== 0n) {
    const doubled = remainder * 2n;
    let roundAway: boolean;

    switch (rounding) {
      case "DOWN":
        roundAway = false;
        break;
      case "UP":
        roundAway = true;
        break;
      case "HALF_UP":
        roundAway = doubled >= positiveDenominator;
        break;
      case "HALF_EVEN":
        roundAway =
          doubled > positiveDenominator ||
          (doubled === positiveDenominator && quotient % 2n !== 0n);
        break;
    }

    if (roundAway) result += 1n;
  }

  return negative ? -result : result;
}

/**
 * Scale by an exact rational. The rounding mode is required and has no
 * default, because every silent rounding choice in a money system is a bug
 * waiting for a reconciliation to find it.
 */
export function multiply(
  value: Money,
  ratio: { num: bigint; den: bigint },
  rounding: RoundingMode,
): Money {
  assertMoney(value);
  // Validated before the arithmetic, so an unknown mode is caught even when
  // the division happens to come out exact.
  assertRoundingMode(rounding);
  assertRatio(ratio);

  return money(divideRounded(value.amount * ratio.num, ratio.den, rounding), value.currency);
}

/**
 * Split across weights using the largest-remainder method.
 *
 * The parts always sum exactly back to the input: leftover minor units go to
 * the parts with the largest remainders, and a tie goes to the earliest index.
 * A negative amount is split by magnitude and then signed, so it mirrors the
 * positive case exactly.
 */
export function allocate(value: Money, weights: readonly bigint[]): Money[] {
  assertMoney(value);
  assertWeights(weights);

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0n);
  if (totalWeight === 0n) {
    throw new InvalidWeightsError("weights must not all be zero");
  }

  const negative = value.amount < 0n;
  const magnitude = negative ? -value.amount : value.amount;

  const parts: bigint[] = [];
  const remainders: bigint[] = [];
  let distributed = 0n;

  for (const weight of weights) {
    const product = magnitude * weight;
    const part = product / totalWeight;
    parts.push(part);
    remainders.push(product % totalWeight);
    distributed += part;
  }

  // Strictly fewer than one unit per part is left over, by construction.
  let leftover = magnitude - distributed;

  const byRemainderThenIndex = parts
    .map((_, index) => index)
    .sort((a, b) => {
      const remainderA = remainders[a] ?? 0n;
      const remainderB = remainders[b] ?? 0n;
      if (remainderA > remainderB) return -1;
      if (remainderA < remainderB) return 1;
      return a - b;
    });

  for (const index of byRemainderThenIndex) {
    if (leftover <= 0n) break;
    parts[index] = (parts[index] ?? 0n) + 1n;
    leftover -= 1n;
  }

  return parts.map((part) => money(negative ? -part : part, value.currency));
}

/** Exact major-unit rendering, e.g. 1050n USD -> "10.50". Never a float. */
function toMajorString(value: Money): string {
  const exponent = minorUnitExponent(value.currency);
  const negative = value.amount < 0n;
  const digits = (negative ? -value.amount : value.amount).toString().padStart(exponent + 1, "0");

  const boundary = digits.length - exponent;
  const unsigned =
    exponent === 0 ? digits : `${digits.slice(0, boundary)}.${digits.slice(boundary)}`;

  return negative ? `-${unsigned}` : unsigned;
}

/**
 * Localised rendering for display only. Never feed the result back into
 * arithmetic.
 *
 * The exact decimal string is handed to Intl rather than a number, so amounts
 * past 2^53 render every digit instead of being silently rounded.
 */
export function format(value: Money, locale: string): string {
  assertMoney(value);
  const exponent = minorUnitExponent(value.currency);

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: value.currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(toMajorString(value));
}
