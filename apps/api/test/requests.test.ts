import { money, type Money } from "@raices/money";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db/schema.js";
import { createPlan, editPlan, readVersion } from "../src/plans/index.js";
import { findOrCreateUserByPhone, invite } from "../src/relationships/index.js";
import {
  DeclineReasonRequiredError,
  DeclineReasonTooLongError,
  approveRequest,
  declineRequest,
  expireRequest,
  readRequest,
  submitRequest,
} from "../src/requests/index.js";
import { UndeclaredTransitionError } from "../src/audit/index.js";
import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/** Every plan version states its cap window timezone (issue #92). */
const TEST_TZ = "America/Guatemala";

/**
 * P2.4 behaviour against real Postgres.
 *
 * The classification itself is proven in tier.test.ts without a database.
 * What is proven here is everything the database owns: that the tier decided
 * at submission is what gets stored, that a status only moves through
 * transition(), and that PRD invariant 3 holds — a declined request never
 * becomes a transaction.
 */

let pgx: TestPostgres;
let db: Kysely<Database>;

let phoneCounter = 0;
function aPhone(): string {
  phoneCounter += 1;
  return `+5027${String(7_000_000 + phoneCounter).padStart(7, "0")}`;
}

const usd = (minor: bigint): Money => money(minor, "USD");

interface Fixture {
  readonly relationshipId: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly categoryId: string;
}

/** A sender, a recipient, an active relationship and a plan with categories. */
async function aRelationshipWithPlan(cap: Money | null = null): Promise<Fixture> {
  const sender = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "sender" });
  const recipient = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "recipient" });
  const rel = await invite(db, { senderId: sender.id, recipientId: recipient.id });

  const plan = await createPlan(db, {
    relationshipId: rel.id,
    createdBy: sender.id,
    capTimezone: TEST_TZ,
  });
  const version = await readVersion(db, plan.versionId);
  const housing = version.categories.find((c) => c.name === "Housing");
  if (housing === undefined) throw new Error("expected a Housing category");

  const base = { relationshipId: rel.id, senderId: sender.id, recipientId: recipient.id };
  if (cap === null) return { ...base, categoryId: housing.id };

  // A cap arrives by editing the plan, which appends a version rather than
  // mutating the one already in force, so the category gets a new id.
  const next = await editPlan(db, {
    capTimezone: TEST_TZ,
    planId: plan.planId,
    editedBy: sender.id,
    categories: [{ name: "Housing", icon: "home", monthlyCap: cap, isSystem: true }],
  });
  const capped = (await readVersion(db, next.versionId)).categories.find(
    (c) => c.name === "Housing",
  );
  if (capped === undefined) throw new Error("expected a Housing category");
  return { ...base, categoryId: capped.id };
}

async function ledgerTransactionCount(): Promise<bigint> {
  const { rows } = await sql<{
    n: string;
  }>`select count(*)::text as n from ledger_transaction`.execute(db);
  return BigInt(rows[0]?.n ?? "0");
}

async function auditRowsFor(entityId: string): Promise<readonly { action: string }[]> {
  const { rows } = await sql<{ action: string }>`
    select action from audit_log
     where entity_type = 'request' and entity_id = ${entityId}
     order by seq
  `.execute(db);
  return rows;
}

beforeAll(async () => {
  pgx = await startTestPostgres();
  db = pgx.kysely<Database>();
}, 180_000);

afterAll(async () => {
  await pgx.stop();
});

