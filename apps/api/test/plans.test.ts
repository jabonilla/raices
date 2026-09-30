import { money, type Money } from "@raices/money";
import fc from "fast-check";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db/schema.js";
import {
  SYSTEM_CATEGORY_NAMES,
  createPlan,
  editPlan,
  readPlan,
  readVersion,
} from "../src/plans/index.js";
import { findOrCreateUserByPhone, invite } from "../src/relationships/index.js";
import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/** Every plan version states its cap window timezone (issue #92). */
const TEST_TZ = "America/Guatemala";

/**
 * P2.3 behaviour, against real Postgres. Immutability and gapless numbering
 * are database properties; a mock would assert nothing about either.
 */

let pgx: TestPostgres;
let db: Kysely<Database>;

let phoneCounter = 0;
function aPhone(): string {
  phoneCounter += 1;
  return `+5026${String(6_000_000 + phoneCounter).padStart(7, "0")}`;
}

async function aRelationship(): Promise<{ relationshipId: string; senderId: string }> {
  const sender = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "sender" });
  const recipient = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "recipient" });
  const r = await invite(db, { senderId: sender.id, recipientId: recipient.id });
  return { relationshipId: r.id, senderId: sender.id };
}

/** Every column of a version and its categories, for byte-identical checks. */
async function snapshot(versionId: string): Promise<unknown> {
  const { rows } = await sql<{ snapshot: unknown }>`
    select json_build_object(
      'version', (select row_to_json(v) from plan_version v where v.id = ${versionId}),
      'categories', (select coalesce(json_agg(row_to_json(c) order by c.name), '[]'::json)
                       from category c where c.plan_version_id = ${versionId})
    ) as snapshot
  `.execute(db);
  return rows[0]?.snapshot;
}

beforeAll(async () => {
  pgx = await startTestPostgres();
  db = pgx.kysely<Database>();
}, 120_000);

afterAll(async () => {
  await pgx.stop();
});

describe("creating a plan", () => {
  it("starts at version 1 and points the plan at it", async () => {
    const { relationshipId, senderId } = await aRelationship();
    const plan = await createPlan(db, {
      relationshipId,
      createdBy: senderId,
      capTimezone: TEST_TZ,
    });

    const read = await readPlan(db, plan.planId);
    expect(read.currentVersionNumber).toBe(1);
    expect(read.currentVersionId).toBe(plan.versionId);
  });

  it("seeds the five system categories", async () => {
    const { relationshipId, senderId } = await aRelationship();
    const plan = await createPlan(db, {
      relationshipId,
      createdBy: senderId,
      capTimezone: TEST_TZ,
    });

    const version = await readVersion(db, plan.versionId);
    // The literal five from the ticket, not [...SYSTEM_CATEGORY_NAMES]:
    // comparing the seeded names against the constant that produced them is
    // a tautology that passes however that constant is edited.
    expect(version.categories.map((c) => c.name).sort()).toEqual([
      "Business",
      "Food",
      "Housing",
      "Other",
      "Savings",
    ]);
    expect(version.categories.every((c) => c.isSystem)).toBe(true);
  });

  // System categories start uncapped rather than capped at zero: a new plan
  // should not silently forbid all spending.
  it("gives the seeded categories no cap", async () => {
    const { relationshipId, senderId } = await aRelationship();
    const plan = await createPlan(db, {
      relationshipId,
      createdBy: senderId,
      capTimezone: TEST_TZ,
    });
    const version = await readVersion(db, plan.versionId);
    expect(version.categories.every((c) => c.monthlyCap === null)).toBe(true);
  });

  it("exports exactly the five system category names the ticket lists", () => {
    expect([...SYSTEM_CATEGORY_NAMES]).toEqual(["Housing", "Food", "Business", "Savings", "Other"]);
  });
});

