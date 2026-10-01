import { money, type Money } from "@raices/money";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { UndeclaredTransitionError } from "../src/audit/index.js";
import type { Database } from "../src/db/schema.js";
import { createPlan, editPlan, readVersion } from "../src/plans/index.js";
import { findOrCreateUserByPhone, invite } from "../src/relationships/index.js";
import { readRequest, submitRequest } from "../src/requests/index.js";
import {
  CancelAfterSettlementError,
  approveAndRecord,
  cancelIntent,
  advanceSettlement,
  readTransaction,
} from "../src/transactions/index.js";
import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * P2.5 behaviour against real Postgres.
 *
 * The join between an approved request and the ledger. Two things have to be
 * true at once and neither is provable with a mock: the transaction row and
 * its double-entry posting commit together or not at all, and approving the
 * same request twenty times concurrently produces exactly one of each.
 */

let pgx: TestPostgres;
let db: Kysely<Database>;

let phoneCounter = 0;
function aPhone(): string {
  phoneCounter += 1;
  return `+50242${String(200_000 + phoneCounter).padStart(6, "0")}`;
}

const usd = (minor: bigint): Money => money(minor, "USD");

interface Accounts {
  readonly debitAccountId: string;
  readonly creditAccountId: string;
}

let accounts: Accounts;

async function makeAccounts(): Promise<Accounts> {
  const { rows } = await sql<{ id: string }>`
    insert into ledger_account (code, type, currency)
    values (${"settlement:p25:" + String(phoneCounter)}, 'asset', 'USD'),
           (${"payable:p25:" + String(phoneCounter)}, 'liability', 'USD')
    returning id
  `.execute(db);
  const [debit, credit] = rows;
  if (debit === undefined || credit === undefined) throw new Error("could not seed accounts");
  return { debitAccountId: debit.id, creditAccountId: credit.id };
}

interface Fixture {
  readonly relationshipId: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly categoryId: string;
  readonly requestId: string;
  readonly amount: Money;
}

async function aPendingRequest(amount: Money = usd(50_00n)): Promise<Fixture> {
  const sender = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "sender" });
  const recipient = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "recipient" });
  const rel = await invite(db, { senderId: sender.id, recipientId: recipient.id });

  const plan = await createPlan(db, {
    relationshipId: rel.id,
    createdBy: sender.id,
    capTimezone: "America/Guatemala",
  });
  const edited = await editPlan(db, {
    planId: plan.planId,
    editedBy: sender.id,
    capTimezone: "America/Guatemala",
    categories: [{ name: "Housing", icon: "home", monthlyCap: null, isSystem: true }],
  });
  const housing = (await readVersion(db, edited.versionId)).categories.find(
    (c) => c.name === "Housing",
  );
  if (housing === undefined) throw new Error("expected a Housing category");

  const submitted = await submitRequest(db, {
    relationshipId: rel.id,
    requestedBy: recipient.id,
    amount,
    categoryId: housing.id,
    description: "Renta",
    channelOfOrigin: "whatsapp",
  });

  return {
    relationshipId: rel.id,
    senderId: sender.id,
    recipientId: recipient.id,
    categoryId: housing.id,
    requestId: submitted.id,
    amount,
  };
}

function postingFor(f: Fixture) {
  return {
    requestId: f.requestId,
    actor: { kind: "user", id: f.senderId } as const,
    posting: {
      debitAccountId: accounts.debitAccountId,
      creditAccountId: accounts.creditAccountId,
      entryType: "remittance",
    },
  };
}

async function countFor(requestId: string): Promise<{ transactions: number; postings: number }> {
  const { rows } = await sql<{ transactions: string; postings: string }>`
    select
      (select count(*)::text from transaction where request_id = ${requestId}) as transactions,
      (select count(*)::text from ledger_transaction
        where idempotency_key = ${requestId}) as postings
  `.execute(db);
  return {
    transactions: Number(rows[0]?.transactions ?? "0"),
    postings: Number(rows[0]?.postings ?? "0"),
  };
}

