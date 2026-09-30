import { money, type Money } from "@raices/money";
import { sql, type Kysely } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db/schema.js";
import { balance, post } from "../src/ledger/index.js";
import {
  activate,
  findOrCreateUserByPhone,
  invite,
  terminate,
} from "../src/relationships/index.js";
import { UndeclaredTransitionError } from "../src/audit/index.js";
import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * Red-team findings RED-1 (#99) and RED-2 (#100).
 *
 * K3's own regressions live in tests/redteam/ and are kept exactly as they
 * wrote them. These are the tests the fixes need on top of those: that the
 * new rules refuse what they are meant to refuse, and — the part #100 is
 * explicit about — that they do not refuse the thing this ledger relies on
 * to correct itself.
 */

const LATE_LEG = "LG004";
const TERMINATED_IS_TERMINAL = "RL002";

let pgx: TestPostgres;
let db: Kysely<Database>;
let assetId = "";
let liabilityId = "";

let counter = 0;
function aPhone(): string {
  counter += 1;
  return `+50243${String(300_000 + counter).padStart(6, "0")}`;
}

const usd = (minor: bigint): Money => money(minor, "USD");

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string } | undefined)?.code;
}

beforeAll(async () => {
  pgx = await startTestPostgres();
  db = pgx.kysely<Database>();

  const accounts = await sql<{ id: string }>`
    insert into ledger_account (code, type, currency)
    values ('redteamfix.asset.usd', 'asset', 'USD'),
           ('redteamfix.liability.usd', 'liability', 'USD')
    returning id
  `.execute(db);
  const [asset, liability] = accounts.rows;
  if (asset === undefined || liability === undefined) throw new Error("could not seed accounts");
  assetId = asset.id;
  liabilityId = liability.id;
}, 180_000);

afterAll(async () => {
  await pgx.stop();
});

function transfer(key: string, amount: Money, reversed = false) {
  return {
    idempotencyKey: key,
    description: reversed ? "compensating reversal" : "original posting",
    occurredAt: new Date("2026-09-30T00:00:00Z"),
    entries: [
      {
        accountId: reversed ? liabilityId : assetId,
        direction: "debit" as const,
        amount,
        entryType: reversed ? "reversal" : "transfer",
      },
      {
        accountId: reversed ? assetId : liabilityId,
        direction: "credit" as const,
        amount,
        entryType: reversed ? "reversal" : "transfer",
      },
    ],
  };
}

describe("RED-2: a leg is written with its parent", () => {
  it("refuses a new leg on a transaction that committed earlier", async () => {
    const original = await post(db, transfer(crypto.randomUUID(), usd(50_00n)));

    // Balanced, so the balance trigger has no objection. The objection is
    // that this posting was finished before this statement started.
    await expect(
      sql`
        insert into ledger_entry (transaction_id, account_id, direction, amount_minor,
                                  currency, entry_type)
        values (${original.transactionId}, ${assetId}, 'debit', 700, 'USD', 'late'),
               (${original.transactionId}, ${liabilityId}, 'credit', 700, 'USD', 'late')
      `.execute(db),
    ).rejects.toMatchObject({ code: LATE_LEG });
  });

  it("refuses even a single late leg, before the balance check can weigh in", async () => {
    const original = await post(db, transfer(crypto.randomUUID(), usd(10_00n)));
    const code = await sql`
      insert into ledger_entry (transaction_id, account_id, direction, amount_minor,
                                currency, entry_type)
      values (${original.transactionId}, ${assetId}, 'debit', 1, 'USD', 'late')
    `
      .execute(db)
      .then(
        () => undefined,
        (error: unknown) => errorCode(error),
      );
    // LG002 would mean the balance trigger caught it at commit. The point of
    // the fix is that it never gets that far.
    expect(code).toBe(LATE_LEG);
  });

  it("leaves the original posting's entry set exactly as it committed", async () => {
    const original = await post(db, transfer(crypto.randomUUID(), usd(33_00n)));
    await sql`
      insert into ledger_entry (transaction_id, account_id, direction, amount_minor,
                                currency, entry_type)
      values (${original.transactionId}, ${assetId}, 'debit', 700, 'USD', 'late'),
             (${original.transactionId}, ${liabilityId}, 'credit', 700, 'USD', 'late')
    `
      .execute(db)
      .catch(() => undefined);

    const { rows } = await sql<{ n: string; total: string }>`
      select count(*)::text as n, sum(amount_minor)::text as total
        from ledger_entry where transaction_id = ${original.transactionId}
    `.execute(db);
    // Two legs of 3300 each: what post() wrote and what request_hash covers.
    expect(rows[0]).toEqual({ n: "2", total: "6600" });
  });

  it("still allows a compensating posting, which is how this ledger corrects itself", async () => {
    // CLAUDE.md rule 2: corrections are new compensating transactions, never
    // edits. If the RED-2 fix blocked these it would be a worse bug than the
    // one it closes, so this is the case that matters most.
    const before = await balance(db, assetId);

    const original = await post(db, transfer(crypto.randomUUID(), usd(120_00n)));
    expect(original.replayed).toBe(false);

    const reversal = await post(db, transfer(crypto.randomUUID(), usd(120_00n), true));
    expect(reversal.replayed).toBe(false);
    expect(reversal.transactionId).not.toBe(original.transactionId);

    // The correction lands as its own transaction with its own legs, and the
    // account is back where it started.
    expect(await balance(db, assetId)).toEqual(before);

    const { rows } = await sql<{ n: string }>`
      select count(*)::text as n from ledger_entry
       where transaction_id = ${reversal.transactionId}
    `.execute(db);
    expect(rows[0]?.n).toBe("2");
  });

  it("allows a compensating posting long after the original, in a fresh connection", async () => {
    // The original's xmin is not merely old, it belongs to a session that has
    // since gone away. A correction must still be possible.
    const original = await post(db, transfer(crypto.randomUUID(), usd(75_00n)));

    const client = new pg.Client({ connectionString: pgx.connectionString });
    await client.connect();
    try {
      await client.query("begin");
      const inserted = await client.query<{ id: string }>(
        `insert into ledger_transaction (idempotency_key, request_hash, description, occurred_at)
         values ($1, 'compensating', 'late reversal', now()) returning id`,
        [crypto.randomUUID()],
      );
      const reversalId = inserted.rows[0]?.id;
      await client.query(
        `insert into ledger_entry (transaction_id, account_id, direction, amount_minor,
                                   currency, entry_type)
         values ($1, $2, 'debit', 7500, 'USD', 'reversal'),
                ($1, $3, 'credit', 7500, 'USD', 'reversal')`,
        [reversalId, liabilityId, assetId],
      );
      await client.query("commit");

      expect(reversalId).not.toBe(original.transactionId);
    } finally {
      await client.end();
    }
  });

  it("allows the app role to write a compensating posting", async () => {
    // The threat model is a compromised app writer, so the fix must bind that
    // role — without taking away the legitimate correction path it needs.
    const client = new pg.Client({ connectionString: pgx.connectionString });
    await client.connect();
    try {
      await client.query("set role app");
      await client.query("begin");
      const inserted = await client.query<{ id: string }>(
        `insert into ledger_transaction (idempotency_key, request_hash, description, occurred_at)
         values ($1, 'compensating', 'app reversal', now()) returning id`,
        [crypto.randomUUID()],
      );
      await client.query(
        `insert into ledger_entry (transaction_id, account_id, direction, amount_minor,
                                   currency, entry_type)
         values ($1, $2, 'debit', 200, 'USD', 'reversal'),
                ($1, $3, 'credit', 200, 'USD', 'reversal')`,
        [inserted.rows[0]?.id, liabilityId, assetId],
      );
      await client.query("commit");
    } finally {
      await client.end();
    }
  });
});

