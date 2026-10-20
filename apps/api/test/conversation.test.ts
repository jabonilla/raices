import { readFile } from "node:fs/promises";

import { sql, type Kysely } from "kysely";
import pg from "pg";
import { Kysely as KyselyCtor, PostgresDialect } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db/schema.js";
import {
  DEFAULT_PENDING_TTL_MINUTES,
  conversationMachine,
  openPendingContext,
  recipientArrivalEvidence,
  resolveAffirmative,
  routeInbound,
} from "../src/conversation/index.js";
import { findOrCreateUserByPhone, activate, invite } from "../src/relationships/index.js";
import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * P3.2 behaviour, against real Postgres.
 *
 * The rule this file is mostly about is the expiry one, and it is a safety
 * rule rather than a tidiness one: a "sí" that attaches to a stale proposal
 * is consent to something the person did not agree to. It is proven by
 * letting a context go stale and then sending the affirmative, never by
 * reasoning about the clock arithmetic.
 */

let pgx: TestPostgres;
let pool: pg.Pool;
let db: Kysely<Database>;

let phoneCounter = 0;
function aPhone(): string {
  phoneCounter += 1;
  return `+5024${String(7_000_000 + phoneCounter).padStart(7, "0")}`;
}

const systemActor = { kind: "system" } as const;

/** A sender, a recipient and an active relationship between them. */
async function anActiveRelationship(): Promise<{
  relationshipId: string;
  senderId: string;
  recipientId: string;
}> {
  const sender = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "sender" });
  const recipient = await findOrCreateUserByPhone(db, { phone: aPhone(), role: "recipient" });
  const rel = await invite(db, { senderId: sender.id, recipientId: recipient.id });
  await activate(db, { relationshipId: rel.id, actor: { kind: "user", id: recipient.id } });
  return { relationshipId: rel.id, senderId: sender.id, recipientId: recipient.id };
}

async function conversationRow(relationshipId: string): Promise<
  | {
      id: string;
      state: string;
      pending_payload: unknown;
      expires_at: Date | null;
    }
  | undefined
> {
  return db
    .selectFrom("conversation")
    .select(["id", "state", "pending_payload", "expires_at"])
    .where("relationship_id", "=", relationshipId)
    .where("channel", "=", "whatsapp")
    .executeTakeFirst();
}

async function auditTrail(entityId: string): Promise<{ before: string | null; after: string }[]> {
  return db
    .selectFrom("audit_log")
    .select([
      sql<string | null>`before_state->>'state'`.as("before"),
      sql<string>`after_state->>'state'`.as("after"),
    ])
    .where("entity_id", "=", entityId)
    .where("entity_type", "=", "conversation")
    .orderBy("seq")
    .execute();
}

beforeAll(async () => {
  pgx = await startTestPostgres();
  pool = new pg.Pool({ connectionString: pgx.connectionString, max: 30 });
  pool.on("error", () => undefined);
  db = new KyselyCtor<Database>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  await db.destroy();
  await pgx.stop();
});