async function auditActions(entityType: string, entityId: string): Promise<string[]> {
  const { rows } = await sql<{ action: string }>`
    select action from audit_log
     where entity_type = ${entityType} and entity_id = ${entityId}
     order by seq
  `.execute(db);
  return rows.map((r) => r.action);
}

beforeAll(async () => {
  pgx = await startTestPostgres();
  db = pgx.kysely<Database>();
  accounts = await makeAccounts();
}, 180_000);

afterAll(async () => {
  await pgx.stop();
});

describe("approving a request", () => {
  it("records the transaction and its posting together", async () => {
    const f = await aPendingRequest();
    const result = await approveAndRecord(db, postingFor(f));

    expect(result.replayed).toBe(false);
    expect(await countFor(f.requestId)).toEqual({ transactions: 1, postings: 1 });

    const tx = await readTransaction(db, result.transactionId);
    expect(tx.requestId).toBe(f.requestId);
    expect(tx.amount).toEqual(f.amount);
    expect(tx.approvedBy).toBe(f.senderId);
    expect(tx.intentState).toBe("committed");
    expect(tx.settlementState).toBe("not_started");
    // No provider has been called, so nothing may claim one has.
    expect(tx.settlementProvider).toBeNull();
    expect(tx.providerReferenceId).toBeNull();

    expect((await readRequest(db, f.requestId)).status).toBe("approved");
  });

  it("uses the request id as the ledger idempotency key", async () => {
    const f = await aPendingRequest();
    await approveAndRecord(db, postingFor(f));
    const { rows } = await sql<{ n: string }>`
      select count(*)::text as n from ledger_transaction
       where idempotency_key = ${f.requestId}
    `.execute(db);
    expect(rows[0]?.n).toBe("1");
  });

  it("posts a balanced double entry for the request amount", async () => {
    const f = await aPendingRequest(usd(123_45n));
    await approveAndRecord(db, postingFor(f));

    const { rows } = await sql<{ direction: string; amount_minor: string; currency: string }>`
      select e.direction, e.amount_minor, e.currency
        from ledger_entry e
        join ledger_transaction t on t.id = e.transaction_id
       where t.idempotency_key = ${f.requestId}
       order by e.direction
    `.execute(db);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.direction)).toEqual(["credit", "debit"]);
    for (const row of rows) {
      expect(BigInt(row.amount_minor)).toBe(12_345n);
      expect(row.currency).toBe("USD");
    }
  });

  it("writes the request's approval audit row", async () => {
    const f = await aPendingRequest();
    await approveAndRecord(db, postingFor(f));
    expect(await auditActions("request", f.requestId)).toEqual(["request.approve"]);
  });

  it("refuses to approve a request that is not pending", async () => {
    const f = await aPendingRequest();
    await approveAndRecord(db, postingFor(f));
    await expect(approveAndRecord(db, postingFor(f))).resolves.toMatchObject({ replayed: true });

    // A declined request is a different story: it can never be approved.
    const other = await aPendingRequest();
    await sql`
      update request set status = 'declined', resolved_by = ${other.senderId},
                         resolved_at = now(), decline_reason = 'No'
       where id = ${other.requestId}
    `
      .execute(db)
      .catch(() => undefined);
  });

  it("refuses to approve a declined request", async () => {
    const f = await aPendingRequest();
    const { declineRequest } = await import("../src/requests/index.js");
    await declineRequest(db, {
      requestId: f.requestId,
      actor: { kind: "user", id: f.senderId },
      reason: "No este mes",
    });

    await expect(approveAndRecord(db, postingFor(f))).rejects.toThrow(UndeclaredTransitionError);
    expect(await countFor(f.requestId)).toEqual({ transactions: 0, postings: 0 });
  });
});

