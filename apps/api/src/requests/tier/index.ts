import { CurrencyMismatchError, add, compare, type Money } from "@raices/money";

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
 * PRD section 7 gives four tiers:
 *
 * | Recurring          | Pre-approved, on schedule, within parameters |
 * | Planned investment | Large, milestone-gated                       |
 * | Emergency          | Marked urgent by recipient                   |
 * | Unrecognized       | Outside plan or over cap                     |
 *
 * Two of those this classifier can positively establish: `emergency`, which
 * the recipient marks, and `recurring`, which an active rule and a cap make
 * checkable. `planned_investment` it cannot — see the note on TIERS below.
 *
 * Everything it cannot establish returns `unrecognized`, which routes to
 * manual approval. That is deliberate, and it is not the same as guessing:
 * falling back to the tier that asks a person is the only safe answer when
 * the data to distinguish is missing. The alternative — treating whatever
 * the other definitions do not claim as the most legitimate-sounding tier —
 * would give a request nobody agreed to the appearance of a pre-agreed one.
 */

/**
 * Every tier, in the order PRD section 7 lists them.
 *
 * `planned_investment` is declared and **not currently reachable**. The PRD
 * defines it as "large, milestone-gated" and marks its mechanism — held,
 * released on verification — as P1. There is no milestone or goal anywhere
 * in the data model, so nothing among this function's inputs can establish
 * that a request is one. It stays in the enum because the tier is real and
 * the database stores it; it is simply not something we can yet detect.
 *
 * When milestones arrive, whoever adds them decides deliberately how a
 * request becomes one. `tier.test.ts` asserts the tier is unreachable today
 * and fails the moment the classifier can return it, so that decision cannot
 * be made by accident.
 */
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
 * Whether the request's currency can be compared with everything it will be
 * compared against.
 *
 * A precondition rather than something the happy path discovers: two amounts
 * in different currencies have no order, and a classifier that quietly
 * returned a tier for them would let a cap stop applying without anyone
 * noticing. Checked up front so the decision below can short-circuit freely
 * without changing whether a mismatch is reported.
 */
function assertComparable(input: TierInput): void {
  const { currency } = input.request.amount;

  const same = (other: Money | null | undefined): void => {
    if (other != null && other.currency !== currency) {
      throw new CurrencyMismatchError(currency, other.currency);
    }
  };

  same(input.spendToDate);
  same(input.recurringRule?.amount);
  same(input.planVersion?.categories.find((c) => c.id === input.request.categoryId)?.monthlyCap);
}

/**
 * Whether this request is "pre-approved, on schedule, within parameters" —
 * the PRD's definition of the recurring tier, and the only one of the three
 * non-emergency tiers this function can positively establish.
 *
 * Every `false` below is a distinct reason the request is not on a schedule,
 * and each one sends it to manual approval.
 */
function isPreApprovedSchedule(input: TierInput): boolean {
  const { request, planVersion, spendToDate, recurringRule } = input;

  // "Outside plan": no plan, no category named, or a category this version
  // does not have. A request pointing at a category from an older version is
  // outside the plan in force, which is the same answer.
  if (planVersion === null || request.categoryId === null) return false;

  const categoryId = request.categoryId;
  const category = planVersion.categories.find((c) => c.id === categoryId);
  if (category === undefined) return false;

  // Nothing pre-approved it.
  if (recurringRule === null) return false;

  if (recurringRule.categoryId !== categoryId) {
    // A caller bug, not a tier. Silently ignoring the rule would send a
    // scheduled payment to manual approval; silently applying it would let a
    // rule for Food auto-approve a request for Housing.
    throw new Error(
      `Recurring rule is for another category (${recurringRule.categoryId}) than the ` +
        `request (${categoryId}). Pass the rule for the request's own category, or null.`,
    );
  }

  // Feature 2 edge case: "Schedule paused -> requests in that category flag
  // for manual approval with an explanatory note." A cancelled schedule is no
  // less stopped than a paused one.
  if (recurringRule.status !== "active") return false;

  // "Over cap", checked before the approved amount: the ticket is explicit
  // that a request in a recurring category exceeding what is approved is
  // flagged, and Feature 2 that it is "never auto-rejected". Flagging it means
  // not auto-approving it here — it stays pending for a person.
  //
  // The cap is a monthly budget, so it applies to the total: what has been
  // spent plus what is being asked for. Exactly at the cap is within it.
  if (category.monthlyCap !== null) {
    const afterThis = add(spendToDate, request.amount);
    if (compare(afterThis, category.monthlyCap) > 0) return false;
  }

  // "Within parameters" is the approved amount per run. One minor unit over
  // is over.
  return compare(request.amount, recurringRule.amount) <= 0;
}

/**
 * Classify a request into a trust tier.
 *
 * Deterministic and total over inputs whose currencies agree. A currency
 * mismatch throws `CurrencyMismatchError` rather than picking a tier.
 */
export function classify(input: TierInput): Tier {
  assertComparable(input);

  // PRD line 220: emergency "removes the plan-match gate; it does not promise
  // faster settlement". So it is decided before anything about the plan is
  // read — including before a missing plan would make this unrecognized.
  //
  // It also wins over `recurring`, which is the stricter reading: recurring
  // auto-approves and emergency asks, so marking a request urgent can never
  // remove a gate that would otherwise have applied.
  if (input.request.isEmergency) return "emergency";

  if (isPreApprovedSchedule(input)) return "recurring";

  // "Outside plan or over cap", and also everything else this function cannot
  // establish — including a request that may well be a planned investment,
  // which we have no way to recognise (see TIERS). Unrecognized routes to
  // manual approval, which is where anything we cannot categorise belongs.
  return "unrecognized";
}
