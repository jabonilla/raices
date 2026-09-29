import fc from "fast-check";
import { expect, it } from "vitest";
import { allocate, fromMajorString, money, multiply, negate } from "@raices/money";

const amount = fc.bigInt({ min: -(10n ** 100n), max: 10n ** 100n });
const weights = fc
  .array(fc.bigInt({ min: 0n, max: 10n ** 30n }), { minLength: 1, maxLength: 20 })
  .filter((values) => values.some((value) => value > 0n));

it("fuzzes signed allocation beyond both JS and SQL integer precision", () => {
  fc.assert(
    fc.property(amount, weights, fc.constantFrom("USD", "GTQ"), (minor, parts, currency) => {
      const input = money(minor, currency);
      const allocated = allocate(input, parts);
      const total = parts.reduce((a, b) => a + b, 0n);
      expect(allocated.reduce((sum, part) => sum + part.amount, 0n)).toBe(minor);
      expect(allocate(negate(input), parts).map((part) => part.amount)).toEqual(
        allocated.map((part) => -part.amount),
      );
      for (const [index, part] of allocated.entries()) {
        const error = part.amount * total - minor * (parts[index] ?? 0n);
        expect(error < total && error > -total).toBe(true);
      }
    }),
    { numRuns: 1000, seed: 3101 },
  );
});

it("fuzzes multiply sign symmetry and exact DOWN/UP bounds", () => {
  fc.assert(
    fc.property(
      amount,
      fc.bigInt({ min: -10000n, max: 10000n }),
      fc.bigInt({ min: 1n, max: 10000n }),
      (minor, numerator, denominator) => {
        const input = money(minor, "USD");
        const ratio = { num: numerator, den: denominator };
        const exact = minor * numerator;
        for (const rounding of ["DOWN", "UP", "HALF_UP", "HALF_EVEN"] as const) {
          const result = multiply(input, ratio, rounding);
          expect(multiply(negate(input), ratio, rounding).amount).toBe(-result.amount);
          expect(multiply(input, { num: -numerator, den: -denominator }, rounding)).toEqual(result);
          const error = result.amount * denominator - exact;
          expect(error > -denominator && error < denominator).toBe(true);
        }
      },
    ),
    { numRuns: 1000, seed: 3102 },
  );
});

it("round-trips exact decimal strings with more than 100 digits", () => {
  fc.assert(
    fc.property(amount, (minor) => {
      const magnitude = minor < 0n ? -minor : minor;
      const decimal = `${minor < 0n ? "-" : ""}${(magnitude / 100n).toString()}.${(magnitude % 100n).toString().padStart(2, "0")}`;
      expect(fromMajorString(decimal, "GTQ").amount).toBe(minor);
    }),
    { numRuns: 1000, seed: 3103 },
  );
});
