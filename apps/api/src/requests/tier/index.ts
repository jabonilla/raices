import { add, compare, type Money } from "@raices/money";

/**
 * P2.4 — trust tier classification.
 *
 * A pure function. Its inputs are values the caller has already read: the
 * request, the plan version in force, the spend to date in that category, and
 * any recurring rule. Nothing here opens a connection, and a lint rule in
 * eslint.config.js refuses a database import anywhere under this directory.
 *
 * That is not tidiness. This decision governs whether money can move without
 * a person looking at it, so it has to be exhaustively testable — every tier,
 * every boundary, in a table, with no container and no fixtures.
 *
 * ## Where each tier comes from
 *
 * PRD section 7 gives four tiers and presents them as covering every request:
 *
 * | Recurring          | Pre-approved, on schedule, within parameters |
 * | Planned investment | Large, milestone-gated                       |
 * | Emergency          | Marked urgent by recipient                   |
 * | Unrecognized       | Outside plan or over cap                     |
 *
 * Three of those are decidable from the inputs above. `planned_investment` is
 * not: "large, milestone-gated" needs a milestone, and there is no milestone
 * or goal anywhere in the PRD's data model — the mechanism is marked P1 and
 * the stages appear only in the design system. So it is reached by
 * elimination, which the definitions support: a request inside the plan and
 * within its cap is not "outside plan or over cap", so it is not
 * unrecognized; with no rule behind it, it is not "on schedule", so it is not
 * recurring. It is the planned, one-off spend, and holding it for
 * verification is what P1 adds on top.
 *
 * That elimination is the one interpretive step in this module and it is
 * called out in the PR. Everything else below cites a line.
 */

/** Every tier, in the order PRD section 7 lists them. */
export const TIERS = ["recurring", "planned_investment", "emergency", "unrecognized"] as const;

export type Tier = (typeof TIERS)[number];

/** A recurring rule's lifecycle, per the PRD's `RecurringRule` entity. */
export type RecurringRuleStatus = "active" | "paused" | "cancelled";

/** What the classifier needs of a recurring rule. Not a database row. */
export interface RecurringRuleSnapshot {
  readonly categoryId: string;
  /** The approved amount per run. */
  readonly amount: Money;
  readonly status: RecurringRuleStatus;
}

/** What the classifier needs of a category in the plan version in force. */
export interface TierCategory {
  readonly id: string;
  /** Null is no cap. A cap of zero is a cap, and forbids spending. */
  readonly monthlyCap: Money | null;
}

export interface TierPlanVersion {
  readonly id: string;
  readonly categories: readonly TierCategory[];
}

export interface TierRequest {
  readonly amount: Money;
  /** Null when the request names no category from any plan. */
  readonly categoryId: string | null;
  readonly isEmergency: boolean;
}

export interface TierInput {
  readonly request: TierRequest;
  /** Null when the relationship has no plan at all. */
  readonly planVersion: TierPlanVersion | null;
  /**
   * Already spent in this category for the cap's period.
   *
   * The caller decides what the period is. The PRD fixes a timezone for
   * schedules and digests but not for cap windows, so this module does not
   * pick one: it is handed a number and compares it.
   */
  readonly spendToDate: Money;
  readonly recurringRule: RecurringRuleSnapshot | null;
}

/**
 * Classify a request into a trust tier.
 *
 * Deterministic and total over inputs whose currencies agree. A currency
 * mismatch throws `CurrencyMismatchError` rather than picking a tier: two
 * amounts in different currencies have no order, and guessing one here is how
 * a cap silently stops applying.
 */
export function classify(input: TierInput): Tier {
  const { request, planVersion, spendToDate, recurringRule } = input;

  // PRD line 220: emergency "removes the plan-match gate; it does not promise
  // faster settlement". So it is decided before anything about the plan is
  // read — including before a missing plan would make this unrecognized.
  //
  // It also wins over `recurring`, which is the stricter reading: recurring
  // auto-approves and emergency asks, so marking a request urgent can never
  // remove a gate that would otherwise have applied.
  if (request.isEmergency) return "emergency";

  // "Outside plan": no plan, no category, or a category this version does not
  // have. A request pointing at a category from an older version is outside
  // the plan in force, which is the same answer.
  if (planVersion === null || request.categoryId === null) return "unrecognized";

  const categoryId = request.categoryId;
  const category = planVersion.categories.find((c) => c.id === categoryId);
  if (category === undefined) return "unrecognized";

  if (recurringRule !== null && recurringRule.categoryId !== categoryId) {
    // A caller bug, not a tier. Silently ignoring the rule would classify a
    // scheduled payment as one-off; silently applying it would let a rule for
    // Food approve a request for Housing.
    throw new Error(
      `Recurring rule is for another category (${recurringRule.categoryId}) than the ` +
        `request (${categoryId}). Pass the rule for the request's own category, or null.`,
    );
  }

  // "Over cap", checked before the rule: the ticket is explicit that a
  // request in a recurring category exceeding what is approved is flagged,
  // and Feature 2 that it is "never auto-rejected". Flagged is `unrecognized`
  // — the tier whose mechanism is "flagged for approval". It stays pending
  // for a person, which is the whole point of not auto-declining it.
  //
  // The cap is a monthly budget, so it applies to the total: what has been
  // spent plus what is being asked for. Exactly at the cap is within it.
  if (category.monthlyCap !== null) {
    const afterThis = add(spendToDate, request.amount);
    if (compare(afterThis, category.monthlyCap) > 0) return "unrecognized";
  }

  if (recurringRule !== null) {
    // Feature 2 edge case: "Schedule paused -> requests in that category flag
    // for manual approval with an explanatory note." A cancelled schedule is
    // no less stopped than a paused one.
    if (recurringRule.status !== "active") return "unrecognized";

    // "Within parameters" is the approved amount per run. One minor unit over
    // is over.
    return compare(request.amount, recurringRule.amount) <= 0 ? "recurring" : "unrecognized";
  }

  return "planned_investment";
}
