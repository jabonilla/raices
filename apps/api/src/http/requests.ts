import { SUPPORTED_CURRENCIES, money } from "@raices/money";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";

import { UndeclaredTransitionError } from "../audit/index.js";
import type { Database } from "../db/schema.js";
import { BadRequestError, ConflictError, ServiceUnavailableError } from "../errors.js";
import type { IdentityService } from "../identity/service.js";
import {
  DeclineReasonRequiredError,
  DeclineReasonTooLongError,
  MAX_DECLINE_REASON_LENGTH,
  approveRequest,
  declineRequest,
  readRequest,
  submitRequest,
  type RequestRecord,
} from "../requests/requests.js";
import { TIERS } from "../requests/tier/index.js";
import { requestFingerprint, type DurableReceiptStore } from "./idempotency.js";
import { authorizedRelationship, installAuthorization, principal } from "./policy.js";
import { IdempotencyKeySchema } from "./relationships.js";

/**
 * Money on the wire.
 *
 * Minor units as a decimal string, never a JSON number: `9007199254740993`
 * survives this and does not survive `JSON.parse` into a double. The domain
 * speaks `bigint` (CLAUDE.md rule 1) and this is the only place the two
 * representations meet.
 */
export const WireMoneySchema = z
  .object({
    amountMinor: z.string().regex(/^[1-9]\d{0,18}$/u, "amountMinor must be positive minor units"),
    currency: z.enum(SUPPORTED_CURRENCIES),
  })
  .strict();

export const SubmitRequestSchema = z
  .object({
    amount: WireMoneySchema,
    description: z.string().min(1).max(2000),
    categoryId: z.uuid().nullable().default(null),
    isEmergency: z.boolean().default(false),
  })
  .strict();

export const DeclineRequestSchema = z
  .object({ reason: z.string().min(1).max(MAX_DECLINE_REASON_LENGTH) })
  .strict();

export const EmptyRequestWriteSchema = z.object({}).strict();
export const RequestParamsSchema = z.object({ id: z.uuid() }).strict();
export const RelationshipScopedParamsSchema = z.object({ id: z.uuid() }).strict();

export const RequestResponseSchema = z.object({
  id: z.uuid(),
  relationshipId: z.uuid(),
  requestedBy: z.uuid(),
  amount: WireMoneySchema,
  categoryId: z.uuid().nullable(),
  description: z.string(),
  tier: z.enum(TIERS),
  isEmergency: z.boolean(),
  channelOfOrigin: z.enum(["app", "whatsapp", "sms"]),
  status: z.enum(["pending", "approved", "declined", "expired"]),
  resolvedBy: z.uuid().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  declineReason: z.string().nullable(),
});

export const SubmitResponseSchema = z.object({ id: z.uuid(), tier: z.enum(TIERS) });

export interface RequestHttpOptions {
  db: Kysely<Database>;
  identity: IdentityService;
  receipts?: DurableReceiptStore;
}

function view(record: RequestRecord): z.infer<typeof RequestResponseSchema> {
  return RequestResponseSchema.parse({
    id: record.id,
    relationshipId: record.relationshipId,
    requestedBy: record.requestedBy,
    amount: {
      amountMinor: record.amount.amount.toString(),
      currency: record.amount.currency,
    },
    categoryId: record.categoryId,
    description: record.description,
    tier: record.tier,
    isEmergency: record.isEmergency,
    channelOfOrigin: record.channelOfOrigin,
    status: record.status,
    resolvedBy: record.resolvedBy,
    resolvedAt: record.resolvedAt?.toISOString() ?? null,
    declineReason: record.declineReason,
  });
}

/**
 * HTTP for the request lifecycle, over the domain functions in
 * `../requests/requests.ts`. Nothing here decides anything the domain
 * decides: no tier is computed, no status is written, no audit row is
 * composed. The one judgement this layer makes that the domain does not is
 * *who may act*, and that is made in `policy.ts`, before a handler runs.
 */
