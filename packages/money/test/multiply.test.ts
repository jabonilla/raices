import { describe, expect, it } from "vitest";

import { InvalidRatioError, money, multiply, type RoundingMode } from "../src/index.js";

const usd = (amount: bigint) => money(amount, "USD");
const half = { num: 1n, den: 2n };

describe("multiply", () => {
  it("requires an explicit rounding mode", () => {
    // @ts-expect-error rounding has no default; omitting it must not compile.
    expect(() => multiply(usd(100n), half)).toThrow();
  });

  it("multiplies exactly when the result is whole", () => {
    expect(multiply(usd(1000n), { num: 3n, den: 1n }, "HALF_EVEN").amount).toBe(3000n);
    expect(multiply(usd(1000n), { num: 1n, den: 4n }, "HALF_EVEN").amount).toBe(250n);
  });

  it("keeps the currency", () => {
    expect(multiply(money(1000n, "GTQ"), half, "DOWN").currency).toBe("GTQ");
  });

  // 5/2 = 2.5 exactly, which is where the modes disagree.
  it.each<[RoundingMode, bigint]>([
    ["HALF_EVEN", 2n],
    ["HALF_UP", 3n],
    ["DOWN", 2n],
    ["UP", 3n],
  ])("rounds 2.5 with %s to %p", (rounding, expected) => {
    expect(multiply(usd(5n), half, rounding).amount).toBe(expected);
  });

  // 7/2 = 3.5; HALF_EVEN goes to 4 here, showing it is banker's rounding
  // rather than a fixed direction.
  it.each<[RoundingMode, bigint]>([
    ["HALF_EVEN", 4n],
    ["HALF_UP", 4n],
    ["DOWN", 3n],
    ["UP", 4n],
  ])("rounds 3.5 with %s to %p", (rounding, expected) => {
    expect(multiply(usd(7n), half, rounding).amount).toBe(expected);
  });

  // Below the halfway point: only UP moves away from zero.
  it.each<[RoundingMode, bigint]>([
    ["HALF_EVEN", 1n],
    ["HALF_UP", 1n],
    ["DOWN", 1n],
    ["UP", 2n],
  ])("rounds 1.25 with %s to %p", (rounding, expected) => {
    expect(multiply(usd(5n), { num: 1n, den: 4n }, rounding).amount).toBe(expected);
  });

  describe("negative amounts", () => {
    // DOWN is toward zero and UP is away from zero, so both are symmetric
    // about zero rather than being floor and ceiling.
    it.each<[RoundingMode, bigint]>([
      ["HALF_EVEN", -2n],
      ["HALF_UP", -3n],
      ["DOWN", -2n],
      ["UP", -3n],
    ])("rounds -2.5 with %s to %p", (rounding, expected) => {
      expect(multiply(usd(-5n), half, rounding).amount).toBe(expected);
    });

    it("treats a negative denominator as a negative ratio", () => {
      expect(multiply(usd(10n), { num: 1n, den: -2n }, "DOWN").amount).toBe(-5n);
      expect(multiply(usd(-10n), { num: 1n, den: -2n }, "DOWN").amount).toBe(5n);
    });
  });

  it("rejects a zero denominator", () => {
    expect(() => multiply(usd(100n), { num: 1n, den: 0n }, "DOWN")).toThrow(InvalidRatioError);
  });

  it("rejects non-bigint ratio components at runtime", () => {
    expect(() => multiply(usd(100n), { num: 1 as unknown as bigint, den: 2n }, "DOWN")).toThrow(
      InvalidRatioError,
    );
    expect(() => multiply(usd(100n), { num: 1n, den: 2 as unknown as bigint }, "DOWN")).toThrow(
      InvalidRatioError,
    );
  });

  it("rejects an unknown rounding mode at runtime", () => {
    expect(() => multiply(usd(100n), half, "HALF_DOWN" as RoundingMode)).toThrow();
  });
});
