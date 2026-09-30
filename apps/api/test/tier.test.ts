import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CurrencyMismatchError, money, type Currency, type Money } from "@raices/money";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  TIERS,
  classify,
  type RecurringRuleSnapshot,
  type Tier,
  type TierInput,
} from "../src/requests/tier/index.js";

/**
 * P2.4 tier classification.
 *
 * The classifier is pure, so every case here is a plain value comparison with
 * no database anywhere. That is the point of the split: the decision that
 * governs whether money moves without a human is exhaustively table-testable.
 *
 * Each case cites the line it comes from. Where the PRD and the ticket are
 * silent, the case says so rather than asserting a rule nobody wrote.
 */

const CATEGORY = "c0000000-0000-4000-8000-000000000001";
const ELSEWHERE = "c0000000-0000-4000-8000-000000000002";

const usd = (minor: bigint): Money => money(minor, "USD");

interface Build {
  readonly amount?: Money;
  readonly categoryId?: string | null;
  readonly isEmergency?: boolean;
  /** Undefined is a plan whose version has this category; null is no plan. */
  readonly cap?: Money | null;
  readonly planCategoryId?: string;
  readonly noPlan?: boolean;
  readonly spendToDate?: Money;
  readonly rule?: RecurringRuleSnapshot | null;
}

function build(b: Build): TierInput {
  const categoryId = b.categoryId === undefined ? CATEGORY : b.categoryId;
  return {
    request: {
      amount: b.amount ?? usd(10_00n),
      categoryId,
      isEmergency: b.isEmergency ?? false,
    },
    planVersion:
      b.noPlan === true
        ? null
        : {
            id: "v0000000-0000-4000-8000-000000000001",
            categories: [
              { id: b.planCategoryId ?? categoryId ?? CATEGORY, monthlyCap: b.cap ?? null },
            ],
          },
    spendToDate: b.spendToDate ?? usd(0n),
    recurringRule: b.rule ?? null,
  };
}

function activeRule(amount: Money, categoryId = CATEGORY): RecurringRuleSnapshot {
  return { categoryId, amount, status: "active" };
}

interface Case {
  readonly name: string;
  readonly input: TierInput;
  readonly expected: Tier;
}