describe("editing a plan", () => {
  it("creates version N+1", async () => {
    const { relationshipId, senderId } = await aRelationship();
    const plan = await createPlan(db, {
      relationshipId,
      createdBy: senderId,
      capTimezone: TEST_TZ,
    });

    const second = await editPlan(db, {
      capTimezone: TEST_TZ,
      planId: plan.planId,
      editedBy: senderId,
      categories: [{ name: "Housing", icon: "home", monthlyCap: money(50_000n, "USD") }],
    });

    expect(second.versionNumber).toBe(2);
    expect((await readPlan(db, plan.planId)).currentVersionId).toBe(second.versionId);
  });

  // The acceptance criterion: version N is byte-identical afterwards.
  it("leaves the previous version byte-identical", async () => {
    const { relationshipId, senderId } = await aRelationship();
    const plan = await createPlan(db, {
      relationshipId,
      createdBy: senderId,
      capTimezone: TEST_TZ,
    });

    const before = await snapshot(plan.versionId);
    await editPlan(db, {
      capTimezone: TEST_TZ,
      planId: plan.planId,
      editedBy: senderId,
      categories: [{ name: "Food", icon: "food", monthlyCap: money(1n, "GTQ") }],
    });
    const after = await snapshot(plan.versionId);

    expect(after).toEqual(before);
  });

  // A request pins the category of the version in force when it was made, so
  // an edit must mint new category rows rather than repoint the old ones.
  it("mints new category rows rather than moving the old ones", async () => {
    const { relationshipId, senderId } = await aRelationship();
    const plan = await createPlan(db, {
      relationshipId,
      createdBy: senderId,
      capTimezone: TEST_TZ,
    });
    const originalIds = (await readVersion(db, plan.versionId)).categories.map((c) => c.id);

    const second = await editPlan(db, {
      capTimezone: TEST_TZ,
      planId: plan.planId,
      editedBy: senderId,
      categories: [{ name: "Housing", icon: "home", monthlyCap: null }],
    });
    const newIds = (await readVersion(db, second.versionId)).categories.map((c) => c.id);

    expect(newIds.some((id) => originalIds.includes(id))).toBe(false);
    // And the old rows are still readable, pinned to the old version.
    expect((await readVersion(db, plan.versionId)).categories.map((c) => c.id).sort()).toEqual(
      [...originalIds].sort(),
    );
  });

  // is_system is what separates the five seeded categories from a sender's
  // own. An edit that marked everything system would erase that distinction.
  it("does not mark a sender's own categories as system", async () => {
    const { relationshipId, senderId } = await aRelationship();
    const plan = await createPlan(db, {
      relationshipId,
      createdBy: senderId,
      capTimezone: TEST_TZ,
    });
    const second = await editPlan(db, {
      capTimezone: TEST_TZ,
      planId: plan.planId,
      editedBy: senderId,
      categories: [
        { name: "Housing", icon: "home", monthlyCap: null },
        { name: "Moto", icon: "bike", monthlyCap: money(15_000n, "GTQ") },
      ],
    });

    const categories = (await readVersion(db, second.versionId)).categories;
    expect(categories.map((c) => c.isSystem)).toEqual([false, false]);
  });

  it("records who made the edit", async () => {
    const { relationshipId, senderId } = await aRelationship();
    const plan = await createPlan(db, {
      relationshipId,
      createdBy: senderId,
      capTimezone: TEST_TZ,
    });
    const second = await editPlan(db, {
      capTimezone: TEST_TZ,
      planId: plan.planId,
      editedBy: senderId,
      categories: [{ name: "Other", icon: "dots", monthlyCap: null }],
    });
    expect((await readVersion(db, second.versionId)).createdBy).toBe(senderId);
  });

  it("numbers a run of edits 1 through 6 with no gaps", async () => {
    const { relationshipId, senderId } = await aRelationship();
    const plan = await createPlan(db, {
      relationshipId,
      createdBy: senderId,
      capTimezone: TEST_TZ,
    });

    for (let i = 0; i < 5; i += 1) {
      await editPlan(db, {
        capTimezone: TEST_TZ,
        planId: plan.planId,
        editedBy: senderId,
        categories: [{ name: "Savings", icon: "piggy", monthlyCap: money(BigInt(i), "USD") }],
      });
    }

    const { rows } = await sql<{ numbers: string }>`
      select string_agg(version_number::text, ',' order by version_number) as numbers
        from plan_version where plan_id = ${plan.planId}
    `.execute(db);
    expect(rows[0]?.numbers).toBe("1,2,3,4,5,6");
  });
});

/**
 * The acceptance criterion that needs real concurrency: version_number must
 * be unique per plan AND gapless, even when edits race.
 */
