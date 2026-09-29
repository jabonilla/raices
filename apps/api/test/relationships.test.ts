import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db/schema.js";
import {
  INVITATION_WINDOW_DAYS,
  InvitationExpiredError,
  RelationshipAlreadyExistsError,
  activate,
  findOrCreateUserByPhone,
  invitationExpiresAt,
  invite,
  isInvitationExpired,
  pause,
  relationshipMachine,
  resendInvitation,
  resume,
  terminate,
} from "../src/relationships/index.js";
import { UndeclaredTransitionError } from "../src/audit/index.js";
import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * P2.2 behaviour, against real Postgres. The guarantees are transactional and
 * enforced by database triggers, so a mock would assert nothing.
 */

let pgx: TestPostgres;
let db: Kysely<Database>;

let phoneCounter = 0;
function aPhone(): string {
  phoneCounter += 1;
  return `+5024${String(4_000_000 + phoneCounter).padStart(7, "0")}`;
}

const systemActor = { kind: "system" } as const;

async function statusOf(relationshipId: string): Promise<string | undefined> {
  const row = await db
    .selectFrom("relationship")
    .select("status")
    .where("id", "=", relationshipId)
    .executeTakeFirst();
  return row?.status;
}

async function auditTrail(entityId: string): Promise<{ before: string | null; after: string }[]> {
  return db
    .selectFrom("audit_log")
    .select([
      sql<string | null>`before_state->>'state'`.as("before"),
      sql<string>`after_state->>'state'`.as("after"),
    ])
    .where("entity_id", "=", entityId)
    .where("entity_type", "=", "relationship")
    .orderBy("seq")
    .execute();
}

/** Age an invitation by rewriting invited_at, which is not a status change. */
async function backdateInvitation(relationshipId: string, days: number): Promise<void> {
  await sql`
    update relationship
       set invited_at = now() - (${String(days)} || ' days')::interval
     where id = ${relationshipId}
  `.execute(db);
}

async function aSender(): Promise<string> {
  const user = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "sender" });
  return user.id;
}

async function aRecipient(): Promise<string> {
  const user = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "recipient" });
  return user.id;
}

beforeAll(async () => {
  pgx = await startTestPostgres();
  db = pgx.kysely<Database>();
}, 120_000);

afterAll(async () => {
  await pgx.stop();
});

describe("finding or creating a user by phone", () => {
  it("creates a user the first time a number is seen", async () => {
    const phone = aPhone();
    const user = await findOrCreateUserByPhone(db, { phone, role: "sender" });
    expect(user.phone).toBe(phone);
    expect(user.created).toBe(true);
  });

  // PRD feature 1, edge cases: "Recipient's number is already a sender in the
  // system → link to existing user, do not create a duplicate."
  it("returns the existing user when the number is already known", async () => {
    const phone = aPhone();
    const first = await findOrCreateUserByPhone(db, { phone, role: "sender" });
    const second = await findOrCreateUserByPhone(db, { phone, role: "recipient" });

    expect(second.id).toBe(first.id);
    expect(second.created).toBe(false);
  });

  it("adds the new role to an existing user rather than replacing it", async () => {
    const phone = aPhone();
    await findOrCreateUserByPhone(db, { phone, role: "sender" });
    const second = await findOrCreateUserByPhone(db, { phone, role: "recipient" });

    expect([...second.roles].sort()).toEqual(["recipient", "sender"]);
  });

  it("does not duplicate a role the user already holds", async () => {
    const phone = aPhone();
    await findOrCreateUserByPhone(db, { phone, role: "sender" });
    const again = await findOrCreateUserByPhone(db, { phone, role: "sender" });
    expect(again.roles).toEqual(["sender"]);
  });

  it("rejects a phone number that is not E.164", async () => {
    await expect(
      findOrCreateUserByPhone(db, { phone: "502 5555 1234", role: "sender" }),
    ).rejects.toThrow();
  });

  it("creates exactly one user under concurrent first sightings of one number", async () => {
    const phone = aPhone();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => findOrCreateUserByPhone(db, { phone, role: "sender" })),
    );

    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);

    const { rows } = await sql<{ count: string }>`
      select count(*)::text as count from app_user where phone = ${phone}
    `.execute(db);
    expect(rows[0]?.count).toBe("1");
  });
});