const CASES: readonly Case[] = [
  // --- emergency -----------------------------------------------------------
  // PRD: "Marked urgent by recipient". Line 220: emergency removes the
  // plan-match gate, so it is decided before anything about the plan is read.
  {
    name: "emergency with no plan at all",
    input: build({ isEmergency: true, noPlan: true }),
    expected: "emergency",
  },
  {
    name: "emergency over the cap",
    input: build({ isEmergency: true, cap: usd(5_00n), amount: usd(500_00n) }),
    expected: "emergency",
  },
  {
    name: "emergency in a category the plan does not have",
    input: build({ isEmergency: true, planCategoryId: ELSEWHERE }),
    expected: "emergency",
  },
  {
    // Emergency over recurring is the stricter of the two: recurring
    // auto-approves, emergency asks. Marking a request urgent can therefore
    // never remove a gate that would otherwise have applied.
    name: "emergency inside an active recurring rule",
    input: build({ isEmergency: true, rule: activeRule(usd(10_00n)) }),
    expected: "emergency",
  },

  // --- recurring -----------------------------------------------------------
  // PRD: "Pre-approved, on schedule, within parameters" -> auto-approved.
  {
    name: "active rule, amount exactly the approved amount",
    input: build({ amount: usd(10_00n), rule: activeRule(usd(10_00n)) }),
    expected: "recurring",
  },
  {
    name: "active rule, amount under the approved amount, zero spend to date",
    input: build({ amount: usd(9_99n), spendToDate: usd(0n), rule: activeRule(usd(10_00n)) }),
    expected: "recurring",
  },
  {
    name: "active rule, spend to date plus amount exactly at the cap",
    input: build({
      amount: usd(10_00n),
      spendToDate: usd(90_00n),
      cap: usd(100_00n),
      rule: activeRule(usd(10_00n)),
    }),
    expected: "recurring",
  },
  {
    name: "active rule in an uncapped category",
    input: build({ cap: null, amount: usd(10_00n), rule: activeRule(usd(10_00n)) }),
    expected: "recurring",
  },

  // --- not on a schedule, so not auto-approvable ---------------------------
  // Nothing pre-approved these, so there is no basis to move money without a
  // person. They are not "outside plan or over cap" either — they are simply
  // requests this classifier cannot positively categorise, and unrecognized
  // is where anything it cannot categorise belongs. See the module comment.
  {
    name: "in plan, within cap, no rule, zero spend to date",
    input: build({ amount: usd(10_00n), spendToDate: usd(0n), cap: usd(100_00n) }),
    expected: "unrecognized",
  },
  {
    name: "in plan, spend to date plus amount exactly at the cap, no rule",
    input: build({ amount: usd(10_00n), spendToDate: usd(90_00n), cap: usd(100_00n) }),
    expected: "unrecognized",
  },
  {
    name: "in plan, uncapped category, no rule",
    input: build({ cap: null, amount: usd(5_000_00n) }),
    expected: "unrecognized",
  },

  // --- unrecognized --------------------------------------------------------
  // PRD: "Outside plan or over cap" -> flagged for approval.
  {
    name: "no plan at all",
    input: build({ noPlan: true }),
    expected: "unrecognized",
  },
  {
    name: "category is not in the plan version in force",
    input: build({ planCategoryId: ELSEWHERE }),
    expected: "unrecognized",
  },
  {
    name: "one minor unit over the cap, no rule",
    input: build({ amount: usd(10_01n), spendToDate: usd(90_00n), cap: usd(100_00n) }),
    expected: "unrecognized",
  },
  {
    // Feature 2: "Requests in a recurring category exceeding the approved
    // amount are flagged for manual approval, never auto-rejected."
    name: "one minor unit over the cap in a recurring category",
    input: build({
      amount: usd(10_01n),
      spendToDate: usd(90_00n),
      cap: usd(100_00n),
      rule: activeRule(usd(50_00n)),
    }),
    expected: "unrecognized",
  },
  {
    name: "one minor unit over the rule's approved amount, within the cap",
    input: build({ amount: usd(10_01n), cap: usd(100_00n), rule: activeRule(usd(10_00n)) }),
    expected: "unrecognized",
  },
  {
    // Feature 2 edge case: "Schedule paused -> requests in that category flag
    // for manual approval with an explanatory note."
    name: "paused rule, within the approved amount",
    input: build({ amount: usd(10_00n), rule: { ...activeRule(usd(10_00n)), status: "paused" } }),
    expected: "unrecognized",
  },
  {
    name: "cancelled rule, within the approved amount",
    input: build({
      amount: usd(10_00n),
      rule: { ...activeRule(usd(10_00n)), status: "cancelled" },
    }),
    expected: "unrecognized",
  },
  {
    // A cap of zero is a cap, not the absence of one (0005_plans.sql).
    name: "cap of zero with zero spend to date",
    input: build({ amount: usd(1n), spendToDate: usd(0n), cap: usd(0n) }),
    expected: "unrecognized",
  },
  {
    name: "already at the cap, so any further spend is over it",
    input: build({ amount: usd(1n), spendToDate: usd(100_00n), cap: usd(100_00n) }),
    expected: "unrecognized",
  },
];

describe("classify", () => {
  for (const c of CASES) {
    it(`${c.expected}: ${c.name}`, () => {
      expect(classify(c.input)).toBe(c.expected);
    });
  }

  it("covers every reachable tier", () => {
    // Without this, dropping the last case for a tier leaves the suite green
    // and that tier untested. `planned_investment` is excluded deliberately:
    // it is unreachable, which the next block proves rather than assumes.
    expect(new Set(CASES.map((c) => c.expected))).toEqual(
      new Set(TIERS.filter((t) => t !== "planned_investment")),
    );
  });
});