export function registerRequestRoutes(app: FastifyInstance, options: RequestHttpOptions): void {
  const { db, identity } = options;
  const router = installAuthorization(app, { db, identity });

  async function write<T>(
    request: FastifyRequest,
    userId: string,
    operation: string,
    body: unknown,
    work: () => Promise<T>,
  ): Promise<T> {
    const key = IdempotencyKeySchema.parse(request.headers["idempotency-key"]);
    if (options.receipts === undefined) throw new ServiceUnavailableError();
    return options.receipts.run(
      {
        actorId: userId,
        key,
        requestHash: requestFingerprint({ operation, params: request.params, body }),
      },
      async () => {
        try {
          return await work();
        } catch (error) {
          // A decline reason the domain refuses is the caller's mistake, and
          // an undeclared transition is a request someone else already
          // resolved. Both are definite answers, so the receipt stores them
          // and a replay gets the same one rather than running again.
          if (
            error instanceof DeclineReasonRequiredError ||
            error instanceof DeclineReasonTooLongError
          )
            throw new BadRequestError(error.message);
          if (error instanceof UndeclaredTransitionError)
            throw new ConflictError("This request has already been resolved.");
          throw error;
        }
      },
    );
  }

  router.route({
    method: "POST",
    url: "/relationships/:id/requests",
    // The recipient asks; the sender answers. PRD feature 1: "Recipient
    // requests a transfer with a stated purpose. Sender approves or
    // declines." The relationship id is in the URL rather than the body so
    // that the policy can authorize it without reading the body at all.
    policy: { kind: "relationship", role: "recipient" },
    handler: async (request, reply) => {
      const userId = principal(request).id;
      const { id } = RelationshipScopedParamsSchema.parse(request.params);
      const body = SubmitRequestSchema.parse(request.body);
      const result = await write(request, userId, "request.submit", body, async () =>
        submitRequest(db, {
          relationshipId: id,
          requestedBy: userId,
          amount: money(BigInt(body.amount.amountMinor), body.amount.currency),
          categoryId: body.categoryId,
          description: body.description,
          isEmergency: body.isEmergency,
          channelOfOrigin: "app",
        }),
      );
      return reply
        .header("cache-control", "no-store")
        .code(201)
        .send(SubmitResponseSchema.parse(result));
    },
  });

  router.route({
    method: "GET",
    url: "/relationships/:id/requests",
    policy: { kind: "relationship" },
    handler: async (request, reply) => {
      z.object({}).strict().parse(request.query);
      const relationship = authorizedRelationship(request);
      // One `readRequest` per row rather than a hand-rolled projection: the
      // row-to-record mapping validates the stored currency and rebuilds the
      // bigint amount, and duplicating that here is exactly the domain logic
      // this ticket says not to reimplement. A family's request list is
      // small; if it stops being small, the fix is a domain-level list
      // function, not a second copy of the mapping.
      const rows = await db
        .selectFrom("request")
        .select("id")
        .where("relationship_id", "=", relationship.id)
        .orderBy("seq", "desc")
        .execute();
      reply.header("cache-control", "no-store");
      return Promise.all(rows.map(async (row) => view(await readRequest(db, row.id))));
    },
  });

  router.route({
    method: "GET",
    url: "/requests/:id",
    policy: { kind: "request" },
    handler: async (request, reply) => {
      z.object({}).strict().parse(request.query);
      const { id } = RequestParamsSchema.parse(request.params);
      reply.header("cache-control", "no-store");
      return view(await readRequest(db, id));
    },
  });

  for (const action of ["approve", "decline"] as const) {
    router.route({
      method: "POST",
      url: `/requests/:id/${action}`,
      // Only the sender resolves. `approveRequest` would happily take the
      // recipient as its actor and write them into `resolved_by`; this is
      // what stops the person asking for the money from granting it.
      policy: { kind: "request", role: "sender" },
      handler: async (request, reply) => {
        const userId = principal(request).id;
        const { id } = RequestParamsSchema.parse(request.params);
        const body =
          action === "decline"
            ? DeclineRequestSchema.parse(request.body)
            : EmptyRequestWriteSchema.parse(request.body ?? {});
        const result = await write(
          request,
          userId,
          `request.${action}`,
          { ...body, id },
          async () => {
            const actor = { kind: "user" as const, id: userId };
            if (action === "approve")
              await approveRequest(db, { requestId: id, actor, channel: "app" });
            else
              await declineRequest(db, {
                requestId: id,
                actor,
                channel: "app",
                reason: (body as z.infer<typeof DeclineRequestSchema>).reason,
              });
            return view(await readRequest(db, id));
          },
        );
        return reply.header("cache-control", "no-store").send(result);
      },
    });
  }
}