describe("submitting a request", () => {
  it("stores the tier decided at submission and starts pending", async () => {
    const f = await aRelationshipWithPlan();
    const submitted = await submitRequest(db, {
      relationshipId: f.relationshipId,
      requestedBy: f.recipientId,
      amount: usd(50_00n),
      categoryId: f.categoryId,
      description: "Renta de septiembre",
      channelOfOrigin: "whatsapp",
      spendToDate: usd(0n),
    });

    const read = await readRequest(db, submitted.id);
    // Nothing pre-approved it, so there is no basis to move money without a
    // person: unrecognized, which routes to manual approval.
    expect(read.tier).toBe("unrecognized");
    expect(read.tier).toBe(submitted.tier);
    expect(read.status).toBe("pending");
    expect(read.amount).toEqual(usd(50_00n));
    expect(read.resolvedBy).toBeNull();
    expect(read.resolvedAt).toBeNull();
    expect(read.declineReason).toBeNull();
  });

  it("classifies a request with no plan category as unrecognized", async () => {
    const f = await aRelationshipWithPlan();
    const submitted = await submitRequest(db, {
      relationshipId: f.relationshipId,
      requestedBy: f.recipientId,
      amount: usd(50_00n),
      categoryId: null,
      description: "Algo no planeado",
      channelOfOrigin: "sms",
      spendToDate: usd(0n),
    });

    expect(submitted.tier).toBe("unrecognized");
    expect((await readRequest(db, submitted.id)).status).toBe("pending");
  });

  it("classifies an urgent request as emergency", async () => {
    const f = await aRelationshipWithPlan();
    const submitted = await submitRequest(db, {
      relationshipId: f.relationshipId,
      requestedBy: f.recipientId,
      amount: usd(50_00n),
      categoryId: f.categoryId,
      description: "Emergencia medica",
      isEmergency: true,
      channelOfOrigin: "whatsapp",
      spendToDate: usd(0n),
    });

    expect(submitted.tier).toBe("emergency");
  });

  it("keeps an over-cap request in a recurring category pending, never auto-declined", async () => {
    const f = await aRelationshipWithPlan(usd(100_00n));
    const submitted = await submitRequest(db, {
      relationshipId: f.relationshipId,
      requestedBy: f.recipientId,
      amount: usd(10_01n),
      categoryId: f.categoryId,
      description: "Renta, un poco mas este mes",
      channelOfOrigin: "whatsapp",
      spendToDate: usd(90_00n),
      recurringRule: { categoryId: f.categoryId, amount: usd(10_00n), status: "active" },
    });

    expect(submitted.tier).toBe("unrecognized");

    const read = await readRequest(db, submitted.id);
    expect(read.status).toBe("pending");
    expect(read.declineReason).toBeNull();
    // Nothing resolved it, so there is a decision still owed to the sender.
    expect(read.resolvedAt).toBeNull();
  });

  it("counts the spend to date against the cap, not just the amount asked for", async () => {
    // Same amount, same active rule, same cap. The only difference is what
    // has already been spent, so this is what proves the spend to date
    // reaches the classifier at all.
    const f = await aRelationshipWithPlan(usd(100_00n));
    const rule = { categoryId: f.categoryId, amount: usd(10_00n), status: "active" } as const;

    const overByHistory = await submitRequest(db, {
      relationshipId: f.relationshipId,
      requestedBy: f.recipientId,
      amount: usd(10_00n),
      categoryId: f.categoryId,
      description: "Renta, otra vez",
      channelOfOrigin: "whatsapp",
      spendToDate: usd(95_00n),
      recurringRule: rule,
    });
    expect(overByHistory.tier).toBe("unrecognized");

    const sameAmountNoHistory = await submitRequest(db, {
      relationshipId: f.relationshipId,
      requestedBy: f.recipientId,
      amount: usd(10_00n),
      categoryId: f.categoryId,
      description: "Renta, primera del mes",
      channelOfOrigin: "whatsapp",
      spendToDate: usd(0n),
      recurringRule: rule,
    });
    expect(sameAmountNoHistory.tier).toBe("recurring");
  });

  it("classifies a request inside an active recurring rule as recurring", async () => {
    const f = await aRelationshipWithPlan(usd(100_00n));
    const submitted = await submitRequest(db, {
      relationshipId: f.relationshipId,
      requestedBy: f.recipientId,
      amount: usd(10_00n),
      categoryId: f.categoryId,
      description: "Renta semanal",
      channelOfOrigin: "app",
      spendToDate: usd(0n),
      recurringRule: { categoryId: f.categoryId, amount: usd(10_00n), status: "active" },
    });

    expect(submitted.tier).toBe("recurring");
    // P2.4 classifies; it does not approve. Auto-approval is Feature 2 and
    // has no ticket yet, so even a recurring request waits for a decision.
    expect((await readRequest(db, submitted.id)).status).toBe("pending");
  });

  it("writes no audit row at submission, because creation is not a transition", async () => {
    const f = await aRelationshipWithPlan();
    const submitted = await submitRequest(db, {
      relationshipId: f.relationshipId,
      requestedBy: f.recipientId,
      amount: usd(1_00n),
      categoryId: f.categoryId,
      description: "Comida",
      channelOfOrigin: "app",
      spendToDate: usd(0n),
    });

    expect(await auditRowsFor(submitted.id)).toEqual([]);
  });
});