describe("RED-1: terminated is terminal", () => {
  async function aTerminatedRelationship(): Promise<string> {
    const sender = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "sender" });
    const recipient = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "recipient" });
    const rel = await invite(db, { senderId: sender.id, recipientId: recipient.id });
    await terminate(db, { relationshipId: rel.id, actor: { kind: "user", id: sender.id } });
    return rel.id;
  }

  it("refuses to activate a terminated relationship through the service", async () => {
    const id = await aTerminatedRelationship();
    const sender = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "sender" });

    await expect(
      activate(db, { relationshipId: id, actor: { kind: "user", id: sender.id } }),
    ).rejects.toThrow(UndeclaredTransitionError);

    const row = await db
      .selectFrom("relationship")
      .select("status")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("terminated");
  });

  it("refuses a bare SQL revival, for writers that never call the service", async () => {
    const id = await aTerminatedRelationship();
    const code = await sql`update relationship set status = 'active' where id = ${id}`
      .execute(db)
      .then(
        () => undefined,
        (error: unknown) => errorCode(error),
      );
    // Not AU002: the audit trigger is deferred to commit and would let this
    // reach the row first. This one refuses it outright.
    expect(code).toBe(TERMINATED_IS_TERMINAL);
  });

  it("refuses a revival even with an audit row written alongside it", async () => {
    const id = await aTerminatedRelationship();
    const client = new pg.Client({ connectionString: pgx.connectionString });
    await client.connect();
    let code: string | undefined;
    try {
      await client.query("begin");
      await client.query(`update relationship set status = 'active' where id = $1`, [id]);
      await client.query("commit");
    } catch (error) {
      code = errorCode(error);
      await client.query("rollback");
    } finally {
      await client.end();
    }
    expect(code).toBe(TERMINATED_IS_TERMINAL);
  });

  it("still allows the moves that are not revivals", async () => {
    // The control. A guard that froze the whole column would pass every test
    // above and make the relationship lifecycle unusable.
    const sender = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "sender" });
    const recipient = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "recipient" });
    const rel = await invite(db, { senderId: sender.id, recipientId: recipient.id });

    await activate(db, { relationshipId: rel.id, actor: { kind: "user", id: recipient.id } });
    const { pause, resume } = await import("../src/relationships/index.js");
    await pause(db, { relationshipId: rel.id, actor: { kind: "user", id: sender.id } });
    await resume(db, { relationshipId: rel.id, actor: { kind: "user", id: sender.id } });
    await terminate(db, { relationshipId: rel.id, actor: { kind: "user", id: sender.id } });

    const row = await db
      .selectFrom("relationship")
      .select("status")
      .where("id", "=", rel.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("terminated");
  });
});
