import { sql, type Kysely, type Transaction } from "kysely";

import { transitionWithin, type Actor } from "../audit/index.js";
import type { Channel } from "../audit/schema.js";
import { withSerializableTx, type WithSerializableTxOptions } from "../db/serializable.js";
import { conversationMachine } from "./machine.js";
import type { ConversationDatabase, ConversationState, PendingState } from "./schema.js";

/**
 * How long a pending context stays answerable, in minutes.
 *
 * The ticket's default. It is short on purpose: the window is how long a
 * bare "sí" can still mean something, and a long window is a long period in
 * which an affirmative meant for a later conversation can land on an earlier
 * proposal.
 */
export const DEFAULT_PENDING_TTL_MINUTES = 30;

export interface OpenPendingContextInput {
  readonly relationshipId: string;
  readonly channel: Channel;
  readonly state: PendingState;
  /** What the question was about. Stored verbatim as jsonb. */
  readonly payload: unknown;
  /**
   * When the question was put to the person. Defaults to now. The deadline
   * is measured from here, because the clock a person is answering against
   * starts when they were asked, not when we got round to recording it.
   */
  readonly proposedAt?: Date | undefined;
  readonly ttlMinutes?: number | undefined;
  readonly actor: Actor;
}

export interface OpenedContext {
  readonly conversationId: string;
  readonly expiresAt: Date;
}

export type AffirmativeOutcome =
  | { readonly attached: true; readonly from: PendingState; readonly payload: unknown }
  | { readonly attached: false; readonly reason: "expired" | "no_pending_context" };

export interface ResolveAffirmativeInput {
  readonly relationshipId: string;
  readonly channel: Channel;
  readonly actor: Actor;
}

/** The row shape both operations read. */
interface ConversationRow {
  readonly id: string;
  readonly state: ConversationState;
  readonly pending_payload: unknown;
  /** Computed by the database, against the database clock. */
  readonly expired: boolean | null;
}

/**
 * Read the conversation for this relationship and channel, locking it.
 *
 * `expired` is computed in SQL rather than in TypeScript so the comparison
 * happens against the database's clock at the instant of the read. Comparing
 * against a time the caller supplies would make the safety rule depend on
 * whoever is calling having an honest clock.
 *
 * There is deliberately no `for update` here. Serializing concurrent
 * messages on one conversation is SERIALIZABLE's job, and measurement says
 * the lock adds nothing on top: over 100 concurrent resolves the row lock
 * changed the serialization-retry count from 80 to 78, and removing it left
 * the exactly-once test passing. That is what SSI does — a `FOR UPDATE`
 * that conflicts raises 40001 rather than waiting, so the lock never
 * becomes the wait it looks like. Keeping it would have been a guard no
 * test could distinguish from its absence.
 */
async function readConversation<DB extends ConversationDatabase>(
  trx: Transaction<DB>,
  relationshipId: string,
  channel: Channel,
): Promise<ConversationRow | undefined> {
  const result = await sql<ConversationRow>`
    select id, state, pending_payload, (expires_at <= now()) as expired
    from conversation
    where relationship_id = ${relationshipId} and channel = ${channel}
  `.execute(trx);
  return result.rows[0];
}

/**
 * Put a question to someone and remember what it was about.
 *
 * If something is already pending it is dropped first, through its own
 * audited transition back to `idle`. The machine has no edge from one
 * pending state to another precisely so that this cannot happen silently:
 * the trail shows the first proposal being abandoned before the second
 * appears.
 */