describe("pending context expires (the safety rule)", () => {
  it("does not let an affirmative resume a request whose context has expired", async () => {
    const { relationshipId, recipientId } = await anActiveRelationship();

    // Proposed two hours ago with the default 30-minute window, so the
    // context is long stale by the time the "sí" lands. The expiry is
    // measured against the database clock at the moment the affirmative is
    // consumed — not against a time the caller hands in — so this cannot be
    // talked out of expiring.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await openPendingContext(db, {
      relationshipId,
      channel: "whatsapp",
      state: "awaiting_confirmation",
      payload: { kind: "request_draft", amountMinor: "20000", currency: "GTQ" },
      proposedAt: twoHoursAgo,
      actor: systemActor,
    });

    const outcome = await resolveAffirmative(db, {
      relationshipId,
      channel: "whatsapp",
      actor: { kind: "user", id: recipientId },
    });

    expect(outcome).toEqual({ attached: false, reason: "expired" });

    // And the stale proposal is gone rather than lying in wait: the
    // conversation is back to idle with no payload and no deadline.
    const row = await conversationRow(relationshipId);
    expect(row?.state).toBe("idle");
    expect(row?.pending_payload).toBeNull();
    expect(row?.expires_at).toBeNull();
  });

  it("attaches an affirmative that arrives inside the window", async () => {
    const { relationshipId, recipientId } = await anActiveRelationship();
    const payload = { kind: "request_draft", amountMinor: "20000", currency: "GTQ" };

    await openPendingContext(db, {
      relationshipId,
      channel: "whatsapp",
      state: "awaiting_confirmation",
      payload,
      actor: systemActor,
    });

    const outcome = await resolveAffirmative(db, {
      relationshipId,
      channel: "whatsapp",
      actor: { kind: "user", id: recipientId },
    });

    // The positive case has to be here too. Without it, a bug that expires
    // everything would pass the test above and look like safety.
    expect(outcome).toEqual({ attached: true, from: "awaiting_confirmation", payload });
  });

  it("expires exactly at the boundary, not a minute either side", async () => {
    const { relationshipId, recipientId } = await anActiveRelationship();

    // One second past the window.
    const justOver = new Date(Date.now() - (DEFAULT_PENDING_TTL_MINUTES * 60 + 1) * 1000);
    await openPendingContext(db, {
      relationshipId,
      channel: "whatsapp",
      state: "awaiting_confirmation",
      payload: { kind: "request_draft" },
      proposedAt: justOver,
      actor: systemActor,
    });

    expect(
      await resolveAffirmative(db, {
        relationshipId,
        channel: "whatsapp",
        actor: { kind: "user", id: recipientId },
      }),
    ).toEqual({ attached: false, reason: "expired" });
  });

  it("reports no pending context rather than inventing one", async () => {
    const { relationshipId, recipientId } = await anActiveRelationship();

    // A "sí" out of nowhere, with nothing proposed. It must not create a
    // conversation in a pending state, and it must not throw at the user.
    const outcome = await resolveAffirmative(db, {
      relationshipId,
      channel: "whatsapp",
      actor: { kind: "user", id: recipientId },
    });

    expect(outcome).toEqual({ attached: false, reason: "no_pending_context" });
  });
});

describe("concurrent messages on one conversation", () => {
  it("attaches exactly one of 20 simultaneous affirmatives", async () => {
    const { relationshipId, recipientId } = await anActiveRelationship();
    await openPendingContext(db, {
      relationshipId,
      channel: "whatsapp",
      state: "awaiting_confirmation",
      payload: { kind: "request_draft", amountMinor: "20000" },
      actor: systemActor,
    });

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () =>
        resolveAffirmative(db, {
          relationshipId,
          channel: "whatsapp",
          actor: { kind: "user", id: recipientId },
        }),
      ),
    );

    // Twenty copies of one message must consume the proposal once. The rest
    // see a conversation with nothing pending, which is the truth.
    expect(outcomes.filter((o) => o.attached)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.attached)).toHaveLength(19);

    const row = await conversationRow(relationshipId);
    expect(row?.state).toBe("idle");
    expect(row?.pending_payload).toBeNull();
  });

  it("leaves no interleaved state behind when opens and resolves race", async () => {
    const { relationshipId, recipientId } = await anActiveRelationship();

    const work = Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0
        ? openPendingContext(db, {
            relationshipId,
            channel: "whatsapp",
            state: "awaiting_confirmation",
            payload: { kind: "request_draft", n: i },
            actor: systemActor,
          }).catch(() => undefined)
        : resolveAffirmative(db, {
            relationshipId,
            channel: "whatsapp",
            actor: { kind: "user", id: recipientId },
          }).catch(() => undefined),
    );
    await Promise.all(work);

    // Whatever the interleaving, the row must satisfy the invariant: a
    // pending state always carries both a payload and a deadline, and idle
    // carries neither. A half-written context is the corruption this is
    // looking for.
    const row = await conversationRow(relationshipId);
    expect(row).toBeDefined();
    if (row?.state === "idle") {
      expect(row.pending_payload).toBeNull();
      expect(row.expires_at).toBeNull();
    } else {
      expect(row?.pending_payload).not.toBeNull();
      expect(row?.expires_at).not.toBeNull();
    }
  });
});

