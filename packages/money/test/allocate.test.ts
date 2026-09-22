import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { InvalidWeightsError, allocate, money } from "../src/index.js";

const usd = (amount: bigint) => money(amount, "USD");
const amounts = (parts: readonly { amount: bigint }[]) => parts.map((part) => part.amount);

describe("allocate", () => {
  it("splits 100 three ways as 34, 33, 33", () => {
    expect(amounts(allocate(usd(100n), [1n, 1n, 1n]))).toEqual([34n, 33n, 33n]);
  });

  it("gives leftovers to the largest remainders, ties by earliest index", () => {
    // 10 split 1:1:1 leaves 1 over after 3 each; the tie goes to index 0.
    expect(amounts(allocate(usd(10n), [1n, 1n, 1n]))).toEqual([4n, 3n, 3n]);
    // 100 split 1:2:3 is 16.66, 33.33, 50.0 -> bases 16, 33, 50, one left.
    expect(amounts(allocate(usd(100n), [1n, 2n, 3n]))).toEqual([17n, 33n, 50n]);
  });

  it("allocates exactly when the split is even", () => {
    expect(amounts(allocate(usd(99n), [1n, 1n, 1n]))).toEqual([33n, 33n, 33n]);
  });

  it("handles a single weight", () => {
    expect(amounts(allocate(usd(100n), [7n]))).toEqual([100n]);
  });

  it("honours weight magnitude, not just count", () => {
    expect(amounts(allocate(usd(100n), [1n, 3n]))).toEqual([25n, 75n]);
  });

  it("allows a zero weight, which receives nothing", () => {
    expect(amounts(allocate(usd(100n), [0n, 1n]))).toEqual([0n, 100n]);
  });

  it("preserves the currency on every part", () => {
    for (const part of allocate(money(100n, "GTQ"), [1n, 1n])) {
      expect(part.currency).toBe("GTQ");
    }
  });

  it("allocates zero to every part", () => {
    expect(amounts(allocate(usd(0n), [1n, 1n, 1n]))).toEqual([0n, 0n, 0n]);
  });

  describe("negative amounts", () => {
    it("mirrors the positive split", () => {
      expect(amounts(allocate(usd(-100n), [1n, 1n, 1n]))).toEqual([-34n, -33n, -33n]);
    });

    it("still sums exactly", () => {
      const parts = amounts(allocate(usd(-101n), [1n, 1n, 1n]));
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(-101n);
    });
  });

  it.each([
    ["an empty weight list", [] as bigint[]],
    ["weights that sum to zero", [0n, 0n]],
    ["a negative weight", [1n, -1n]],
  ])("rejects %s", (_label, weights) => {
    expect(() => allocate(usd(100n), weights)).toThrow(InvalidWeightsError);
  });

  it("rejects a non-bigint weight at runtime", () => {
    expect(() => allocate(usd(100n), [1, 1] as unknown as bigint[])).toThrow(InvalidWeightsError);
  });

  describe("properties", () => {
    const amountArb = fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n });
    const weightsArb = fc.array(fc.bigInt({ min: 1n, max: 10n ** 6n }), {
      minLength: 1,
      maxLength: 20,
    });

    it("parts sum exactly to the input, and each is within one minor unit of its exact share", () => {
      fc.assert(
        fc.property(amountArb, weightsArb, (amount, weights) => {
          const parts = amounts(allocate(usd(amount), weights));
          const total = weights.reduce((a, b) => a + b, 0n);

          expect(parts).toHaveLength(weights.length);
          expect(parts.reduce((a, b) => a + b, 0n)).toBe(amount);

          // |part - amount*w/total| < 1, stated without leaving the integers.
          weights.forEach((weight, index) => {
            const part = parts[index] ?? 0n;
            const deviation = part * total - amount * weight;
            expect(deviation < total && deviation > -total).toBe(true);
          });
        }),
        { numRuns: 500 },
      );
    });

    it("is unchanged by allocating an already-exact split", () => {
      fc.assert(
        fc.property(fc.bigInt({ min: 0n, max: 10n ** 12n }), (share) => {
          expect(amounts(allocate(usd(share * 4n), [1n, 1n, 1n, 1n]))).toEqual([
            share,
            share,
            share,
            share,
          ]);
        }),
        { numRuns: 200 },
      );
    });
  });
});
