import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db/schema.js";
import { openPendingContext } from "../src/conversation/index.js";
import { handleInboundMessage } from "../src/messaging/index.js";
import { createPlan } from "../src/plans/index.js";
import { findOrCreateUserByPhone, invite } from "../src/relationships/index.js";
import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * P3.3 behaviour against real Postgres.
 *
 * The parsing is proven in parse-message.test.ts without a database. What is
 * proven here is what the database owns, and above all the ticket's hardest
 * line: a declined or expired confirmation creates nothing. "Nothing" is
 * asserted as a row count, not as a return value, because a return value is
 * what the code believes and a row count is what is true.
 */

const TEST_TZ = "America/Guatemala";

let pgx: TestPostgres;
let db: Kysely<Database>;

let phoneCounter = 0;
function aPhone(): string {
  phoneCounter += 1;
  return `+5024${String(6_100_000 + phoneCounter).padStart(7, "0")}`;
}

interface Fixture {
  readonly relationshipId: string;
  readonly senderId: string;
  readonly recipientId: string;
}

async function aRelationshipWithPlan(): Promise<Fixture> {
  const sender = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "sender" });
  const recipient = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "recipient" });
  const rel = await invite(db, { senderId: sender.id, recipientId: recipient.id });
  await createPlan(db, {
    relationshipId: rel.id,
    createdBy: sender.id,
    capTimezone: TEST_TZ,
  });
  return { relationshipId: rel.id, senderId: sender.id, recipientId: recipient.id };
}

/** The assertion the ticket is really about. */
async function requestCount(relationshipId: string): Promise<number> {
  const { rows } = await sql<{ n: string }>`
    select count(*)::text as n from request where relationship_id = ${relationshipId}
  `.execute(db);
  return Number(rows[0]?.n ?? "0");
}

async function conversationState(relationshipId: string): Promise<string | undefined> {
  const row = await db
    .selectFrom("conversation")
    .select("state")
    .where("relationship_id", "=", relationshipId)
    .where("channel", "=", "whatsapp")
    .executeTakeFirst();
  return row?.state;
}

/** Send a message the way an inbound webhook eventually will. */
async function send(fixture: Fixture, text: string, now?: Date) {
  return handleInboundMessage(db, {
    relationshipId: fixture.relationshipId,
    requestedBy: fixture.recipientId,
    channel: "whatsapp",
    text,
    senderName: "Carlos",
    ...(now === undefined ? {} : { now }),
  });
}

beforeAll(async () => {
  pgx = await startTestPostgres();
  db = pgx.db as unknown as Kysely<Database>;
});

afterAll(async () => {
  await pgx.stop();
});

describe("a clear message becomes a request", () => {
  it("creates exactly one request, with the parsed amount and purpose", async () => {
    const fixture = await aRelationshipWithPlan();
    const outcome = await send(fixture, "necesito Q200 para la renta");

    expect(outcome.kind).toBe("request_created");
    expect(await requestCount(fixture.relationshipId)).toBe(1);

    const row = await db
      .selectFrom("request")
      .select([
        "amount_minor",
        "amount_currency",
        "description",
        "channel_of_origin",
        "tier",
        "status",
      ])
      .where("relationship_id", "=", fixture.relationshipId)
      .executeTakeFirstOrThrow();

    expect(row.amount_minor).toBe("20000");
    expect(row.amount_currency).toBe("GTQ");
    expect(row.description).toBe("la renta");
    expect(row.channel_of_origin).toBe("whatsapp");
    expect(row.status).toBe("pending");
  });

  it("runs the request through P2.4 classification unchanged", async () => {
    const fixture = await aRelationshipWithPlan();
    await send(fixture, "necesito Q200 para la renta");

    const row = await db
      .selectFrom("request")
      .select(["tier", "status"])
      .where("relationship_id", "=", fixture.relationshipId)
      .executeTakeFirstOrThrow();

    // The channel is an input path, not a shortcut past the rules: a
    // WhatsApp request with no plan category is `unrecognized` and waits for
    // a person, exactly as the same request made in the app would.
    expect(row.tier).toBe("unrecognized");
    expect(row.status).toBe("pending");
  });

  it("answers with a reply that names the amount", async () => {
    const fixture = await aRelationshipWithPlan();
    const outcome = await send(fixture, "necesito Q200 para la renta");
    expect(outcome.reply).toContain("200");
    expect(outcome.reply).toContain("Carlos");
  });
});

