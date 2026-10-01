import { isCurrency, money, type Currency, type Money } from "@raices/money";
import { sql, type Kysely } from "kysely";

import type { PlanDatabase } from "./schema.js";

/**
 * Issue #92 — how much has been spent in a category so far this cap period.
 *
 * ## Why the timezone matters
 *
 * The sender is in the US and the recipient is in Guatemala. Guatemala is
 * UTC-6 all year; US senders are UTC-4 to UTC-10 depending on where they are
 * and the time of year. So the two month boundaries sit hours apart and the
 * gap moves twice a year.
 *
 * A request at 23:30 on the 31st in Guatemala City is already 00:30 on the
 * 1st in New York. Under Guatemala's clock it counts against a month that is
 * nearly spent and gets flagged for a person; under New York's it starts a
 * fresh month and, inside a recurring rule, auto-approves. Same request, same
 * amounts, and the difference is whose clock we picked. It is also the end of
 * the month, which is when rent is due and when caps are closest to spent, so
 * this is the common case rather than an edge.
 *
 * ## Where the answer lives
 *
 * On the plan version (0008), so it is part of the agreement rather than a
 * property of whatever device is making the request. Because plan versions
 * are immutable, changing it appends a version, and a request already
 * classified cannot be reclassified by a later change of mind.
 *
 * ## Why the arithmetic is Postgres's
 *
 * `date_trunc` against a named zone knows the offset history and the DST
 * rules. Recomputing that in TypeScript would be a second implementation of
 * the same question, and the two would disagree on exactly the dates that
 * matter. The window is derived here from the version's own `cap_timezone`,
 * so a caller cannot pass a different one by accident.
 */
export interface MonthToDateSpendInput {
  readonly relationshipId: string;
  /** Null has no cap to measure against, so spend is zero by construction. */
  readonly categoryId: string | null;
  /** The currency to report in. Mixed-currency history is refused, not summed. */
  readonly currency: Currency;
  /** The instant the window is measured from. Defaults to now. */
  readonly now?: Date;
}

interface SpendRow {
  readonly total: string | null;
  readonly currencies: number;
  readonly currency: string | null;
}

/**
 * Sum the approved requests in this category for the cap period containing
 * `now`, measured in the plan version's timezone.
 *
 * Only approved requests count. A pending one is not spend — nothing has
 * left anyone's hands, and counting it would let a request that is waiting
 * for a decision push the next one over the cap.
 */
export async function monthToDateSpend<DB extends PlanDatabase>(
  db: Kysely<DB>,
  input: MonthToDateSpendInput,
): Promise<Money> {
  // A null category matches no category row, so the window CTE is empty and
  // the sum is null: the query below already answers zero. There is no early
  // return for it, because a branch whose removal changes nothing is a branch
  // no test can hold in place.
  const zero = money(0n, input.currency);
  const now = input.now ?? new Date();

  // The window is [start of this month, start of next), both computed in the
  // zone the plan version names, then converted back to absolute instants so
  // the comparison against created_at (timestamptz) is exact.
  const { rows } = await sql<SpendRow>`
    with window_bounds as (
      select
        date_trunc('month', ${now}::timestamptz at time zone v.cap_timezone)
          at time zone v.cap_timezone as starts_at,
        (date_trunc('month', ${now}::timestamptz at time zone v.cap_timezone)
          + interval '1 month') at time zone v.cap_timezone as ends_at
        from category c
        join plan_version v on v.id = c.plan_version_id
       where c.id = ${input.categoryId}
    )
    select
      sum(r.amount_minor)::text as total,
      count(distinct r.amount_currency)::int as currencies,
      min(r.amount_currency) as currency
      from request r, window_bounds w
     where r.relationship_id = ${input.relationshipId}
       and r.category_id = ${input.categoryId}
       and r.status = 'approved'
       and r.created_at >= w.starts_at
       and r.created_at < w.ends_at
  `.execute(db);

  const row = rows[0];
  if (row === undefined || row.total === null) return zero;

  if (row.currencies > 1) {
    throw new Error(
      `Category ${String(input.categoryId)} has approved spend in more than one currency this ` +
        `period. A cap is in one currency; summing across them would invent an exchange rate.`,
    );
  }

  const found = row.currency;
  if (found === null || !isCurrency(found)) {
    throw new Error(
      `Category ${String(input.categoryId)} has spend in unsupported currency ${String(found)}.`,
    );
  }
  if (found !== input.currency) {
    throw new Error(
      `Category ${String(input.categoryId)} has spend in ${found}, but the cap window was asked ` +
        `for in ${input.currency}.`,
    );
  }

  return money(BigInt(row.total), found);
}
