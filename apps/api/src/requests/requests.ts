import { isCurrency, money, type Money } from "@raices/money";
import type { Kysely, Transaction } from "kysely";

import { transition, type Actor, type Channel } from "../audit/index.js";
import { withSerializableTx } from "../db/serializable.js";
import { requestMachine } from "./machine.js";
import type { RequestDatabase, RequestStatus } from "./schema.js";
import {
  classify,
  type RecurringRuleSnapshot,
  type Tier,
  type TierPlanVersion,
} from "./tier/index.js";

/** Feature 1: a decline reason is "selected or written (<=200 chars)". */
export const MAX_DECLINE_REASON_LENGTH = 200;

/** An actor who can resolve a request. Expiry is the system's and has none. */
export type ResolvingActor = Extract<Actor, { id: string }>;

export class DeclineReasonRequiredError extends Error {
  readonly requestId: string;

  constructor(requestId: string) {
    super(
      `Declining request ${requestId} requires a reason (Feature 1). ` +
        `A blank reason is not one: the recipient is told why, so there has to be a why.`,
    );
    this.name = "DeclineReasonRequiredError";
    this.requestId = requestId;
  }
}

export class DeclineReasonTooLongError extends Error {
  readonly requestId: string;

  constructor(requestId: string, length: number) {
    super(
      `Decline reason for request ${requestId} is ${String(length)} characters; ` +
        `the limit is ${String(MAX_DECLINE_REASON_LENGTH)}.`,
    );
    this.name = "DeclineReasonTooLongError";
    this.requestId = requestId;
  }
}

export interface SubmitRequestInput {
  readonly relationshipId: string;
  readonly requestedBy: string;
  readonly amount: Money;
  /** Null when the recipient names no category from the plan in force. */
  readonly categoryId: string | null;
  readonly description: string;
  readonly isEmergency?: boolean;
  readonly channelOfOrigin: Channel;
  /**
   * Already spent in this category for the cap's period.
   *
   * Supplied by the caller rather than computed here. A monthly cap needs a
   * month boundary, and the PRD fixes a timezone for schedules and digests
   * but not for cap windows — so rather than pick one and bake it in, this
   * takes the number and the decision stays where it can be made properly.
   */
  readonly spendToDate: Money;
  readonly recurringRule?: RecurringRuleSnapshot | null;
}

export interface SubmittedRequest {
  readonly id: string;
  readonly tier: Tier;
}

export interface RequestRecord {
  readonly id: string;
  readonly relationshipId: string;
  readonly requestedBy: string;
  readonly amount: Money;
  readonly categoryId: string | null;
  readonly description: string;
  readonly tier: Tier;
  readonly isEmergency: boolean;
  readonly channelOfOrigin: Channel;
  readonly status: RequestStatus;
  readonly resolvedBy: string | null;
  readonly resolvedAt: Date | null;
  readonly declineReason: string | null;
}

/**
 * The plan version in force for a relationship, as the classifier needs it.
 *
 * Null when the relationship has no plan, or has one with no version yet —
 * both are "no plan at all" as far as classification goes.
 *
 * A relationship is expected to have one plan. Nothing in the schema forbids
 * a second, so this takes the most recently created one deterministically
 * rather than picking arbitrarily and classifying differently run to run.
 */