/** Acceptance criterion: both directions, explicitly. */
describe("many-to-many", () => {
  it("lets one sender invite three recipients", async () => {
    const sender = await aSender();
    const recipients = await Promise.all([aRecipient(), aRecipient(), aRecipient()]);

    const relationships = [];
    for (const recipient of recipients) {
      relationships.push(await invite(db, { senderId: sender, recipientId: recipient }));
    }

    expect(new Set(relationships.map((r) => r.id)).size).toBe(3);

    const { rows } = await sql<{ count: string }>`
      select count(*)::text as count from relationship
       where user_a_id = ${sender} and role_of_a = 'sender'
    `.execute(db);
    expect(rows[0]?.count).toBe("3");
  });

  it("lets one recipient accept from three senders", async () => {
    const recipient = await aRecipient();
    const senders = await Promise.all([aSender(), aSender(), aSender()]);

    const relationships = [];
    for (const sender of senders) {
      const r = await invite(db, { senderId: sender, recipientId: recipient });
      await activate(db, { relationshipId: r.id, actor: { kind: "user", id: recipient } });
      relationships.push(r);
    }

    expect(new Set(relationships.map((r) => r.id)).size).toBe(3);

    const { rows } = await sql<{ count: string }>`
      select count(*)::text as count from relationship
       where user_b_id = ${recipient} and role_of_b = 'recipient' and status = 'active'
    `.execute(db);
    expect(rows[0]?.count).toBe("3");
  });

  // The two directions meeting: one person who sends to one family member and
  // receives from another is a single user, in two relationships.
  it("lets one user be a sender in one relationship and a recipient in another", async () => {
    const phone = aPhone();
    const middle = await findOrCreateUserByPhone(db, { phone, role: "recipient" });
    const upstream = await aSender();
    const downstream = await aRecipient();

    const receiving = await invite(db, { senderId: upstream, recipientId: middle.id });
    const sending = await invite(db, { senderId: middle.id, recipientId: downstream });

    expect(receiving.id).not.toBe(sending.id);

    const { rows } = await sql<{ count: string }>`
      select count(*)::text as count from app_user where phone = ${phone}
    `.execute(db);
    expect(rows[0]?.count).toBe("1");
  });

  it("creates a second relationship, never a second user, for a known number", async () => {
    const phone = aPhone();
    const recipient = await findOrCreateUserByPhone(db, { phone, role: "recipient" });
    const senderOne = await aSender();
    const senderTwo = await aSender();

    await invite(db, { senderId: senderOne, recipientId: recipient.id });
    await invite(db, { senderId: senderTwo, recipientId: recipient.id });

    const { rows } = await sql<{ users: string; relationships: string }>`
      select (select count(*)::text from app_user where phone = ${phone}) as users,
             (select count(*)::text from relationship where user_b_id = ${recipient.id})
               as relationships
    `.execute(db);
    expect(rows[0]).toEqual({ users: "1", relationships: "2" });
  });
});

describe("one live relationship per pair", () => {
  it("refuses a second invitation while one is live", async () => {
    const sender = await aSender();
    const recipient = await aRecipient();
    await invite(db, { senderId: sender, recipientId: recipient });

    await expect(invite(db, { senderId: sender, recipientId: recipient })).rejects.toThrow(
      RelationshipAlreadyExistsError,
    );
  });

  it("refuses one in the other direction too", async () => {
    const sender = await aSender();
    const recipient = await aRecipient();
    await invite(db, { senderId: sender, recipientId: recipient });

    await expect(invite(db, { senderId: recipient, recipientId: sender })).rejects.toThrow(
      RelationshipAlreadyExistsError,
    );
  });

  it("allows a fresh relationship after the previous one is terminated", async () => {
    const sender = await aSender();
    const recipient = await aRecipient();
    const first = await invite(db, { senderId: sender, recipientId: recipient });
    await terminate(db, { relationshipId: first.id, actor: systemActor });

    const second = await invite(db, { senderId: sender, recipientId: recipient });
    expect(second.id).not.toBe(first.id);

    // Both rows survive: the history of the ended relationship is retained
    // alongside the new one.
    const { rows } = await sql<{ count: string }>`
      select count(*)::text as count from relationship
       where least(user_a_id, user_b_id) = least(${sender}::uuid, ${recipient}::uuid)
         and greatest(user_a_id, user_b_id) = greatest(${sender}::uuid, ${recipient}::uuid)
    `.execute(db);
    expect(rows[0]?.count).toBe("2");
  });

  // The many-to-many rule is untouched by this: the constraint is per pair,
  // not per person.
  it("still lets a sender hold live relationships with several recipients", async () => {
    const sender = await aSender();
    for (const recipient of await Promise.all([aRecipient(), aRecipient(), aRecipient()])) {
      await expect(invite(db, { senderId: sender, recipientId: recipient })).resolves.toBeDefined();
    }
  });
});