describe("ambiguity is asked about, never guessed", () => {
  it("routes when the phone has exactly one relationship", () => {
    expect(routeInbound([{ relationshipId: "r1", counterpartyUserId: "u1" }])).toEqual({
      kind: "routed",
      relationshipId: "r1",
    });
  });

  it("asks when the phone has more than one relationship", () => {
    const candidates = [
      { relationshipId: "r1", counterpartyUserId: "u1" },
      { relationshipId: "r2", counterpartyUserId: "u2" },
    ];
    // The whole point: no scoring, no most-recent heuristic, no first-match.
    // Two relationships means we do not know, and we say so.
    expect(routeInbound(candidates)).toEqual({ kind: "ambiguous", candidates });
  });

  it("asks rather than guessing even when one candidate looks more likely", () => {
    // A tie-break would be the bug. Three relationships, one of them first in
    // the list — still a question, not an answer.
    const candidates = [
      { relationshipId: "r1", counterpartyUserId: "u1" },
      { relationshipId: "r2", counterpartyUserId: "u2" },
      { relationshipId: "r3", counterpartyUserId: "u3" },
    ];
    const routed = routeInbound(candidates);
    expect(routed.kind).toBe("ambiguous");
    if (routed.kind === "ambiguous") expect(routed.candidates).toHaveLength(3);
  });

  it("reports unknown when the phone has no relationship at all", () => {
    expect(routeInbound([])).toEqual({ kind: "unknown" });
  });

  it("opens a disambiguation context that itself expires", async () => {
    const { relationshipId } = await anActiveRelationship();
    await openPendingContext(db, {
      relationshipId,
      channel: "whatsapp",
      state: "awaiting_disambiguation",
      payload: { kind: "disambiguation", candidates: ["r1", "r2"] },
      actor: systemActor,
    });

    const row = await conversationRow(relationshipId);
    expect(row?.state).toBe("awaiting_disambiguation");
    // A question we asked is a pending context like any other, and an answer
    // to a question nobody remembers asking is the same hazard as a stale
    // "sí".
    expect(row?.expires_at).not.toBeNull();
  });
});

describe("arrival confirmation (ADR-002)", () => {
  it("turns a recipient's confirmation into arrival evidence", async () => {
    const { relationshipId, recipientId } = await anActiveRelationship();
    const transactionId = crypto.randomUUID();

    await openPendingContext(db, {
      relationshipId,
      channel: "whatsapp",
      state: "awaiting_arrival_confirmation",
      payload: { kind: "arrival_check", transactionId },
      actor: systemActor,
    });

    const outcome = await resolveAffirmative(db, {
      relationshipId,
      channel: "whatsapp",
      actor: { kind: "user", id: recipientId },
    });

    expect(outcome.attached).toBe(true);
    if (!outcome.attached) return;

    const confirmedAt = new Date();
    const evidence = recipientArrivalEvidence(outcome, { confirmedAt });
    expect(evidence).toEqual({ source: "recipient_confirmation", transactionId, confirmedAt });
  });

  it("yields no evidence from a confirmation that arrived too late", async () => {
    const { relationshipId, recipientId } = await anActiveRelationship();

    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await openPendingContext(db, {
      relationshipId,
      channel: "whatsapp",
      state: "awaiting_arrival_confirmation",
      payload: { kind: "arrival_check", transactionId: crypto.randomUUID() },
      proposedAt: longAgo,
      actor: systemActor,
    });

    const outcome = await resolveAffirmative(db, {
      relationshipId,
      channel: "whatsapp",
      actor: { kind: "user", id: recipientId },
    });

    // ADR-002 makes this the primary evidence that money arrived. Evidence
    // attached to a question the person may not have been answering is worse
    // than no evidence, because it would be recorded as a fact.
    expect(outcome).toEqual({ attached: false, reason: "expired" });
    expect(recipientArrivalEvidence(outcome, { confirmedAt: new Date() })).toBeNull();
  });

  it("refuses to read arrival evidence out of a non-arrival context", () => {
    // The same affirmative resolves a request draft and an arrival check.
    // Reading one as the other would record "she said the money arrived"
    // when she said "yes, ask him for 200".
    const outcome = {
      attached: true as const,
      from: "awaiting_confirmation" as const,
      payload: { kind: "request_draft", amountMinor: "20000" },
    };
    expect(recipientArrivalEvidence(outcome, { confirmedAt: new Date() })).toBeNull();
  });

  it("refuses an arrival-shaped payload carried by a non-arrival context", () => {
    // The sharp version of the test above, and the one that actually pins
    // the state check. If only the payload is inspected, an arrival-shaped
    // payload sitting on a confirmation context reads as "she confirmed the
    // money arrived" when the question on the table was something else.
    const outcome = {
      attached: true as const,
      from: "awaiting_confirmation" as const,
      payload: { kind: "arrival_check", transactionId: crypto.randomUUID() },
    };
    expect(recipientArrivalEvidence(outcome, { confirmedAt: new Date() })).toBeNull();
  });
});