describe("approve is idempotent", () => {
  it("produces one transaction and one posting under 20 parallel approvals", async () => {
    const f = await aPendingRequest();
    const input = postingFor(f);

    const results = await Promise.all(
      Array.from({ length: 20 }, async () => approveAndRecord(db, input)),
    );

    expect(await countFor(f.requestId)).toEqual({ transactions: 1, postings: 1 });

    // Exactly one caller did the writing; the rest replayed the same row.
    const ids = new Set(results.map((r) => r.transactionId));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);

    const { rows } = await sql<{ n: string }>`
      select count(*)::text as n from ledger_entry e
        join ledger_transaction t on t.id = e.transaction_id
       where t.idempotency_key = ${f.requestId}
    `.execute(db);
    expect(rows[0]?.n).toBe("2");
  });

  it("writes exactly one approval audit row across the race", async () => {
    const f = await aPendingRequest();
    const input = postingFor(f);
    await Promise.all(Array.from({ length: 20 }, async () => approveAndRecord(db, input)));
    expect(await auditActions("request", f.requestId)).toEqual(["request.approve"]);
  });
});

describe("no orphan can exist either way", () => {
  it("rolls the transaction row back when the posting fails", async () => {
    const f = await aPendingRequest();
    const before = await countFor(f.requestId);

    await expect(
      approveAndRecord(db, {
        ...postingFor(f),
        posting: {
          // An account that does not exist: the ledger insert fails, and the
          // transaction row written moments earlier must go with it.
          debitAccountId: "00000000-0000-4000-8000-000000000000",
          creditAccountId: accounts.creditAccountId,
          entryType: "remittance",
        },
      }),
    ).rejects.toThrow();

    expect(await countFor(f.requestId)).toEqual(before);
    // And the request is still waiting for a decision, not silently approved.
    expect((await readRequest(db, f.requestId)).status).toBe("pending");
  });

  it("leaves no transaction without a posting anywhere in the table", async () => {
    const { rows } = await sql<{ n: string }>`
      select count(*)::text as n
        from transaction t
        left join ledger_transaction l on l.idempotency_key = t.request_id::text
       where l.id is null
    `.execute(db);
    expect(rows[0]?.n).toBe("0");
  });
});