describe("an ambiguous amount confirms instead of creating", () => {
  it("writes no request and opens a pending confirmation", async () => {
    const fixture = await aRelationshipWithPlan();
    const outcome = await send(fixture, "necesito 200 o 300 para la renta");

    expect(outcome.kind).toBe("confirmation_requested");
    expect(await requestCount(fixture.relationshipId)).toBe(0);
    expect(await conversationState(fixture.relationshipId)).toBe("awaiting_confirmation");
  });

  it("asks which amount, naming both", async () => {
    const fixture = await aRelationshipWithPlan();
    const outcome = await send(fixture, "necesito 200 o 300 para la renta");
    expect(outcome.reply).toContain("200");
    expect(outcome.reply).toContain("300");
  });

  it("never answers with silence or an error code", async () => {
    const fixture = await aRelationshipWithPlan();
    for (const text of ["hola", "necesito dinero", "necesito 1.500", "necesito $200"]) {
      const outcome = await send(fixture, text);
      expect(outcome.reply.length).toBeGreaterThan(10);
      // A code like "ERR_PARSE" is exactly what the ticket forbids.
      expect(outcome.reply).not.toMatch(/\b[A-Z]{2,}_[A-Z_]+\b/);
    }
  });
});

describe("a confirmed approximate amount becomes a request", () => {
  it("creates one request only after the explicit yes", async () => {
    const fixture = await aRelationshipWithPlan();

    const asked = await send(fixture, "necesito como 200 para la renta");
    expect(asked.kind).toBe("confirmation_requested");
    // Nothing yet: the yes has not arrived.
    expect(await requestCount(fixture.relationshipId)).toBe(0);

    const confirmed = await send(fixture, "si");
    expect(confirmed.kind).toBe("request_created");
    expect(await requestCount(fixture.relationshipId)).toBe(1);

    const row = await db
      .selectFrom("request")
      .select(["amount_minor", "description"])
      .where("relationship_id", "=", fixture.relationshipId)
      .executeTakeFirstOrThrow();
    expect(row.amount_minor).toBe("20000");
    expect(row.description).toBe("la renta");
  });

  it("states the amount and the purpose in the confirmation it asks", async () => {
    const fixture = await aRelationshipWithPlan();
    const asked = await send(fixture, "necesito como 200 para la renta");
    expect(asked.reply).toContain("200");
    expect(asked.reply).toContain("la renta");
    expect(asked.reply).toContain("Carlos");
    // An explicit yes, not a tap.
    expect(asked.reply).toContain("SI");
  });
});

describe("a declined confirmation creates nothing", () => {
  it("writes zero request rows", async () => {
    const fixture = await aRelationshipWithPlan();
    await send(fixture, "necesito como 200 para la renta");
    expect(await requestCount(fixture.relationshipId)).toBe(0);

    const declined = await send(fixture, "no");
    expect(declined.kind).toBe("confirmation_declined");

    // The assertion the ticket asks for, stated as a count.
    expect(await requestCount(fixture.relationshipId)).toBe(0);
    expect(await conversationState(fixture.relationshipId)).toBe("idle");
  });

  it("does not leave the context behind for a later yes to find", async () => {
    const fixture = await aRelationshipWithPlan();
    await send(fixture, "necesito como 200 para la renta");
    await send(fixture, "no");

    // A "sí" after the refusal must not resurrect the discarded draft.
    const late = await send(fixture, "si");
    expect(late.kind).toBe("no_action");
    expect(await requestCount(fixture.relationshipId)).toBe(0);
  });

  it("records the refusal in the audit trail", async () => {
    const fixture = await aRelationshipWithPlan();
    await send(fixture, "necesito como 200 para la renta");
    await send(fixture, "no");

    const actions = await db
      .selectFrom("audit_log")
      .select("action")
      .where("entity_type", "=", "conversation")
      .orderBy("seq")
      .execute();
    // Saying no is a thing that happened, not the absence of a thing.
    expect(actions.map((a) => a.action)).toContain("conversation.decline_pending");
  });
});

