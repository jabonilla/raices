import { sql, type Kysely } from "kysely";

import {
  UndeclaredTransitionError,
  transitionWithin,
  type Actor,
  type Channel,
} from "../audit/index.js";
import type { Database } from "../db/schema.js";
import { withSerializableTx } from "../db/serializable.js";
import { relationshipMachine } from "./machine.js";
import type { RelationshipStatus } from "./schema.js";

/** The entity type the relationship machine is declared with. */
const machineEntityType = "relationship";

/** Must match `relationship_invitation_window()` in 0004. */
export const INVITATION_WINDOW_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** SQLSTATE raised by the expiry guard in 0004. */
const INVITATION_EXPIRED = "RL001";

/** Postgres unique_violation, raised by relationship_one_live_per_pair. */
const UNIQUE_VIOLATION = "23505";

export class InvitationExpiredError extends Error {
  readonly relationshipId: string;

  constructor(relationshipId: string, options?: { cause?: unknown }) {
    super(
      `Invitation for relationship ${relationshipId} has expired. ` +
        `Resend it to open a new ${String(INVITATION_WINDOW_DAYS)}-day window.`,
      options,
    );
    this.name = "InvitationExpiredError";
    this.relationshipId = relationshipId;
  }
}

/**
 * When an invitation sent at `invitedAt` stops being acceptable.
 *
 * Derived, never stored. There is no expiry job, so there is no job that can
 * silently stop and leave stale invitations acceptable forever.
 */
export function invitationExpiresAt(invitedAt: Date): Date {
  return new Date(invitedAt.getTime() + INVITATION_WINDOW_DAYS * MS_PER_DAY);
}

export async function isInvitationExpired(
  db: Kysely<Database>,
  relationshipId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const row = await db
    .selectFrom("relationship")
    .select(["invited_at", "status"])
    .where("id", "=", relationshipId)
    .executeTakeFirstOrThrow();

  if (row.status !== "invited") return false;
  return now > invitationExpiresAt(row.invited_at);
}

function isExpiryViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === INVITATION_EXPIRED;
}

/**
 * Thrown when a pair already has a relationship that has not been terminated.
 *
 * Distinct from a generic conflict because the remedy is specific: the two
 * people are already connected, so the caller should use the relationship
 * they have rather than open a second one.
 */
export class RelationshipAlreadyExistsError extends Error {
  constructor(senderId: string, recipientId: string, options?: { cause?: unknown }) {
    super(
      `Users ${senderId} and ${recipientId} already have a relationship that has not been ` +
        `terminated. Terminate it before inviting again.`,
      options,
    );
    this.name = "RelationshipAlreadyExistsError";
  }
}

export interface InviteInput {
  readonly senderId: string;
  readonly recipientId: string;
  /**
   * What the sender calls this recipient. PII, and optional: null means null,
   * never a name inferred from the phone number or a placeholder.
   */
  readonly displayName?: string;
}

export interface InvitedRelationship {
  readonly id: string;
}

/**
 * Open an invitation from one user to another.
 *
 * `user_a` is the sender and `user_b` the recipient, but nothing downstream
 * may assume a user appears on only one side or in only one relationship: a
 * sender may invite many recipients and a recipient may accept from many
 * senders (PRD feature 1).
 */
