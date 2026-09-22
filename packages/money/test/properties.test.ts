import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { add, equals, money, negate, subtract } from "../src/index.js";

const amountArb = fc.bigInt({ min: -(10n ** 24n), max: 10n ** 24n });
const usdArb = amountArb.map((amount) => money(amount, "USD"));

describe("arithmetic laws", () => {
  it("add is commutative", () => {
    fc.assert(
      fc.property(usdArb, usdArb, (a, b) => {
        expect(equals(add(a, b), add(b, a))).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("add is associative", () => {
    fc.assert(
      fc.property(usdArb, usdArb, usdArb, (a, b, c) => {
        expect(equals(add(add(a, b), c), add(a, add(b, c)))).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("subtract undoes add", () => {
    fc.assert(
      fc.property(usdArb, usdArb, (a, b) => {
        expect(equals(subtract(add(a, b), b), a)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("zero is the additive identity", () => {
    const zero = money(0n, "USD");
    fc.assert(
      fc.property(usdArb, (a) => {
        expect(equals(add(a, zero), a)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("negate is its own inverse, and a + (-a) is zero", () => {
    fc.assert(
      fc.property(usdArb, (a) => {
        expect(equals(negate(negate(a)), a)).toBe(true);
        expect(add(a, negate(a)).amount).toBe(0n);
      }),
      { numRuns: 500 },
    );
  });
});
