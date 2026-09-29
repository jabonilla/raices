import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { Database } from "../db/schema.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from "../errors.js";
import { IdentityService, PhoneSchema } from "../identity/service.js";
import {
  activate,
  invite,
  pause,
  terminate,
  InvitationExpiredError,
  RelationshipAlreadyExistsError,
} from "../relationships/relationships.js";
import { findOrCreateUserByPhone } from "../relationships/users.js";
import { UndeclaredTransitionError } from "../audit/index.js";
import { bearerToken } from "./identity.js";
import { requestFingerprint, type DurableReceiptStore } from "./idempotency.js";
import { InviteLimiter } from "./invite-limit.js";

export const InviteSchema = z
  .object({ phone: PhoneSchema, displayName: z.string().min(1).max(200).optional() })
  .strict();
export const RelationshipParamsSchema = z.object({ id: z.uuid() }).strict();
export const EmptyWriteSchema = z.object({}).strict();
export const IdempotencyKeySchema = z.string().min(1).max(200);
export const RelationshipResponseSchema = z.object({
  id: z.uuid(),
  status: z.enum(["invited", "active", "paused", "terminated"]),
  displayName: z.string().nullable(),
  userAId: z.uuid(),
  userBId: z.uuid(),
  invitedAt: z.iso.datetime(),
  activatedAt: z.iso.datetime().nullable(),
});
export const InviteResponseSchema = z.object({ id: z.uuid() });
export interface RelationshipHttpOptions {
  db: Kysely<Database>;
  identity: IdentityService;
  receipts?: DurableReceiptStore;
  inviteLimiter: InviteLimiter;
  clientIp?: (request: FastifyRequest) => string;
}
export function registerRelationshipRoutes(
  app: FastifyInstance,
  options: RelationshipHttpOptions,
): void {
  const { db, identity } = options;
  async function caller(request: FastifyRequest): Promise<string> {
    return (await identity.authenticate(bearerToken(request))).id;
  }
  async function member(userId: string, id: string) {
    const row = await db
      .selectFrom("relationship")
      .selectAll()
      .where("id", "=", id)
      .where((eb) => eb.or([eb("user_a_id", "=", userId), eb("user_b_id", "=", userId)]))
      .executeTakeFirst();
    if (row === undefined) throw new NotFoundError();
    return row;
  }
  function view(row: Awaited<ReturnType<typeof member>>) {
    return RelationshipResponseSchema.parse({
      id: row.id,
      status: row.status,
      displayName: row.display_name,
      userAId: row.user_a_id,
      userBId: row.user_b_id,
      invitedAt: row.invited_at.toISOString(),
      activatedAt: row.activated_at?.toISOString() ?? null,
    });
  }
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
          if (
            error instanceof InvitationExpiredError ||
            error instanceof RelationshipAlreadyExistsError ||
            error instanceof UndeclaredTransitionError
          )
            throw new ConflictError("Relationship action is unavailable.");
          throw error;
        }
      },
    );
  }
  app.get("/relationships", async (request, reply) => {
    const userId = await caller(request);
    z.object({}).strict().parse(request.query);
    const rows = await db
      .selectFrom("relationship")
      .selectAll()
      .where((eb) => eb.or([eb("user_a_id", "=", userId), eb("user_b_id", "=", userId)]))
      .orderBy("seq", "desc")
      .execute();
    reply.header("cache-control", "no-store");
    return rows.map(view);
  });
  app.get("/relationships/:id", async (request, reply) => {
    const userId = await caller(request);
    const { id } = RelationshipParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.query);
    reply.header("cache-control", "no-store");
    return view(await member(userId, id));
  });
  app.post("/relationships/invite", async (request, reply) => {
    const userId = await caller(request);
    const body = InviteSchema.parse(request.body);
    const self = await db
      .selectFrom("app_user")
      .select("phone")
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();
    if (self.phone === body.phone) throw new BadRequestError("Cannot invite yourself.");
    const result = await write(request, userId, "invite", body, async () => {
      await options.inviteLimiter.check(
        userId,
        options.clientIp?.(request) ?? request.raw.socket.remoteAddress ?? "unknown",
      );
      const recipient = await findOrCreateUserByPhone(db, { phone: body.phone, role: "recipient" });
      return invite(db, {
        senderId: userId,
        recipientId: recipient.id,
        ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
      });
    });
    return reply
      .header("cache-control", "no-store")
      .code(201)
      .send(InviteResponseSchema.parse(result));
  });
  for (const action of ["accept", "pause", "terminate"] as const) {
    app.post(`/relationships/:id/${action}`, async (request, reply) => {
      const userId = await caller(request);
      const { id } = RelationshipParamsSchema.parse(request.params);
      const body = EmptyWriteSchema.parse(request.body ?? {});
      const row = await member(userId, id);
      if (
        action === "accept" &&
        !(
          (row.user_a_id === userId && row.role_of_a === "recipient") ||
          (row.user_b_id === userId && row.role_of_b === "recipient")
        )
      )
        throw new NotFoundError();
      const result = await write(request, userId, action, { ...body, id }, async () => {
        const input = {
          relationshipId: id,
          actor: { kind: "user" as const, id: userId },
          channel: "app" as const,
        };
        if (action === "accept") await activate(db, input);
        else if (action === "pause") await pause(db, input);
        else await terminate(db, input);
        return view(await member(userId, id));
      });
      return reply.header("cache-control", "no-store").send(result);
    });
  }
}
