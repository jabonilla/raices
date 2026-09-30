import { money, type Money } from "@raices/money";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db/schema.js";
import {
  InvalidCapTimezoneError,
  createPlan,
  editPlan,
  monthToDateSpend,
  readVersion,
} from "../src/plans/index.js";
import { findOrCreateUserByPhone, invite } from "../src/relationships/index.js";
import { submitRequest } from "../src/requests/index.js";
import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * Issue #92: a monthly cap needs a month boundary, and a month boundary needs
 * a timezone. The decision is that the timezone lives on the plan version —
 * never inferred from whatever device happens to be making the request — so
 * changing it creates a new version like any other plan change, and a request
 * classified last month cannot be reclassified by someone getting on a plane.
 *
 * The boundary arithmetic is Postgres's, not ours: `date_trunc` against a
 * named zone gets DST and offset history right, and reimplementing that in
 * TypeScript would be a second source of truth for the same question.
 */

let pgx: TestPostgres;
let db: Kysely<Database>;

let phoneCounter = 0;
function aPhone(): string {
  phoneCounter += 1;
  return `+5029${String(9_000_000 + phoneCounter).padStart(7, "0")}`;
}

const usd = (minor: bigint): Money => money(minor, "USD");

/**
 * The moment in the issue: 23:30 on 31 January in Guatemala City.
 *
 * Guatemala is UTC-6 all year, so this is 05:30 UTC on 1 February. New York
 * in January is UTC-5, which makes it 00:30 on 1 February there — already the
 * new month, by half an hour.
 */
const LATE_ON_THE_31ST = new Date("2026-02-01T05:30:00Z");
/** Mid-January, which is unambiguously January in both zones. */
const MID_JANUARY = new Date("2026-01-15T12:00:00Z");

interface Fixture {
  readonly relationshipId: string;
  readonly planId: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly categoryId: string;
}

async function aPlanIn(capTimezone: string, cap: Money): Promise<Fixture> {
  const sender = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "sender" });
  const recipient = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "recipient" });
  const rel = await invite(db, { senderId: sender.id, recipientId: recipient.id });

  const plan = await createPlan(db, {
    relationshipId: rel.id,
    createdBy: sender.id,
    capTimezone,
  });
  const edited = await editPlan(db, {
    planId: plan.planId,
    editedBy: sender.id,
    capTimezone,
    categories: [{ name: "Housing", icon: "home", monthlyCap: cap, isSystem: true }],
  });
  const housing = (await readVersion(db, edited.versionId)).categories.find(
    (c) => c.name === "Housing",
  );
  if (housing === undefined) throw new Error("expected a Housing category");

  return {
    relationshipId: rel.id,
    planId: plan.planId,
    senderId: sender.id,
    recipientId: recipient.id,
    categoryId: housing.id,
  };
}

/** Record an already-approved request at a given instant, for spend to date. */
async function approvedSpend(f: Fixture, amount: Money, at: Date): Promise<void> {
  await sql`
    insert into request (relationship_id, requested_by, amount_minor, amount_currency,
                         category_id, description, tier, channel_of_origin,
                         status, resolved_by, resolved_at, created_at)
    values (${f.relationshipId}, ${f.recipientId}, ${amount.amount}, ${amount.currency},
            ${f.categoryId}, 'Renta', 'recurring', 'whatsapp',
            'approved', ${f.senderId}, ${at}, ${at})
  `.execute(db);
}

beforeAll(async () => {
  pgx = await startTestPostgres();
  db = pgx.kysely<Database>();
}, 180_000);

afterAll(async () => {
  await pgx.stop();
});