describe("intent and settlement move independently", () => {
  async function aCommittedTransaction(): Promise<{ id: string; f: Fixture }> {
    const f = await aPendingRequest();
    const { transactionId } = await approveAndRecord(db, postingFor(f));
    return { id: transactionId, f };
  }

  it("walks settlement all the way to settled with intent untouched", async () => {
    const { id } = await aCommittedTransaction();
    for (const to of ["instructed", "in_flight", "settled"] as const) {
      await advanceSettlement(db, { transactionId: id, to, actor: { kind: "system" } });
    }
    const tx = await readTransaction(db, id);
    expect(tx.settlementState).toBe("settled");
    expect(tx.intentState).toBe("committed");
    expect(await auditActions("transaction_settlement", id)).toEqual([
      "transaction.instructed",
      "transaction.in_flight",
      "transaction.settled",
    ]);
    // Intent never moved, so it has no audit rows of its own.
    expect(await auditActions("transaction_intent", id)).toEqual([]);
  });

  it("reaches reversed only from settled", async () => {
    const { id } = await aCommittedTransaction();
    await expect(
      advanceSettlement(db, { transactionId: id, to: "reversed", actor: { kind: "system" } }),
    ).rejects.toThrow(UndeclaredTransitionError);

    // Nor part-way through: there is nothing to reverse until it lands.
    for (const to of ["instructed", "in_flight"] as const) {
      await advanceSettlement(db, { transactionId: id, to, actor: { kind: "system" } });
      await expect(
        advanceSettlement(db, { transactionId: id, to: "reversed", actor: { kind: "system" } }),
      ).rejects.toThrow(UndeclaredTransitionError);
    }

    for (const to of ["settled", "reversed"] as const) {
      await advanceSettlement(db, { transactionId: id, to, actor: { kind: "system" } });
    }
    expect((await readTransaction(db, id)).settlementState).toBe("reversed");
  });

  it("reaches failed from every stage before it settles", async () => {
    for (const path of [[], ["instructed"], ["instructed", "in_flight"]] as const) {
      const { id } = await aCommittedTransaction();
      for (const to of path) {
        await advanceSettlement(db, { transactionId: id, to, actor: { kind: "system" } });
      }
      await advanceSettlement(db, { transactionId: id, to: "failed", actor: { kind: "system" } });
      expect((await readTransaction(db, id)).settlementState).toBe("failed");
    }
  });

  it("cancels intent while settlement has not started", async () => {
    const { id, f } = await aCommittedTransaction();
    await cancelIntent(db, { transactionId: id, actor: { kind: "user", id: f.senderId } });

    const tx = await readTransaction(db, id);
    expect(tx.intentState).toBe("cancelled");
    // Cancelling the agreement does not rewrite what settlement did.
    expect(tx.settlementState).toBe("not_started");
    expect(await auditActions("transaction_intent", id)).toEqual(["transaction.cancelled"]);
  });

  it("refuses to cancel intent once settlement has started", async () => {
    const { id, f } = await aCommittedTransaction();
    await advanceSettlement(db, {
      transactionId: id,
      to: "instructed",
      actor: { kind: "system" },
    });

    await expect(
      cancelIntent(db, { transactionId: id, actor: { kind: "user", id: f.senderId } }),
    ).rejects.toThrow(CancelAfterSettlementError);

    const tx = await readTransaction(db, id);
    expect(tx.intentState).toBe("committed");
    expect(tx.settlementState).toBe("instructed");
  });

  it("refuses to advance settlement once intent is cancelled", async () => {
    const { id, f } = await aCommittedTransaction();
    await cancelIntent(db, { transactionId: id, actor: { kind: "user", id: f.senderId } });

    await expect(
      advanceSettlement(db, { transactionId: id, to: "instructed", actor: { kind: "system" } }),
    ).rejects.toThrow();
    expect((await readTransaction(db, id)).settlementState).toBe("not_started");
  });

  it("refuses to cancel intent twice", async () => {
    const { id, f } = await aCommittedTransaction();
    const actor = { kind: "user", id: f.senderId } as const;
    await cancelIntent(db, { transactionId: id, actor });
    await expect(cancelIntent(db, { transactionId: id, actor })).rejects.toThrow(
      UndeclaredTransitionError,
    );
  });

  it("reaches every allowed pair of states and no others", async () => {
    // The cross product is 2 x 6. Seven pairs are reachable; the other five
    // are the ones the guard exists to prevent.
    const reachable = new Set<string>();

    for (const path of [
      [],
      ["instructed"],
      ["instructed", "in_flight"],
      ["instructed", "in_flight", "settled"],
      ["instructed", "in_flight", "settled", "reversed"],
      ["failed"],
    ] as const) {
      const { id } = await aCommittedTransaction();
      for (const to of path) {
        await advanceSettlement(db, { transactionId: id, to, actor: { kind: "system" } });
      }
      const tx = await readTransaction(db, id);
      reachable.add(`${tx.intentState}/${tx.settlementState}`);
    }

    const { id, f } = await aCommittedTransaction();
    await cancelIntent(db, { transactionId: id, actor: { kind: "user", id: f.senderId } });
    const cancelled = await readTransaction(db, id);
    reachable.add(`${cancelled.intentState}/${cancelled.settlementState}`);

    expect(reachable).toEqual(
      new Set([
        "committed/not_started",
        "committed/instructed",
        "committed/in_flight",
        "committed/settled",
        "committed/reversed",
        "committed/failed",
        "cancelled/not_started",
      ]),
    );
  });
});
