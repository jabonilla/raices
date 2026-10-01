import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { money } from "@raices/money";
import type { Database } from "../db/schema.js";
import type { IdentityService } from "../identity/service.js";
import { submitRequest, declineRequest } from "../requests/index.js";
import { approveAndRecord, type ApprovalPosting } from "../transactions/index.js";
import { UndeclaredTransitionError } from "../audit/index.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  toApiError,
} from "../errors.js";
import { installAuthorization, principal, authorizedRelationship } from "./policy.js";

export const WireMoneySchema = z
  .object({
    minor: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .max(100),
    currency: z.enum(["USD", "GTQ"]),
  })
  .strict();
export const SubmitSchema = z
  .object({
    amount: WireMoneySchema,
    categoryId: z.uuid().nullable(),
    description: z.string().trim().min(1).max(200),
    isEmergency: z.boolean().optional(),
  })
  .strict();
export const DeclineSchema = z.object({ reason: z.string().trim().min(1).max(200) }).strict();
export const RequestParams = z.object({ id: z.uuid(), requestId: z.uuid() }).strict();
export const PageSchema = z
  .object({
    before: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .max(19)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export const RequestViewSchema = z.object({
  id: z.uuid(),
  relationshipId: z.uuid(),
  amount: WireMoneySchema,
  categoryId: z.uuid().nullable(),
  description: z.string(),
  tier: z.string(),
  isEmergency: z.boolean(),
  status: z.string(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  declineReason: z.string().nullable(),
});
export interface RequestHttpOptions {
  db: Kysely<Database>;
  identity: Pick<IdentityService, "authenticate">;
  /** Trusted server mapping only; never supplied by the HTTP body. */
  postingFor?: (relationshipId: string, currency: "USD" | "GTQ") => Promise<ApprovalPosting>;
}
export function registerRequestRoutes(app: FastifyInstance, options: RequestHttpOptions): void {
  const { db } = options;
  const router = installAuthorization(app, options);
  // Driver errors may embed free-text bound values. Do not pass originals to host logging.
  const errorHandler: NonNullable<import("fastify").RouteOptions["errorHandler"]> = (
    error,
    request,
    reply,
  ) => {
    const safe =
      error instanceof UndeclaredTransitionError
        ? new ConflictError("Request action is unavailable.")
        : error;
    const mapped = toApiError(safe, request.id);
    void reply.code(mapped.statusCode).send(mapped.body);
  };
  function active(request: FastifyRequest) {
    const relationship = authorizedRelationship(request);
    if (relationship.status !== "active") throw new ConflictError("Relationship is not active.");
    return relationship;
  }
  async function row(request: FastifyRequest) {
    const { id, requestId } = RequestParams.parse(request.params);
    const r = await db
      .selectFrom("request")
      .selectAll()
      .where("id", "=", requestId)
      .where("relationship_id", "=", id)
      .executeTakeFirst();
    if (r === undefined) throw new NotFoundError();
    return r;
  }
  function view(r: Awaited<ReturnType<typeof row>>) {
    return RequestViewSchema.parse({
      id: r.id,
      relationshipId: r.relationship_id,
      amount: { minor: r.amount_minor, currency: r.amount_currency },
      categoryId: r.category_id,
      description: r.description,
      tier: r.tier,
      isEmergency: r.is_emergency,
      status: r.status,
      createdAt: r.created_at.toISOString(),
      resolvedAt: r.resolved_at?.toISOString() ?? null,
      declineReason: r.decline_reason,
    });
  }
  router.route({
    method: "POST",
    url: "/relationships/:id/requests",
    policy: { kind: "relationship", recipientOnly: true },
    errorHandler,
    handler: async (request, reply) => {
      const relationship = active(request);
      const input = SubmitSchema.parse(request.body);
      if (BigInt(input.amount.minor) <= 0n) throw new BadRequestError("Amount must be positive.");
      if (input.categoryId !== null) {
        const category = await db
          .selectFrom("category as c")
          .innerJoin("money_plan as p", "p.current_version_id", "c.plan_version_id")
          .select("c.id")
          .where("p.relationship_id", "=", relationship.id)
          .where("c.id", "=", input.categoryId)
          .executeTakeFirst();
        if (category === undefined) throw new BadRequestError("Category is unavailable.");
      }
      const result = await submitRequest(db, {
        relationshipId: relationship.id,
        requestedBy: principal(request).id,
        amount: money(BigInt(input.amount.minor), input.amount.currency),
        categoryId: input.categoryId,
        description: input.description,
        ...(input.isEmergency === undefined ? {} : { isEmergency: input.isEmergency }),
        channelOfOrigin: "app",
      });
      return reply.code(201).send(result);
    },
  });
  router.route({
    method: "GET",
    url: "/relationships/:id/requests",
    policy: { kind: "relationship" },
    errorHandler,
    handler: async (request) => {
      const { before, limit } = PageSchema.parse(request.query);
      let query = db
        .selectFrom("request")
        .selectAll()
        .where("relationship_id", "=", authorizedRelationship(request).id)
        .orderBy("seq", "desc")
        .limit(limit + 1);
      if (before !== undefined) query = query.where("seq", "<", before);
      const rows = await query.execute();
      return {
        items: rows.slice(0, limit).map(view),
        nextCursor: rows.length > limit ? (rows[limit - 1]?.seq ?? null) : null,
      };
    },
  });
  router.route({
    method: "GET",
    url: "/relationships/:id/requests/:requestId",
    policy: { kind: "relationship" },
    errorHandler,
    handler: async (request) => view(await row(request)),
  });
  router.route({
    method: "POST",
    url: "/relationships/:id/requests/:requestId/approve",
    policy: { kind: "relationship", senderOnly: true },
    errorHandler,
    handler: async (request) => {
      const relationship = active(request);
      z.object({})
        .strict()
        .parse(request.body ?? {});
      const r = await row(request);
      if (options.postingFor === undefined) throw new ServiceUnavailableError();
      const currency = z.enum(["USD", "GTQ"]).parse(r.amount_currency);
      const posting = await options.postingFor(relationship.id, currency);
      return approveAndRecord(db, {
        requestId: r.id,
        actor: { kind: "user", id: principal(request).id },
        channel: "app",
        posting,
      });
    },
  });
  router.route({
    method: "POST",
    url: "/relationships/:id/requests/:requestId/decline",
    policy: { kind: "relationship", senderOnly: true },
    errorHandler,
    handler: async (request, reply) => {
      active(request);
      const input = DeclineSchema.parse(request.body);
      const r = await row(request);
      await declineRequest(db, {
        requestId: r.id,
        actor: { kind: "user", id: principal(request).id },
        channel: "app",
        reason: input.reason,
      });
      return reply.code(204).send();
    },
  });
}