describe("display name", () => {
  it("records what this sender calls this recipient", async () => {
    const r = await invite(db, {
      senderId: await aSender(),
      recipientId: await aRecipient(),
      displayName: "Tía Rosa",
    });

    const row = await db
      .selectFrom("relationship")
      .select("display_name")
      .where("id", "=", r.id)
      .executeTakeFirstOrThrow();
    expect(row.display_name).toBe("Tía Rosa");
  });

  // It belongs on the relationship, not the user: two senders may know the
  // same person by different names, and neither renames them globally.
  it("lets two senders name the same recipient differently", async () => {
    const recipient = await aRecipient();
    const one = await invite(db, {
      senderId: await aSender(),
      recipientId: recipient,
      displayName: "Mamá",
    });
    const two = await invite(db, {
      senderId: await aSender(),
      recipientId: recipient,
      displayName: "Doña Elena",
    });

    const rows = await db
      .selectFrom("relationship")
      .select(["id", "display_name"])
      .where("id", "in", [one.id, two.id])
      .execute();
    expect(rows.map((r) => r.display_name).sort()).toEqual(["Doña Elena", "Mamá"]);
  });

  it("leaves it null when the inviter gives none", async () => {
    const r = await invite(db, { senderId: await aSender(), recipientId: await aRecipient() });
    const row = await db
      .selectFrom("relationship")
      .select("display_name")
      .where("id", "=", r.id)
      .executeTakeFirstOrThrow();
    expect(row.display_name).toBeNull();
  });
});

