import { sql, type Kysely } from "kysely";

import { transition, type Actor, type Channel } from "../audit/index.js";
import type { Database } from "../db/schema.js";
import { relationshipMachine } from "./machine.js";
import type { RelationshipStatus } from "./schema.js";

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

/** Read the current status inside the caller's transaction. */
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
 * Everything goes through `transition()`, so an undeclared move is refused
 * before anything is written and the audit row commits with the change or not
 * at all. The database independently refuses a status change that arrives any
 * other way (0003's `audit_enforce_transitions`), so this is the only way in
 * rather than merely the intended one.
 */
async function changeStatus(
  db: Kysely<Database>,
  input: StatusChangeInput,
  to: RelationshipStatus,
  action: string,
  extra: (from: RelationshipStatus) => Record<string, unknown> = () => ({}),
): Promise<void> {
  const from = await currentStatus(db, input.relationshipId);

  try {
    await transition(
      db,
      relationshipMachine,
      {
        entityId: input.relationshipId,
        from,
        to,
        action,
        actor: input.actor,
        ...(input.channel === undefined ? {} : { channel: input.channel }),
      },
      async (trx) => {
        await trx
          .updateTable("relationship")
          .set({ status: to, ...extra(from) })
          .where("id", "=", input.relationshipId)
          .execute();
      },
    );
  } catch (error) {
    if (isExpiryViolation(error)) {
      throw new InvitationExpiredError(input.relationshipId, { cause: error });
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
