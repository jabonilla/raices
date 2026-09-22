import { InvalidCurrencyError } from "./errors.js";

/** ISO 4217 codes this package supports. FX between them is a later ticket. */
export type Currency = "USD" | "GTQ";

/**
 * Minor-unit exponent per currency: the number of decimal places in the major
 * unit. Both supported currencies happen to use 2, but the table is the thing
 * code reads, never the constant 2.
 */
const MINOR_UNIT_EXPONENTS = {
  USD: 2,
  GTQ: 2,
} as const satisfies Record<Currency, number>;

export const SUPPORTED_CURRENCIES = Object.keys(MINOR_UNIT_EXPONENTS) as readonly Currency[];

export function minorUnitExponent(currency: Currency): number {
  return MINOR_UNIT_EXPONENTS[currency];
}

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && Object.hasOwn(MINOR_UNIT_EXPONENTS, value);
}

export function assertCurrency(value: unknown): asserts value is Currency {
  if (!isCurrency(value)) {
    throw new InvalidCurrencyError(value, SUPPORTED_CURRENCIES);
  }
}