describe("invitation expiry is derived, not scheduled", () => {
  it("computes the deadline from invited_at", () => {
    const invitedAt = new Date("2026-01-01T00:00:00Z");
    expect(invitationExpiresAt(invitedAt).toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(INVITATION_WINDOW_DAYS).toBe(14);
  });

  it("treats an invitation inside the window as live", async () => {
    const r = await invite(db, { senderId: await aSender(), recipientId: await aRecipient() });
    await backdateInvitation(r.id, 13);
    expect(await isInvitationExpired(db, r.id)).toBe(false);
  });

  it("treats an invitation past the window as expired, with no job having run", async () => {
    const r = await invite(db, { senderId: await aSender(), recipientId: await aRecipient() });
    await backdateInvitation(r.id, 15);

    // Nothing swept it; the status is still invited. Expiry is a reading of
    // invited_at, which is what makes it impossible to silently stop.
    expect(await statusOf(r.id)).toBe("invited");
    expect(await isInvitationExpired(db, r.id)).toBe(true);
  });

  it("refuses to activate an expired invitation", async () => {
    const r = await invite(db, { senderId: await aSender(), recipientId: await aRecipient() });
    await backdateInvitation(r.id, 15);

    await expect(activate(db, { relationshipId: r.id, actor: systemActor })).rejects.toThrow(
      InvitationExpiredError,
    );

    expect(await statusOf(r.id)).toBe("invited");
    expect(await auditTrail(r.id)).toEqual([]);
  });

  it("opens a fresh window when the invitation is resent", async () => {
    const r = await invite(db, { senderId: await aSender(), recipientId: await aRecipient() });
    await backdateInvitation(r.id, 15);
    expect(await isInvitationExpired(db, r.id)).toBe(true);

    await resendInvitation(db, { relationshipId: r.id, actor: systemActor });

    expect(await isInvitationExpired(db, r.id)).toBe(false);
    await expect(
      activate(db, { relationshipId: r.id, actor: systemActor }),
    ).resolves.toBeUndefined();
    expect(await statusOf(r.id)).toBe("active");
  });

  it("records the resend in the audit trail", async () => {
    const r = await invite(db, { senderId: await aSender(), recipientId: await aRecipient() });
    await resendInvitation(db, { relationshipId: r.id, actor: systemActor });

    expect(await auditTrail(r.id)).toEqual([{ before: "invited", after: "invited" }]);
  });

  // Expiry bites on the way in, not only in the helper: a caller that skips
  // isInvitationExpired still cannot activate a stale invitation.
  it("refuses activation even when the caller never checks", async () => {
    const r = await invite(db, { senderId: await aSender(), recipientId: await aRecipient() });
    await backdateInvitation(r.id, 14 * 12);
    await expect(activate(db, { relationshipId: r.id, actor: systemActor })).rejects.toThrow(
      InvitationExpiredError,
    );
  });
});

describe("status changes", () => {
  it("walks invited to active to paused to active to terminated, auditing each", async () => {
    const recipient = await aRecipient();
    const r = await invite(db, { senderId: await aSender(), recipientId: recipient });
    const actor = { kind: "user", id: recipient } as const;

    await activate(db, { relationshipId: r.id, actor });
    await pause(db, { relationshipId: r.id, actor });
    await resume(db, { relationshipId: r.id, actor });
    await terminate(db, { relationshipId: r.id, actor });

    expect(await statusOf(r.id)).toBe("terminated");
    expect(await auditTrail(r.id)).toEqual([
      { before: "invited", after: "active" },
      { before: "active", after: "paused" },
      { before: "paused", after: "active" },
      { before: "active", after: "terminated" },
    ]);
  });

  it("stamps activated_at when the invitation is accepted", async () => {
    const r = await invite(db, { senderId: await aSender(), recipientId: await aRecipient() });
    await activate(db, { relationshipId: r.id, actor: systemActor });

    const row = await db
      .selectFrom("relationship")
      .select("activated_at")
      .where("id", "=", r.id)
      .executeTakeFirstOrThrow();
    expect(row.activated_at).toBeInstanceOf(Date);
  });

  // PRD section 10: termination is final, history is retained.
  it("refuses to revive a terminated relationship", async () => {
    const r = await invite(db, { senderId: await aSender(), recipientId: await aRecipient() });
    await terminate(db, { relationshipId: r.id, actor: systemActor });

    await expect(activate(db, { relationshipId: r.id, actor: systemActor })).rejects.toThrow(
      UndeclaredTransitionError,
    );
    expect(await statusOf(r.id)).toBe("terminated");
  });

  it("refuses to pause an invitation that was never accepted", async () => {
    const r = await invite(db, { senderId: await aSender(), recipientId: await aRecipient() });
    await expect(pause(db, { relationshipId: r.id, actor: systemActor })).rejects.toThrow(
      UndeclaredTransitionError,
    );
  });

  it("declares exactly the transitions the ticket lists", () => {
    expect(relationshipMachine.transitions).toEqual({
      invited: ["invited", "active", "terminated"],
      active: ["paused", "terminated"],
      paused: ["active", "terminated"],
      terminated: [],
    });
  });

  it("writes one audit row per status change and no more", async () => {
    const r = await invite(db, { senderId: await aSender(), recipientId: await aRecipient() });
    await activate(db, { relationshipId: r.id, actor: systemActor });
    await pause(db, { relationshipId: r.id, actor: systemActor });

    expect(await auditTrail(r.id)).toHaveLength(2);
  });

  it("records the actor and channel on the audit row", async () => {
    const recipient = await aRecipient();
    const r = await invite(db, { senderId: await aSender(), recipientId: recipient });
    await activate(db, {
      relationshipId: r.id,
      actor: { kind: "user", id: recipient },
      channel: "whatsapp",
    });

    const row = await db
      .selectFrom("audit_log")
      .select(["actor_id", "actor_kind", "action", "channel"])
      .where("entity_id", "=", r.id)
      .executeTakeFirstOrThrow();

    expect(row).toEqual({
      actor_id: recipient,
      actor_kind: "user",
      action: "relationship.activate",
      channel: "whatsapp",
    });
  });
});