export async function invite(
  db: Kysely<Database>,
  input: InviteInput,
): Promise<InvitedRelationship> {
  try {
    const row = await db
      .insertInto("relationship")
      .values({
        user_a_id: input.senderId,
        user_b_id: input.recipientId,
        role_of_a: "sender",
        role_of_b: "recipient",
        display_name: input.displayName ?? null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return { id: row.id };
  } catch (error) {
    // The partial unique index in 0004 allows one live relationship per pair.
    // Re-inviting after termination is fine and lands here only while the
    // previous one is still live.
    if ((error as { code?: unknown } | null)?.code === UNIQUE_VIOLATION) {
      throw new RelationshipAlreadyExistsError(input.senderId, input.recipientId, {
        cause: error,
      });
    }
    throw error;
  }
}

interface StatusChangeInput {
  readonly relationshipId: string;
  readonly actor: Actor;
  readonly channel?: Channel;
}

/** SQLSTATE raised by the terminal-state guard in 0009. */
const TERMINATED_IS_TERMINAL = "RL002";

/**
 * Thrown when the relationship moved underneath this caller.
 *
 * Distinct from `UndeclaredTransitionError` because the move was legal when
 * it was chosen: somebody else simply got there first. The remedy is to read
 * the relationship again and decide against what it now is.
 */
export class StaleRelationshipStateError extends Error {
  readonly relationshipId: string;
  readonly expected: RelationshipStatus;

  constructor(relationshipId: string, expected: RelationshipStatus, options?: { cause?: unknown }) {
    super(
      `Relationship ${relationshipId} was no longer "${expected}" when the change was applied. ` +
        `Someone moved it first; re-read it and decide again.`,
      options,
    );
    this.name = "StaleRelationshipStateError";
    this.relationshipId = relationshipId;
    this.expected = expected;
  }
}

function isTerminatedRevival(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === TERMINATED_IS_TERMINAL;
}

/** Read the current status. Must be called inside the transaction that writes. */
async function currentStatus(
  trx: Kysely<Database>,
  relationshipId: string,
): Promise<RelationshipStatus> {
  const row = await trx
    .selectFrom("relationship")
    .select("status")
    .where("id", "=", relationshipId)
    .executeTakeFirstOrThrow();
  return row.status;
}

/**
 * Move a relationship's status, writing the audit row with it.
 *
 * The read of the current status happens **inside** the transaction that
 * writes (RED-1, #99). It used to happen before `transition()` opened one,
 * which meant SERIALIZABLE was guarding a decision made outside its view: an
 * acceptance could read `invited`, wait while a termination committed, and
 * then write `active` over it. The audit trigger could not catch it either —
 * it checks that the destination state was audited, and knows nothing about
 * whether the source state was still true.
 *
 * Three things now have to agree, and each covers what the others cannot:
 *
 * 1. The read is inside the transaction, so SERIALIZABLE can see it and a
 *    concurrent write to the same row becomes a serialization failure that
 *    `withSerializableTx` replays against a fresh snapshot.
 * 2. The update is a compare-and-swap on the status we read. Zero rows
 *    updated means the row moved between the read and the write, and the
 *    caller is told rather than silently succeeding.
 * 3. 0009 refuses, in the database, any move out of `terminated`. That one
 *    holds for writers that never come through this function at all.
 *
 * Everything still goes through `transition()`, so an undeclared move is
 * refused before anything is written and the audit row commits with the
 * change or not at all.
 */
async function changeStatus(
  db: Kysely<Database>,
  input: StatusChangeInput,
  to: RelationshipStatus,
  action: string,
  extra: (from: RelationshipStatus) => Record<string, unknown> = () => ({}),
): Promise<void> {
  try {
    await withSerializableTx(db, async (raw) => {
      const trx = raw as unknown as Kysely<Database>;
      const from = await currentStatus(trx, input.relationshipId);

      await transitionWithin(
        raw,
        relationshipMachine,
        {
          entityId: input.relationshipId,
          from,
          to,
          action,
          actor: input.actor,
          ...(input.channel === undefined ? {} : { channel: input.channel }),
        },
        async (inner) => {
          const result = await inner
            .updateTable("relationship")
            .set({ status: to, ...extra(from) })
            .where("id", "=", input.relationshipId)
            // The compare-and-swap. Under SERIALIZABLE a concurrent write
            // normally surfaces as 40001 before this can miss, so this is the
            // belt to that braces: it is what still refuses the write if the
            // read is ever moved back out, or the isolation level changes.
            .where("status", "=", from)
            .executeTakeFirst();

          if ((result.numUpdatedRows ?? 0n) === 0n) {
            throw new StaleRelationshipStateError(input.relationshipId, from);
          }
        },
      );
    });
  } catch (error) {
    if (isExpiryViolation(error)) {
      throw new InvitationExpiredError(input.relationshipId, { cause: error });
    }
    if (isTerminatedRevival(error)) {
      throw new UndeclaredTransitionError(machineEntityType, "terminated", to, []);
    }
    throw error;
  }
}

/** Accept an invitation. Refused, by the database, once the window has passed. */
export async function activate(db: Kysely<Database>, input: StatusChangeInput): Promise<void> {
  await changeStatus(db, input, "active", "relationship.activate", () => ({
    activated_at: new Date(),
  }));
}

export async function pause(db: Kysely<Database>, input: StatusChangeInput): Promise<void> {
  await changeStatus(db, input, "paused", "relationship.pause");
}

export async function resume(db: Kysely<Database>, input: StatusChangeInput): Promise<void> {
  await changeStatus(db, input, "active", "relationship.resume");
}

/** End a relationship. Terminal: history is retained, but nothing revives it. */
export async function terminate(db: Kysely<Database>, input: StatusChangeInput): Promise<void> {
  await changeStatus(db, input, "terminated", "relationship.terminate");
}

/**
 * Resend an invitation, which reopens the window.
 *
 * A declared self-transition rather than a bare UPDATE, so the resend is
 * audited like every other change to the row. Moving `invited_at` forward is
 * the whole mechanism: expiry is derived from it, so a new timestamp is a new
 * window, with nothing to reschedule.
 */
export async function resendInvitation(
  db: Kysely<Database>,
  input: StatusChangeInput,
): Promise<void> {
  await changeStatus(db, input, "invited", "relationship.invitation_resent", () => ({
    invited_at: sql<Date>`now()`,
  }));
}