export async function planVersionInForce<DB extends RequestDatabase>(
  db: Kysely<DB>,
  relationshipId: string,
): Promise<TierPlanVersion | null> {
  const trx = db as unknown as Kysely<RequestDatabase>;

  const plan = await trx
    .selectFrom("money_plan")
    .select(["id", "current_version_id"])
    .where("relationship_id", "=", relationshipId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();

  const versionId = plan?.current_version_id;
  if (versionId === undefined || versionId === null) return null;

  const categories = await trx
    .selectFrom("category")
    .select(["id", "monthly_cap_minor", "monthly_cap_currency"])
    .where("plan_version_id", "=", versionId)
    .execute();

  return {
    id: versionId,
    categories: categories.map((c) => ({
      id: c.id,
      monthlyCap: capFromColumns(c.monthly_cap_minor, c.monthly_cap_currency),
    })),
  };
}

/**
 * Rebuild a cap from the two columns it is stored in.
 *
 * Both null is no cap. Half-set would have been refused by 0005's constraint,
 * so it can only mean the row was written by something that bypassed it.
 */
function capFromColumns(minor: string | null, currency: string | null): Money | null {
  if (minor === null && currency === null) return null;
  if (minor === null || currency === null) {
    throw new Error(
      "Category cap is half-set: an amount without a currency, or a currency without an amount.",
    );
  }
  if (!isCurrency(currency)) {
    throw new Error(`Category cap has unsupported currency ${JSON.stringify(currency)}.`);
  }
  return money(BigInt(minor), currency);
}

/**
 * Record a request and the tier it classifies into.
 *
 * Feature 1: "System classifies each request into a trust tier at
 * submission." The read of the plan version and the insert of the classified
 * request happen in one SERIALIZABLE transaction, so a plan edit racing with
 * a submission cannot produce a request classified against a version that was
 * never in force.
 *
 * The request is always created `pending`. Classifying is not approving:
 * auto-approval for the recurring tier is Feature 2's mechanism and has no
 * ticket yet, and until P2.5 there is no transaction record for an approval
 * to produce.
 */
export async function submitRequest<DB extends RequestDatabase>(
  db: Kysely<DB>,
  input: SubmitRequestInput,
): Promise<SubmittedRequest> {
  return withSerializableTx(db, async (raw) => {
    const trx = raw as unknown as Transaction<RequestDatabase>;

    const planVersion = await planVersionInForce(trx, input.relationshipId);

    const tier = classify({
      request: {
        amount: input.amount,
        categoryId: input.categoryId,
        isEmergency: input.isEmergency ?? false,
      },
      planVersion,
      spendToDate: input.spendToDate,
      recurringRule: input.recurringRule ?? null,
    });

    const row = await trx
      .insertInto("request")
      .values({
        relationship_id: input.relationshipId,
        requested_by: input.requestedBy,
        // Minor units go in as a bigint and come back as a string. Never a
        // JS number anywhere on this path.
        amount_minor: input.amount.amount,
        amount_currency: input.amount.currency,
        category_id: input.categoryId,
        description: input.description,
        tier,
        is_emergency: input.isEmergency ?? false,
        channel_of_origin: input.channelOfOrigin,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return { id: row.id, tier };
  });
}

export async function readRequest<DB extends RequestDatabase>(
  db: Kysely<DB>,
  requestId: string,
): Promise<RequestRecord> {
  const trx = db as unknown as Kysely<RequestDatabase>;

  const row = await trx
    .selectFrom("request")
    .select([
      "id",
      "relationship_id",
      "requested_by",
      "amount_minor",
      "amount_currency",
      "category_id",
      "description",
      "tier",
      "is_emergency",
      "channel_of_origin",
      "status",
      "resolved_by",
      "resolved_at",
      "decline_reason",
    ])
    .where("id", "=", requestId)
    .executeTakeFirst();

  if (row === undefined) throw new Error(`No request ${requestId}`);
  if (!isCurrency(row.amount_currency)) {
    throw new Error(`Request ${requestId} has unsupported currency ${row.amount_currency}.`);
  }

  return {
    id: row.id,
    relationshipId: row.relationship_id,
    requestedBy: row.requested_by,
    amount: money(BigInt(row.amount_minor), row.amount_currency),
    categoryId: row.category_id,
    description: row.description,
    tier: row.tier,
    isEmergency: row.is_emergency,
    channelOfOrigin: row.channel_of_origin,
    status: row.status,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    declineReason: row.decline_reason,
  };
}

/** Read the current status inside the caller's transaction. */
async function currentStatus<DB extends RequestDatabase>(
  db: Kysely<DB>,
  requestId: string,
): Promise<RequestStatus> {
  const trx = db as unknown as Kysely<RequestDatabase>;
  const row = await trx
    .selectFrom("request")
    .select("status")
    .where("id", "=", requestId)
    .executeTakeFirstOrThrow();
  return row.status;
}

interface ResolutionFields {
  readonly status: RequestStatus;
  readonly resolved_by: string | null;
  readonly resolved_at: Date;
  readonly decline_reason?: string;
}

/**
 * Move a request's status, writing the audit row with it.
 *
 * Everything goes through `transition()`, so an undeclared move is refused
 * before anything is written and the audit row commits with the change or not
 * at all. 0006 attaches `audit_enforce_transitions`, so the database
 * independently refuses a status change that arrives any other way.
 */
async function resolve<DB extends RequestDatabase>(
  db: Kysely<DB>,
  requestId: string,
  to: RequestStatus,
  action: string,
  actor: Actor,
  channel: Channel | undefined,
  fields: ResolutionFields,
): Promise<void> {
  const from = await currentStatus(db, requestId);

  await transition(
    db,
    requestMachine,
    {
      entityId: requestId,
      from,
      to,
      action,
      actor,
      ...(channel === undefined ? {} : { channel }),
    },
    async (raw) => {
      const trx = raw as unknown as Transaction<RequestDatabase>;
      await trx.updateTable("request").set(fields).where("id", "=", requestId).execute();
    },
  );
}

export interface ApproveRequestInput {
  readonly requestId: string;
  readonly actor: ResolvingActor;
  readonly channel?: Channel;
}

/**
 * Approve a request.
 *
 * Approval is the sender's decision and records who made it. It does not move
 * money: Feature 1 says approval triggers `SettlementProvider.release()`, and
 * that wiring arrives with the transaction record in P2.5.
 */
export async function approveRequest<DB extends RequestDatabase>(
  db: Kysely<DB>,
  input: ApproveRequestInput,
): Promise<void> {
  await resolve(db, input.requestId, "approved", "request.approve", input.actor, input.channel, {
    status: "approved",
    resolved_by: input.actor.id,
    resolved_at: new Date(),
  });
}

export interface DeclineRequestInput {
  readonly requestId: string;
  readonly actor: ResolvingActor;
  readonly channel?: Channel;
  /** Required. Feature 1: "Declining requires a reason." */
  readonly reason: string;
}

/**
 * Decline a request, with a reason.
 *
 * The reason is checked here and again by 0006's constraint. Two checks
 * because they answer different questions: this one gives the caller a usable
 * error, and the constraint makes the rule true of every row however it was
 * written.
 *
 * A declined request stays a request. PRD invariant 3: it never becomes a
 * transaction, and nothing in this module can post one.
 */
export async function declineRequest<DB extends RequestDatabase>(
  db: Kysely<DB>,
  input: DeclineRequestInput,
): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length === 0) throw new DeclineReasonRequiredError(input.requestId);
  if (reason.length > MAX_DECLINE_REASON_LENGTH) {
    throw new DeclineReasonTooLongError(input.requestId, reason.length);
  }

  await resolve(db, input.requestId, "declined", "request.decline", input.actor, input.channel, {
    status: "declined",
    resolved_by: input.actor.id,
    resolved_at: new Date(),
    decline_reason: reason,
  });
}

export interface ExpireRequestInput {
  readonly requestId: string;
}

/**
 * Expire a pending request.
 *
 * The system actor, and no resolver: an expiry is the absence of a decision,
 * so attributing it to a person would record a choice they never made. The
 * audit row still names what happened and when.
 */
export async function expireRequest<DB extends RequestDatabase>(
  db: Kysely<DB>,
  input: ExpireRequestInput,
): Promise<void> {
  await resolve(db, input.requestId, "expired", "request.expire", { kind: "system" }, undefined, {
    status: "expired",
    resolved_by: null,
    resolved_at: new Date(),
  });
}