describe("version_number under concurrent edits", () => {
  it("stays unique and gapless with 12 simultaneous edits", async () => {
    const { relationshipId, senderId } = await aRelationship();
    const plan = await createPlan(db, {
      relationshipId,
      createdBy: senderId,
      capTimezone: TEST_TZ,
    });

    const edits = 12;
    await Promise.all(
      Array.from({ length: edits }, (_, i) =>
        editPlan(db, {
          capTimezone: TEST_TZ,
          planId: plan.planId,
          editedBy: senderId,
          categories: [{ name: "Business", icon: "tools", monthlyCap: money(BigInt(i), "USD") }],
        }),
      ),
    );

    const { rows } = await sql<{ count: string; distinct: string; max: string; min: string }>`
      select count(*)::text                   as count,
             count(distinct version_number)::text as distinct,
             max(version_number)::text        as max,
             min(version_number)::text        as min
        from plan_version where plan_id = ${plan.planId}
    `.execute(db);

    const total = edits + 1;
    // Gapless is the conjunction: as many rows as distinct numbers, running
    // from 1 to N with none missing in between.
    expect(rows[0]?.count).toBe(String(total));
    expect(rows[0]?.distinct).toBe(String(total));
    expect(rows[0]?.min).toBe("1");
    expect(rows[0]?.max).toBe(String(total));
  });

  it("leaves the plan pointing at the highest version", async () => {
    const { relationshipId, senderId } = await aRelationship();
    const plan = await createPlan(db, {
      relationshipId,
      createdBy: senderId,
      capTimezone: TEST_TZ,
    });

    await Promise.all(
      Array.from({ length: 8 }, () =>
        editPlan(db, {
          capTimezone: TEST_TZ,
          planId: plan.planId,
          editedBy: senderId,
          categories: [{ name: "Food", icon: "food", monthlyCap: null }],
        }),
      ),
    );

    const read = await readPlan(db, plan.planId);
    expect(read.currentVersionNumber).toBe(9);
  });
});

describe("caps are Money", () => {
  it("distinguishes a cap of zero from no cap", async () => {
    const { relationshipId, senderId } = await aRelationship();
    const plan = await createPlan(db, {
      relationshipId,
      createdBy: senderId,
      capTimezone: TEST_TZ,
    });

    const edited = await editPlan(db, {
      capTimezone: TEST_TZ,
      planId: plan.planId,
      editedBy: senderId,
      categories: [
        { name: "Business", icon: "tools", monthlyCap: money(0n, "USD") },
        { name: "Other", icon: "dots", monthlyCap: null },
      ],
    });

    const byName = new Map(
      (await readVersion(db, edited.versionId)).categories.map((c) => [c.name, c.monthlyCap]),
    );
    // Zero is a cap that forbids spending. Null is the absence of a cap.
    // Collapsing them turns one into the other.
    expect(byName.get("Business")).toEqual(money(0n, "USD"));
    expect(byName.get("Other")).toBeNull();
    expect(byName.get("Business")).not.toBeNull();
  });

  it("round-trips any cap through Money with no precision loss", async () => {
    const { relationshipId, senderId } = await aRelationship();
    const plan = await createPlan(db, {
      relationshipId,
      createdBy: senderId,
      capTimezone: TEST_TZ,
    });

    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 0n, max: 2n ** 62n }),
        fc.constantFrom("USD" as const, "GTQ" as const),
        async (amount, currency) => {
          const cap: Money = money(amount, currency);
          const edited = await editPlan(db, {
            capTimezone: TEST_TZ,
            planId: plan.planId,
            editedBy: senderId,
            categories: [{ name: "Housing", icon: "home", monthlyCap: cap }],
          });

          const [read] = (await readVersion(db, edited.versionId)).categories;
          expect(read?.monthlyCap).toEqual(cap);
          expect(read?.monthlyCap?.amount).toBe(amount);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("keeps a cap larger than Number.MAX_SAFE_INTEGER exact", async () => {
    const { relationshipId, senderId } = await aRelationship();
    const plan = await createPlan(db, {
      relationshipId,
      createdBy: senderId,
      capTimezone: TEST_TZ,
    });
    const huge = 9_007_199_254_740_993n; // 2^53 + 1, not representable as a double

    const edited = await editPlan(db, {
      capTimezone: TEST_TZ,
      planId: plan.planId,
      editedBy: senderId,
      categories: [{ name: "Housing", icon: "home", monthlyCap: money(huge, "USD") }],
    });

    const [read] = (await readVersion(db, edited.versionId)).categories;
    expect(read?.monthlyCap?.amount).toBe(huge);

    // Why this has to be a bigint the whole way: as doubles, this cap and the
    // one a minor unit below it are the same number. As bigints they are not.
    expect(Number(huge)).toBe(Number(huge - 1n));
    expect(read?.monthlyCap?.amount).not.toBe(huge - 1n);
  });
});