describe("the cap window follows the plan version's timezone", () => {
  it("counts spend that is still this month in Guatemala", async () => {
    const f = await aPlanIn("America/Guatemala", usd(100_00n));
    await approvedSpend(f, usd(95_00n), MID_JANUARY);

    const spend = await monthToDateSpend(db, {
      relationshipId: f.relationshipId,
      categoryId: f.categoryId,
      currency: "USD",
      now: LATE_ON_THE_31ST,
    });

    expect(spend).toEqual(usd(95_00n));
  });

  it("excludes the same spend once the month has turned in New York", async () => {
    const f = await aPlanIn("America/New_York", usd(100_00n));
    await approvedSpend(f, usd(95_00n), MID_JANUARY);

    const spend = await monthToDateSpend(db, {
      relationshipId: f.relationshipId,
      categoryId: f.categoryId,
      currency: "USD",
      now: LATE_ON_THE_31ST,
    });

    // Half an hour past midnight on 1 February in New York: January's spend
    // is in the previous window.
    expect(spend).toEqual(usd(0n));
  });

  it("classifies the same request differently under the two clocks", async () => {
    // This is the whole point of #92. Same amount, same cap, same rule, same
    // instant — and one of them moves money without anyone looking at it.
    const guatemala = await aPlanIn("America/Guatemala", usd(100_00n));
    const newYork = await aPlanIn("America/New_York", usd(100_00n));

    for (const f of [guatemala, newYork]) {
      await approvedSpend(f, usd(95_00n), MID_JANUARY);
    }

    const submit = async (f: Fixture) =>
      submitRequest(db, {
        relationshipId: f.relationshipId,
        requestedBy: f.recipientId,
        amount: usd(10_00n),
        categoryId: f.categoryId,
        description: "Renta de febrero",
        channelOfOrigin: "whatsapp",
        recurringRule: { categoryId: f.categoryId, amount: usd(10_00n), status: "active" },
        now: LATE_ON_THE_31ST,
      });

    // Still January in Guatemala: $95 spent plus $10 exceeds the $100 cap.
    expect((await submit(guatemala)).tier).toBe("unrecognized");

    // Already February in New York: the window is empty, so the request is
    // inside the rule and inside the cap.
    expect((await submit(newYork)).tier).toBe("recurring");
  });

  it("uses the timezone even when nothing has been spent", async () => {
    const f = await aPlanIn("America/Guatemala", usd(100_00n));
    const spend = await monthToDateSpend(db, {
      relationshipId: f.relationshipId,
      categoryId: f.categoryId,
      currency: "USD",
      now: LATE_ON_THE_31ST,
    });
    expect(spend).toEqual(usd(0n));
  });

  it("counts only approved requests", async () => {
    const f = await aPlanIn("America/Guatemala", usd(100_00n));
    await approvedSpend(f, usd(40_00n), MID_JANUARY);
    await sql`
      insert into request (relationship_id, requested_by, amount_minor, amount_currency,
                           category_id, description, tier, channel_of_origin, created_at)
      values (${f.relationshipId}, ${f.recipientId}, 5000, 'USD',
              ${f.categoryId}, 'Pendiente', 'unrecognized', 'whatsapp', ${MID_JANUARY})
    `.execute(db);

    const spend = await monthToDateSpend(db, {
      relationshipId: f.relationshipId,
      categoryId: f.categoryId,
      currency: "USD",
      now: LATE_ON_THE_31ST,
    });
    // A pending request is not spend. Nothing has left anyone's hands.
    expect(spend).toEqual(usd(40_00n));
  });
});

describe("the timezone lives on the plan version", () => {
  it("is stored on the version, not on the plan", async () => {
    const f = await aPlanIn("America/Guatemala", usd(100_00n));
    const { rows } = await sql<{ n: string }>`
      select count(*)::text as n from information_schema.columns
       where table_name = 'money_plan' and column_name = 'cap_timezone'
    `.execute(db);
    // The pointer holds no policy. Policy is versioned.
    expect(rows[0]?.n).toBe("0");
    expect((await readVersion(db, await currentVersionOf(f.planId))).capTimezone).toBe(
      "America/Guatemala",
    );
  });

  it("changing it appends a version and leaves the old one alone", async () => {
    const f = await aPlanIn("America/Guatemala", usd(100_00n));
    const before = await currentVersionOf(f.planId);

    const moved = await editPlan(db, {
      planId: f.planId,
      editedBy: f.senderId,
      capTimezone: "America/New_York",
      categories: [{ name: "Housing", icon: "home", monthlyCap: usd(100_00n), isSystem: true }],
    });

    expect(moved.versionId).not.toBe(before);
    expect((await readVersion(db, before)).capTimezone).toBe("America/Guatemala");
    expect((await readVersion(db, moved.versionId)).capTimezone).toBe("America/New_York");
  });

  it("cannot be updated in place", async () => {
    const f = await aPlanIn("America/Guatemala", usd(100_00n));
    const versionId = await currentVersionOf(f.planId);
    await expect(
      sql`update plan_version set cap_timezone = 'UTC' where id = ${versionId}`.execute(db),
    ).rejects.toThrow();
  });

  it("refuses a timezone Postgres does not know", async () => {
    const sender = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "sender" });
    const recipient = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "recipient" });
    const rel = await invite(db, { senderId: sender.id, recipientId: recipient.id });

    await expect(
      createPlan(db, {
        relationshipId: rel.id,
        createdBy: sender.id,
        capTimezone: "Mars/Olympus_Mons",
      }),
    ).rejects.toThrow(InvalidCapTimezoneError);
  });

  it("refuses a fixed offset dressed up as a zone", async () => {
    const sender = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "sender" });
    const recipient = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "recipient" });
    const rel = await invite(db, { senderId: sender.id, recipientId: recipient.id });

    // "-06:00" is Guatemala today and wrong the moment a rule changes. A zone
    // name carries its own history; an offset does not.
    await expect(
      createPlan(db, { relationshipId: rel.id, createdBy: sender.id, capTimezone: "-06:00" }),
    ).rejects.toThrow(InvalidCapTimezoneError);
  });
});

async function currentVersionOf(planId: string): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    select current_version_id as id from money_plan where id = ${planId}
  `.execute(db);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`plan ${planId} has no current version`);
  return id;
}