describe("classify boundaries past 2^53", () => {
  // 2^53 and 2^53 + 1 are distinct bigints that collapse onto the *same*
  // double. Any comparison on this path that went through a number would call
  // them equal, so "exactly at the limit" and "one minor unit over" would
  // classify the same way. These four cases are the only reason that is not
  // silently true. (9007199254740993 and ...994 do not work: they survive the
  // round trip as distinct doubles and prove nothing.)
  const TWO_53 = usd(9_007_199_254_740_992n);
  const ONE_OVER = usd(9_007_199_254_740_993n);

  describe("against the cap", () => {
    // Generous enough that the rule is not what decides these.
    const rule = activeRule(usd(9_007_199_254_740_999n));

    it("treats exactly the cap as within it", () => {
      expect(classify(build({ amount: TWO_53, spendToDate: usd(0n), cap: TWO_53, rule }))).toBe(
        "recurring",
      );
    });

    it("treats one minor unit over the cap as over it", () => {
      expect(classify(build({ amount: ONE_OVER, spendToDate: usd(0n), cap: TWO_53, rule }))).toBe(
        "unrecognized",
      );
    });
  });

  describe("against the rule's approved amount", () => {
    it("treats exactly the approved amount as within parameters", () => {
      expect(classify(build({ amount: TWO_53, cap: null, rule: activeRule(TWO_53) }))).toBe(
        "recurring",
      );
    });

    it("treats one minor unit over the approved amount as over it", () => {
      expect(classify(build({ amount: ONE_OVER, cap: null, rule: activeRule(TWO_53) }))).toBe(
        "unrecognized",
      );
    });
  });

  it("adds the spend to date without losing a minor unit", () => {
    // The sum crosses 2^53 even though neither side does: as doubles the
    // addition would round back onto the cap and call this within it.
    const cap = usd(9_007_199_254_740_992n);
    const spendToDate = usd(9_007_199_254_740_991n);
    const rule = activeRule(usd(10n));
    expect(classify(build({ amount: usd(2n), spendToDate, cap, rule }))).toBe("unrecognized");
    expect(classify(build({ amount: usd(1n), spendToDate, cap, rule }))).toBe("recurring");
  });
});

describe("planned_investment is declared but unreachable", () => {
  /**
   * The CTO's call on this PR: the PRD defines the tier as milestone-gated,
   * there are no milestones in the data model, so the honest state of the
   * system is that it cannot be detected. It must not be reached by
   * elimination — that would hand every request the other definitions do not
   * claim the appearance of a pre-agreed one.
   *
   * Two tests, because they fail on different days. The sweep proves nothing
   * in today's input space produces it. The source check is the tripwire: the
   * moment someone teaches the classifier to return it, this fails and the
   * decision gets made on purpose.
   */

  it("is never produced by any combination of the current inputs", () => {
    const amounts = [usd(0n), usd(1n), usd(10_00n), usd(10_01n), usd(5_000_00n)];
    const caps: (Money | null)[] = [null, usd(0n), usd(9_99n), usd(10_00n), usd(10_01n)];
    const spends = [usd(0n), usd(1n), usd(90_00n)];
    const ruleAmounts = [usd(1n), usd(10_00n), usd(10_01n)];
    const statuses: RecurringRuleSnapshot["status"][] = ["active", "paused", "cancelled"];

    const rules: (RecurringRuleSnapshot | null)[] = [null];
    for (const amount of ruleAmounts) {
      for (const status of statuses) rules.push({ categoryId: CATEGORY, amount, status });
    }

    const seen = new Set<Tier>();
    let combinations = 0;

    for (const amount of amounts) {
      for (const cap of caps) {
        for (const spendToDate of spends) {
          for (const rule of rules) {
            for (const isEmergency of [false, true]) {
              for (const shape of [
                "in-plan",
                "other-category",
                "no-category",
                "no-plan",
              ] as const) {
                combinations += 1;
                seen.add(
                  classify(
                    build({
                      amount,
                      cap,
                      spendToDate,
                      rule,
                      isEmergency,
                      noPlan: shape === "no-plan",
                      ...(shape === "other-category" ? { planCategoryId: ELSEWHERE } : {}),
                      ...(shape === "no-category" ? { categoryId: null } : {}),
                    }),
                  ),
                );
              }
            }
          }
        }
      }
    }

    expect(combinations).toBeGreaterThan(1_000);
    expect(seen).toEqual(new Set<Tier>(["recurring", "emergency", "unrecognized"]));
  });

  it("is not returned anywhere in the classifier's source", () => {
    // The sweep only covers inputs that exist today. A milestone input added
    // later would not appear in it, so the tier could start being produced
    // with the sweep still green. This does not depend on the input space.
    const source = readFileSync(
      fileURLToPath(new URL("../src/requests/tier/index.ts", import.meta.url)),
      "utf8",
    );
    const returns = source.split("\n").filter((line) => /return\s+"planned_investment"/.test(line));

    expect(
      returns,
      "The classifier now returns planned_investment. The PRD defines it as " +
        "milestone-gated; if milestones exist, decide deliberately how a request " +
        "becomes one, add the boundary cases to the table above, and replace both " +
        "of these tests with assertions about the new rule.",
    ).toEqual([]);
  });
});