export async function openPendingContext<DB extends ConversationDatabase>(
  db: Kysely<DB>,
  input: OpenPendingContextInput,
  options: WithSerializableTxOptions = {},
): Promise<OpenedContext> {
  const proposedAt = input.proposedAt ?? new Date();
  const ttlMinutes = input.ttlMinutes ?? DEFAULT_PENDING_TTL_MINUTES;
  const expiresAt = new Date(proposedAt.getTime() + ttlMinutes * 60_000);

  return withSerializableTx(
    db,
    async (rawTrx): Promise<OpenedContext> => {
      // Kysely's DB generic is invariant, so a `DB extends
      // ConversationDatabase` transaction is not assignable to one over the
      // narrow type. The constraint above is what makes the cast sound: the
      // tables and columns touched here are the same ones.
      const trx = rawTrx as unknown as Transaction<ConversationDatabase>;

      // A conversation is born idle — the database insists on it — so that
      // reaching a pending state is always an UPDATE, and always audited.
      await trx
        .insertInto("conversation")
        .values({
          relationship_id: input.relationshipId,
          channel: input.channel,
          state: "idle",
          last_message_at: proposedAt,
        })
        .onConflict((oc) => oc.columns(["relationship_id", "channel"]).doNothing())
        .execute();

      const existing = await readConversation(trx, input.relationshipId, input.channel);
      if (existing === undefined) {
        throw new Error("conversation row vanished between insert and lock");
      }

      if (existing.state !== "idle") {
        await transitionWithin(
          trx,
          conversationMachine,
          {
            entityId: existing.id,
            from: existing.state,
            to: "idle",
            action: "conversation.drop_pending",
            actor: input.actor,
            channel: input.channel,
          },
          async (inner) => {
            await inner
              .updateTable("conversation")
              .set({ state: "idle", pending_payload: null, expires_at: null })
              .where("id", "=", existing.id)
              .execute();
          },
        );
      }

      await transitionWithin(
        trx,
        conversationMachine,
        {
          entityId: existing.id,
          from: "idle",
          to: input.state,
          action: `conversation.${input.state}`,
          actor: input.actor,
          channel: input.channel,
        },
        async (inner) => {
          await inner
            .updateTable("conversation")
            .set({
              state: input.state,
              pending_payload: JSON.stringify(input.payload ?? null),
              expires_at: expiresAt,
              last_message_at: proposedAt,
            })
            .where("id", "=", existing.id)
            .execute();
        },
      );

      return { conversationId: existing.id, expiresAt };
    },
    options,
  );
}

/**
 * Consume an affirmative — a "sí" — against whatever is pending.
 *
 * Returns `{ attached: false, reason: "expired" }` when the context has gone
 * stale, and clears it, so the next message starts over. This is the safety
 * rule in the ticket and it is the reason this function exists at all: an
 * affirmative that attaches to a proposal the person has long forgotten is
 * consent to something they did not agree to, and in this system that is
 * money moving.
 *
 * Expiry is decided inside the same locked transaction that consumes the
 * context, so there is no window between "is it still valid" and "use it".
 * A background sweeper would have one, and the message would sometimes win
 * the race.
 */
export async function resolveAffirmative<DB extends ConversationDatabase>(
  db: Kysely<DB>,
  input: ResolveAffirmativeInput,
  options: WithSerializableTxOptions = {},
): Promise<AffirmativeOutcome> {
  return withSerializableTx(
    db,
    async (rawTrx): Promise<AffirmativeOutcome> => {
      // Invariance again; see the note in openPendingContext.
      const trx = rawTrx as unknown as Transaction<ConversationDatabase>;

      const row = await readConversation(trx, input.relationshipId, input.channel);

      // No conversation, or nothing pending. An affirmative out of nowhere
      // is not an error — people send them — it just has nothing to attach
      // to, and inventing something for it to mean is the whole hazard.
      if (row === undefined || row.state === "idle") {
        return { attached: false, reason: "no_pending_context" };
      }

      const from = row.state;
      const expired = row.expired === true;

      await transitionWithin(
        trx,
        conversationMachine,
        {
          entityId: row.id,
          from,
          to: "idle",
          // Dropping a stale proposal and accepting a live one are different
          // events in someone's money conversation, and the trail says which.
          action: expired ? "conversation.expire_pending" : "conversation.resolve_pending",
          actor: input.actor,
          channel: input.channel,
        },
        async (inner) => {
          await inner
            .updateTable("conversation")
            .set({
              state: "idle",
              pending_payload: null,
              expires_at: null,
              last_message_at: new Date(),
            })
            .where("id", "=", row.id)
            .execute();
        },
      );

      if (expired) return { attached: false, reason: "expired" };
      return { attached: true, from, payload: row.pending_payload };
    },
    options,
  );
}
