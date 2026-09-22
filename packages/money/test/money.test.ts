import { describe, expect, it } from "vitest";

import {
  CurrencyMismatchError,
  InvalidAmountError,
  InvalidCurrencyError,
  InvalidDecimalStringError,
  add,
  compare,
  equals,
  format,
  fromMajorString,
  isNegative,
  isZero,
  money,
  negate,
  subtract,
} from "../src/index.js";

const usd = (amount: bigint) => money(amount, "USD");
const gtq = (amount: bigint) => money(amount, "GTQ");

describe("money", () => {
  it("represents $10.00 as 1000 minor units", () => {
    const m = money(1000n, "USD");
    expect(m.amount).toBe(1000n);
    expect(m.currency).toBe("USD");
  });

  it("is frozen", () => {
    const m = money(1000n, "USD");
    expect(Object.isFrozen(m)).toBe(true);
    expect(() => {
      // @ts-expect-error amount is readonly; this checks the runtime freeze too.
      m.amount = 1n;
    }).toThrow();
  });

  it("rejects a float amount at runtime", () => {
    expect(() => money(10.5 as unknown as bigint, "USD")).toThrow(InvalidAmountError);
  });

  it.each([[0], [1], [-1], [Number.NaN], [Number.MAX_SAFE_INTEGER]])(
    "rejects the number %p at runtime",
    (value) => {
      expect(() => money(value as unknown as bigint, "USD")).toThrow(InvalidAmountError);
    },
  );

  it.each([["1000"], [null], [undefined], [{}], [[]], [true]])(
    "rejects the non-bigint %p at runtime",
    (value) => {
      expect(() => money(value as unknown as bigint, "USD")).toThrow(InvalidAmountError);
    },
  );

  it("rejects an unknown currency", () => {
    expect(() => money(1000n, "EUR" as unknown as "USD")).toThrow(InvalidCurrencyError);
  });

  it("accepts negative and zero amounts", () => {
    expect(usd(-1n).amount).toBe(-1n);
    expect(usd(0n).amount).toBe(0n);
  });
});

describe("fromMajorString", () => {
  it.each([
    ["10.50", 1050n],
    ["10.5", 1050n],
    ["10", 1000n],
    ["0.01", 1n],
    ["0", 0n],
    ["-0", 0n],
    ["-10.50", -1050n],
    ["-0.01", -1n],
    ["0.00", 0n],
    ["123456789012345678901234567890.99", 12345678901234567890123456789099n],
  ])("parses %s to %p minor units", (input, expected) => {
    expect(fromMajorString(input, "USD").amount).toBe(expected);
  });

  it.each([
    ["10.505"], // more decimals than the exponent allows
    ["10.000"],
    [""],
    ["."],
    ["10."],
    [".50"],
    ["+10.50"],
    [" 10.50"],
    ["10.50 "],
    ["1e2"],
    ["0x10"],
    ["10,50"],
    ["--10"],
    ["abc"],
    ["Infinity"],
    ["NaN"],
  ])("rejects %p", (input) => {
    expect(() => fromMajorString(input, "USD")).toThrow(InvalidDecimalStringError);
  });

  it("rejects a non-string at runtime", () => {
    expect(() => fromMajorString(10.5 as unknown as string, "USD")).toThrow(
      InvalidDecimalStringError,
    );
  });
});

describe("binary operations", () => {
  it("adds and subtracts within one currency", () => {
    expect(add(usd(1000n), usd(250n)).amount).toBe(1250n);
    expect(subtract(usd(1000n), usd(250n)).amount).toBe(750n);
  });

  it.each([
    ["add", () => add(usd(1000n), gtq(1000n))],
    ["subtract", () => subtract(usd(1000n), gtq(1000n))],
    ["compare", () => compare(usd(1000n), gtq(1000n))],
    ["equals", () => equals(usd(1000n), gtq(1000n))],
  ])("%s throws CurrencyMismatchError across currencies", (_name, run) => {
    expect(run).toThrow(CurrencyMismatchError);
  });

  it("negate flips the sign and keeps the currency", () => {
    expect(negate(usd(1000n))).toEqual(usd(-1000n));
    expect(negate(usd(-1000n))).toEqual(usd(1000n));
    expect(negate(usd(0n)).amount).toBe(0n);
  });

  it("compare orders by amount", () => {
    expect(compare(usd(1n), usd(2n))).toBe(-1);
    expect(compare(usd(2n), usd(1n))).toBe(1);
    expect(compare(usd(2n), usd(2n))).toBe(0);
  });

  it("equals compares amount within a currency", () => {
    expect(equals(usd(2n), usd(2n))).toBe(true);
    expect(equals(usd(2n), usd(3n))).toBe(false);
  });

  it("isZero and isNegative", () => {
    expect(isZero(usd(0n))).toBe(true);
    expect(isZero(usd(1n))).toBe(false);
    expect(isNegative(usd(-1n))).toBe(true);
    expect(isNegative(usd(0n))).toBe(false);
    expect(isNegative(usd(1n))).toBe(false);
  });
});

describe("format", () => {
  it("renders minor units as a localised currency string", () => {
    expect(format(usd(1050n), "en-US")).toBe("$10.50");
    expect(format(usd(0n), "en-US")).toBe("$0.00");
    expect(format(usd(-1050n), "en-US")).toContain("10.50");
  });

  it("does not lose precision past Number.MAX_SAFE_INTEGER", () => {
    // 2^53 exceeded: a float round-trip would render ...000.00 here.
    const huge = usd(1234567890123456789099n);
    expect(format(huge, "en-US")).toBe("$12,345,678,901,234,567,890.99");
  });

  it("formats GTQ", () => {
    expect(format(gtq(123450n), "es-GT")).toContain("1,234.50");
  });
});
