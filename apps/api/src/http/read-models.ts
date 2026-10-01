import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import { NotFoundError, toApiError } from "../errors.js";
import { installAuthorization, principal } from "./policy.js";
import { PageSchema, WireMoneySchema, type RequestHttpOptions } from "./requests.js";

export const ScreenRelationshipSchema = z.object({
  id: z.uuid(),
  displayName: z.string().nullable(),
  phoneE164: z.string(),
  status: z.string(),
  role: z.enum(["sender", "recipient"]),
  invitedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export const ScreenRequestSchema = z.object({
  id: z.uuid(),
  relationshipId: z.uuid(),
  recipientName: z.string().nullable(),
  amount: WireMoneySchema,
  category: z.object({ id: z.uuid(), label: z.string(), icon: z.string() }).nullable(),
  purpose: z.string(),
  tier: z.string(),
  isEmergency: z.boolean(),
  requestStatus: z.string(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  declineReason: z.string().nullable(),
  transaction: z
    .object({
      id: z.uuid(),
      intentState: z.string(),
      settlementState: z.string(),
      approvedAt: z.iso.datetime(),
    })
    .nullable(),
});
export const ScreenTransactionSchema = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  relationshipId: z.uuid(),
  amount: WireMoneySchema,
  intentState: z.string(),
  settlementState: z.string(),
  approvedAt: z.iso.datetime(),
  purpose: z.string(),
  categoryLabel: z.string().nullable(),
  fee: WireMoneySchema.nullable(),
  recipientAmount: WireMoneySchema.nullable(),
  fxRateApplied: z.string().nullable(),
});
export const pageOf = (schema: z.ZodType) =>
  z.object({ items: z.array(schema), nextCursor: z.string().nullable() });
interface RelationshipRow {
  id: string;
  seq: string;
  display_name: string | null;
  phone: string;
  status: string;
  role: string;
  invited_at: Date;
  expires_at: Date;
}
interface RequestRow {
  id: string;
  seq: string;
  relationship_id: string;
  display_name: string | null;
  amount_minor: string;
  amount_currency: string;
  category_id: string | null;
  category_name: string | null;
  category_icon: string | null;
  description: string;
  tier: string;
  is_emergency: boolean;
  status: string;
  created_at: Date;
  resolved_at: Date | null;
  decline_reason: string | null;
  transaction_id: string | null;
  intent_state: string | null;
  settlement_state: string | null;
  approved_at: Date | null;
}
interface TransactionRow {
  id: string;
  request_id: string;
  relationship_id: string;
  amount_minor: string;
  amount_currency: string;
  intent_state: string;
  settlement_state: string;
  approved_at: Date;
  description: string;
  category_name: string | null;
  fee_minor: string | null;
  fee_currency: string | null;
  recipient_amount_minor: string | null;
  recipient_amount_currency: string | null;
  fx_rate_applied: string | null;
}
export function registerReadModelRoutes(app: FastifyInstance, options: RequestHttpOptions): void {
  const router = installAuthorization(app, options);
  const errorHandler: NonNullable<import("fastify").RouteOptions["errorHandler"]> = (
    error,
    request,
    reply,
  ) => {
    const mapped = toApiError(error, request.id);
    void reply.code(mapped.statusCode).send(mapped.body);
  };
  router.route({
    method: "GET",
    url: "/screen/relationships",
    policy: { kind: "sender" },
    errorHandler,
    handler: async (request) => {
      const user = principal(request).id;
      const { before, limit } = PageSchema.parse(request.query);
      const { rows } =
        await sql<RelationshipRow>`select r.id,r.seq,r.display_name,r.status,r.invited_at,r.invited_at + interval '14 days' as expires_at,u.phone,case when r.user_a_id=${user} then r.role_of_a else r.role_of_b end as role from relationship r join app_user u on u.id=case when r.user_a_id=${user} then r.user_b_id else r.user_a_id end where (r.user_a_id=${user} or r.user_b_id=${user}) and (${before ?? null}::bigint is null or r.seq < ${before ?? null}::bigint) order by r.seq desc limit ${limit + 1}`.execute(
          options.db,
        );
      return {
        items: rows.slice(0, limit).map((r) =>
          ScreenRelationshipSchema.parse({
            id: r.id,
            displayName: r.display_name,
            phoneE164: r.phone,
            status: r.status,
            role: r.role,
            invitedAt: r.invited_at.toISOString(),
            expiresAt: r.expires_at.toISOString(),
          }),
        ),
        nextCursor: rows.length > limit ? (rows[limit - 1]?.seq ?? null) : null,
      };
    },
  });
  for (const path of ["requests", "history"])
    router.route({
      method: "GET",
      url: `/screen/${path}`,
      policy: { kind: "sender" },
      errorHandler,
      handler: async (request) => {
        const user = principal(request).id;
        const { before, limit } = PageSchema.parse(request.query);
        const { rows } =
          await sql<RequestRow>`select q.id,q.seq,q.relationship_id,r.display_name,q.amount_minor::text,q.amount_currency,q.category_id,c.name as category_name,c.icon as category_icon,q.description,q.tier,q.is_emergency,q.status,q.created_at,q.resolved_at,q.decline_reason,t.id as transaction_id,t.intent_state,t.settlement_state,t.approved_at from request q join relationship r on r.id=q.relationship_id left join category c on c.id=q.category_id left join transaction t on t.request_id=q.id where (r.user_a_id=${user} or r.user_b_id=${user}) and (${before ?? null}::bigint is null or q.seq < ${before ?? null}::bigint) order by q.seq desc limit ${limit + 1}`.execute(
            options.db,
          );
        return {
          items: rows.slice(0, limit).map((r) =>
            ScreenRequestSchema.parse({
              id: r.id,
              relationshipId: r.relationship_id,
              recipientName: r.display_name,
              amount: { minor: r.amount_minor, currency: r.amount_currency },
              category:
                r.category_id === null
                  ? null
                  : { id: r.category_id, label: r.category_name, icon: r.category_icon },
              purpose: r.description,
              tier: r.tier,
              isEmergency: r.is_emergency,
              requestStatus: r.status,
              createdAt: r.created_at.toISOString(),
              resolvedAt: r.resolved_at?.toISOString() ?? null,
              declineReason: r.decline_reason,
              transaction:
                r.transaction_id === null
                  ? null
                  : {
                      id: r.transaction_id,
                      intentState: r.intent_state,
                      settlementState: r.settlement_state,
                      approvedAt: r.approved_at?.toISOString(),
                    },
            }),
          ),
          nextCursor: rows.length > limit ? (rows[limit - 1]?.seq ?? null) : null,
        };
      },
    });
  router.route({
    method: "GET",
    url: "/screen/transactions/:transactionId",
    policy: { kind: "sender" },
    errorHandler,
    handler: async (request) => {
      const { transactionId } = z
        .object({ transactionId: z.uuid() })
        .strict()
        .parse(request.params);
      const user = principal(request).id;
      const { rows } =
        await sql<TransactionRow>`select t.id,t.request_id,t.relationship_id,t.amount_minor::text,t.amount_currency,t.intent_state,t.settlement_state,t.approved_at,q.description,c.name as category_name,t.fee_minor::text,t.fee_currency,t.recipient_amount_minor::text,t.recipient_amount_currency,t.fx_rate_applied::text from transaction t join relationship r on r.id=t.relationship_id join request q on q.id=t.request_id left join category c on c.id=q.category_id where t.id=${transactionId} and (r.user_a_id=${user} or r.user_b_id=${user})`.execute(
          options.db,
        );
      const r = rows[0];
      if (r === undefined) throw new NotFoundError();
      return ScreenTransactionSchema.parse({
        id: r.id,
        requestId: r.request_id,
        relationshipId: r.relationship_id,
        amount: { minor: r.amount_minor, currency: r.amount_currency },
        intentState: r.intent_state,
        settlementState: r.settlement_state,
        approvedAt: r.approved_at.toISOString(),
        purpose: r.description,
        categoryLabel: r.category_name,
        fee: r.fee_minor === null ? null : { minor: r.fee_minor, currency: r.fee_currency },
        recipientAmount:
          r.recipient_amount_minor === null
            ? null
            : { minor: r.recipient_amount_minor, currency: r.recipient_amount_currency },
        fxRateApplied: r.fx_rate_applied,
      });
    },
  });
}