describe("classify refuses inputs it cannot compare", () => {
  it("throws when the request and the cap are in different currencies", () => {
    expect(() => classify(build({ amount: usd(10_00n), cap: money(100_00n, "GTQ") }))).toThrow(
      CurrencyMismatchError,
    );
  });

  it("throws when the request and the spend to date are in different currencies", () => {
    expect(() =>
      classify(
        build({ amount: usd(10_00n), spendToDate: money(10_00n, "GTQ"), cap: usd(100_00n) }),
      ),
    ).toThrow(CurrencyMismatchError);
  });

  it("throws when the request and the rule are in different currencies", () => {
    expect(() =>
      classify(build({ amount: usd(10_00n), rule: activeRule(money(10_00n, "GTQ")) })),
    ).toThrow(CurrencyMismatchError);
  });

  it("throws when handed a rule belonging to another category", () => {
    expect(() => classify(build({ rule: activeRule(usd(10_00n), ELSEWHERE) }))).toThrow(
      /another category/i,
    );
  });
});

/** Two structurally equal inputs built independently of one another. */
const arbInputs = fc
  .record({
    amount: fc.bigInt({ min: 1n, max: 10n ** 15n }),
    spend: fc.bigInt({ min: 0n, max: 10n ** 15n }),
    cap: fc.option(fc.bigInt({ min: 0n, max: 10n ** 15n }), { nil: null }),
    ruleAmount: fc.option(fc.bigInt({ min: 1n, max: 10n ** 15n }), { nil: null }),
    ruleStatus: fc.constantFrom<RecurringRuleSnapshot["status"]>("active", "paused", "cancelled"),
    isEmergency: fc.boolean(),
    hasPlan: fc.boolean(),
    inPlan: fc.boolean(),
    currency: fc.constantFrom<Currency>("USD", "GTQ"),
  })
  .map((r) => {
    const make = (): TierInput =>
      build({
        amount: money(r.amount, r.currency),
        spendToDate: money(r.spend, r.currency),
        cap: r.cap === null ? null : money(r.cap, r.currency),
        noPlan: !r.hasPlan,
        planCategoryId: r.inPlan ? CATEGORY : ELSEWHERE,
        isEmergency: r.isEmergency,
        rule:
          r.ruleAmount === null
            ? null
            : {
                categoryId: CATEGORY,
                amount: money(r.ruleAmount, r.currency),
                status: r.ruleStatus,
              },
      });
    return [make(), make()] as const;
  });

describe("classify is deterministic", () => {
  it("gives the same tier for structurally equal inputs", () => {
    fc.assert(
      fc.property(arbInputs, ([a, b]) => {
        expect(classify(b)).toBe(classify(a));
      }),
      { numRuns: 1_000 },
    );
  });

  it("gives the same tier when called repeatedly on one input", () => {
    fc.assert(
      fc.property(arbInputs, ([a]) => {
        const first = classify(a);
        for (let i = 0; i < 5; i += 1) expect(classify(a)).toBe(first);
      }),
      { numRuns: 500 },
    );
  });

  it("does not mutate its input", () => {
    fc.assert(
      fc.property(arbInputs, ([a]) => {
        const before = JSON.stringify(a, (_k, v: unknown) =>
          typeof v === "bigint" ? v.toString() : v,
        );
        classify(a);
        const after = JSON.stringify(a, (_k, v: unknown) =>
          typeof v === "bigint" ? v.toString() : v,
        );
        expect(after).toBe(before);
      }),
      { numRuns: 200 },
    );
  });
});