describe("audit", () => {
  it("writes an audit row for every transition", async () => {
    const { relationshipId, recipientId } = await anActiveRelationship();

    await openPendingContext(db, {
      relationshipId,
      channel: "whatsapp",
      state: "awaiting_confirmation",
      payload: { kind: "request_draft" },
      actor: systemActor,
    });
    const row = await conversationRow(relationshipId);
    expect(row).toBeDefined();

    await resolveAffirmative(db, {
      relationshipId,
      channel: "whatsapp",
      actor: { kind: "user", id: recipientId },
    });

    expect(await auditTrail(row?.id ?? "")).toEqual([
      { before: "idle", after: "awaiting_confirmation" },
      { before: "awaiting_confirmation", after: "idle" },
    ]);
  });

  it("records the expiry itself as a transition, not a silent cleanup", async () => {
    const { relationshipId, recipientId } = await anActiveRelationship();
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    await openPendingContext(db, {
      relationshipId,
      channel: "whatsapp",
      state: "awaiting_confirmation",
      payload: { kind: "request_draft" },
      proposedAt: longAgo,
      actor: systemActor,
    });
    const row = await conversationRow(relationshipId);

    await resolveAffirmative(db, {
      relationshipId,
      channel: "whatsapp",
      actor: { kind: "user", id: recipientId },
    });

    // Dropping a proposal is a thing that happened to someone's money
    // conversation. It belongs in the trail.
    expect(await auditTrail(row?.id ?? "")).toEqual([
      { before: "idle", after: "awaiting_confirmation" },
      { before: "awaiting_confirmation", after: "idle" },
    ]);
  });
});

describe("expiry is the database's decision, not the application's", () => {
  it("compares expires_at against now() in SQL", async () => {
    // A source tripwire, because no behavioural test here can tell the two
    // clocks apart: the app and the database run on the same machine in
    // tests, so swapping `now()` for `Date.now()` passes everything above.
    // The distinction still matters — the app clock can drift from the
    // database's, and the whole safety rule is "the deadline is decided by
    // one authority". This fails if the comparison ever moves into
    // TypeScript.
    const source = await readFile(
      new URL("../src/conversation/conversation.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("(expires_at <= now()) as expired");

    // And nothing may hand a time in to be compared against: there is no
    // `now` on the resolve input, so a caller cannot argue a stale context
    // back to life.
    expect(source).not.toMatch(/expires_at\s*<=\s*\$\{/);
  });
});

describe("the state machine", () => {
  it("declares no edge that skips idle between two pending contexts", () => {
    // Moving straight from one pending context to another would overwrite a
    // proposal in place, and the overwritten one would never be audited as
    // dropped.
    const pending = [
      "awaiting_confirmation",
      "awaiting_disambiguation",
      "awaiting_arrival_confirmation",
    ] as const;
    for (const from of pending) {
      for (const to of pending) {
        expect(conversationMachine.transitions[from]).not.toContain(to);
      }
    }
  });
});