describe("resolving a request", () => {
  async function aPendingRequest(): Promise<{ id: string; f: Fixture }> {
    const f = await aRelationshipWithPlan();
    const submitted = await submitRequest(db, {
      relationshipId: f.relationshipId,
      requestedBy: f.recipientId,
      amount: usd(25_00n),
      categoryId: f.categoryId,
      description: "Utiles escolares",
      channelOfOrigin: "whatsapp",
      spendToDate: usd(0n),
    });
    return { id: submitted.id, f };
  }

  it("approves, recording who resolved it and when", async () => {
    const { id, f } = await aPendingRequest();
    await approveRequest(db, {
      requestId: id,
      actor: { kind: "user", id: f.senderId },
      channel: "whatsapp",
    });

    const read = await readRequest(db, id);
    expect(read.status).toBe("approved");
    expect(read.resolvedBy).toBe(f.senderId);
    expect(read.resolvedAt).not.toBeNull();
    expect(read.declineReason).toBeNull();
    expect((await auditRowsFor(id)).map((r) => r.action)).toEqual(["request.approve"]);
  });

  it("declines with a reason", async () => {
    const { id, f } = await aPendingRequest();
    await declineRequest(db, {
      requestId: id,
      actor: { kind: "user", id: f.senderId },
      reason: "Hablemos primero",
    });

    const read = await readRequest(db, id);
    expect(read.status).toBe("declined");
    expect(read.declineReason).toBe("Hablemos primero");
    expect(read.resolvedBy).toBe(f.senderId);
    expect((await auditRowsFor(id)).map((r) => r.action)).toEqual(["request.decline"]);
  });

  it("refuses a decline with no reason", async () => {
    const { id, f } = await aPendingRequest();
    await expect(
      declineRequest(db, { requestId: id, actor: { kind: "user", id: f.senderId }, reason: "" }),
    ).rejects.toThrow(DeclineReasonRequiredError);

    expect((await readRequest(db, id)).status).toBe("pending");
  });

  it("refuses a decline whose reason is only whitespace", async () => {
    const { id, f } = await aPendingRequest();
    await expect(
      declineRequest(db, {
        requestId: id,
        actor: { kind: "user", id: f.senderId },
        reason: "   \n\t ",
      }),
    ).rejects.toThrow(DeclineReasonRequiredError);

    expect((await readRequest(db, id)).status).toBe("pending");
  });

  it("refuses a decline reason over 200 characters", async () => {
    const { id, f } = await aPendingRequest();
    // The specific error, not merely "something threw": the database's own
    // constraint would also reject this, so asserting only that it throws
    // would pass with the service's check removed entirely.
    await expect(
      declineRequest(db, {
        requestId: id,
        actor: { kind: "user", id: f.senderId },
        reason: "a".repeat(201),
      }),
    ).rejects.toThrow(DeclineReasonTooLongError);

    expect((await readRequest(db, id)).status).toBe("pending");
  });

  it("accepts a decline reason of exactly 200 characters", async () => {
    const { id, f } = await aPendingRequest();
    const reason = "a".repeat(200);
    await declineRequest(db, { requestId: id, actor: { kind: "user", id: f.senderId }, reason });
    expect((await readRequest(db, id)).declineReason).toBe(reason);
  });

  it("expires a pending request with a system actor and no resolver", async () => {
    const { id } = await aPendingRequest();
    await expireRequest(db, { requestId: id });

    const read = await readRequest(db, id);
    expect(read.status).toBe("expired");
    expect(read.resolvedBy).toBeNull();
    expect(read.resolvedAt).not.toBeNull();
    expect((await auditRowsFor(id)).map((r) => r.action)).toEqual(["request.expire"]);
  });

  it("refuses to move a request that is already resolved", async () => {
    const { id, f } = await aPendingRequest();
    await approveRequest(db, { requestId: id, actor: { kind: "user", id: f.senderId } });

    await expect(
      declineRequest(db, {
        requestId: id,
        actor: { kind: "user", id: f.senderId },
        reason: "Cambio de opinion",
      }),
    ).rejects.toThrow(UndeclaredTransitionError);

    expect((await readRequest(db, id)).status).toBe("approved");
  });
});

describe("PRD invariant 3: a declined request never becomes a transaction", () => {
  it("posts nothing to the ledger for a request that is declined", async () => {
    const f = await aRelationshipWithPlan();
    const before = await ledgerTransactionCount();

    const submitted = await submitRequest(db, {
      relationshipId: f.relationshipId,
      requestedBy: f.recipientId,
      amount: usd(400_00n),
      categoryId: f.categoryId,
      description: "Un gasto grande",
      channelOfOrigin: "whatsapp",
      spendToDate: usd(0n),
    });
    await declineRequest(db, {
      requestId: submitted.id,
      actor: { kind: "user", id: f.senderId },
      reason: "No este mes",
    });

    expect(await ledgerTransactionCount()).toBe(before);
    expect((await readRequest(db, submitted.id)).status).toBe("declined");
  });

  it("refuses a transaction for a declined request, at the database level", async () => {
    // Promised in P2.4 and delivered here. Before 0007 there was no link in
    // either direction between a request and a transaction, so the invariant
    // had nowhere to live and this test asserted the absence of one. 0007
    // adds `transaction.request_id`, which makes it enforceable, so the
    // assertion is now against the constraint rather than against the gap.
    const f = await aRelationshipWithPlan();
    const submitted = await submitRequest(db, {
      relationshipId: f.relationshipId,
      requestedBy: f.recipientId,
      amount: usd(400_00n),
      categoryId: f.categoryId,
      description: "Un gasto grande",
      channelOfOrigin: "whatsapp",
      spendToDate: usd(0n),
    });
    await declineRequest(db, {
      requestId: submitted.id,
      actor: { kind: "user", id: f.senderId },
      reason: "No este mes",
    });

    await expect(
      sql`
        insert into transaction (request_id, relationship_id, amount_minor, amount_currency,
                                 approved_by)
        values (${submitted.id}, ${f.relationshipId}, 40000, 'USD', ${f.senderId})
      `.execute(db),
    ).rejects.toMatchObject({ code: "TX002" });
  });
});