describe("an expired confirmation creates nothing", () => {
  it("writes zero request rows when the yes arrives too late", async () => {
    const fixture = await aRelationshipWithPlan();

    // Proposed two hours ago, against a 30-minute window.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const asked = await send(fixture, "necesito como 200 para la renta", twoHoursAgo);
    expect(asked.kind).toBe("confirmation_requested");

    const late = await send(fixture, "si");
    expect(late.kind).toBe("confirmation_expired");

    expect(await requestCount(fixture.relationshipId)).toBe(0);
    expect(await conversationState(fixture.relationshipId)).toBe("idle");
  });

  it("tells the person it expired rather than failing silently", async () => {
    const fixture = await aRelationshipWithPlan();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await send(fixture, "necesito como 200 para la renta", twoHoursAgo);
    const late = await send(fixture, "si");
    expect(late.reply.length).toBeGreaterThan(10);
  });

  it("lets the person start over after an expiry", async () => {
    const fixture = await aRelationshipWithPlan();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await send(fixture, "necesito como 200 para la renta", twoHoursAgo);
    await send(fixture, "si");

    const fresh = await send(fixture, "necesito Q250 para la renta");
    expect(fresh.kind).toBe("request_created");
    expect(await requestCount(fixture.relationshipId)).toBe(1);
  });
});

describe("a yes with nothing pending", () => {
  it("creates nothing and says so", async () => {
    const fixture = await aRelationshipWithPlan();
    const outcome = await send(fixture, "si");
    expect(outcome.kind).toBe("no_action");
    expect(await requestCount(fixture.relationshipId)).toBe(0);
    expect(outcome.reply.length).toBeGreaterThan(10);
  });
});

describe("an unresolvable confirmation cannot be turned into a request by a yes", () => {
  it("does not read an arrival confirmation as a request draft", async () => {
    const fixture = await aRelationshipWithPlan();
    // ADR-002 makes arrival confirmation the primary evidence that money
    // reached someone, so "¿ya recibiste los Q200?" is a question this
    // conversation will really be asked. If a payload carrying an amount
    // were accepted on its shape alone, a "sí" meaning "yes, it arrived"
    // would create a brand new request for the same Q200.
    await openPendingContext(db, {
      relationshipId: fixture.relationshipId,
      channel: "whatsapp",
      state: "awaiting_arrival_confirmation",
      payload: {
        kind: "arrival_check",
        transactionId: crypto.randomUUID(),
        amountMinor: "20000",
        currency: "GTQ",
        requestedBy: fixture.recipientId,
      },
      actor: { kind: "user", id: fixture.recipientId },
    });

    const outcome = await send(fixture, "si");
    expect(outcome.kind).toBe("no_action");
    expect(await requestCount(fixture.relationshipId)).toBe(0);
  });

  it("creates nothing when a yes answers a foreign-currency question", async () => {
    const fixture = await aRelationshipWithPlan();
    // "$200" parses to a definite number, so a confirmation COULD carry a
    // draft — but the number is dollars. Turning a yes into a Q200 request
    // would silently redenominate what she asked for.
    const asked = await send(fixture, "necesito $200 para la renta");
    expect(asked.kind).toBe("confirmation_requested");

    const outcome = await send(fixture, "si");
    expect(outcome.kind).toBe("no_action");
    expect(await requestCount(fixture.relationshipId)).toBe(0);
  });

  it("creates nothing when a yes answers a clarification", async () => {
    const fixture = await aRelationshipWithPlan();
    // Two amounts: we never knew which, so there is no draft to confirm.
    await send(fixture, "necesito 200 o 300 para la renta");

    const outcome = await send(fixture, "si");
    expect(outcome.kind).toBe("no_action");
    // The hazard this guards: a "sí" picking one of the two for her.
    expect(await requestCount(fixture.relationshipId)).toBe(0);
  });
});
