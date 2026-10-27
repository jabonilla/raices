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
  resendInvitation,
  resume,
  terminate,
  InvitationExpiredError,
  RelationshipAlreadyExistsError,
  type StatusChangeInput,
} from "../relationships/relationships.js";
import type { UserRole } from "../relationships/schema.js";
import { findOrCreateUserByPhone } from "../relationships/users.js";
import { UndeclaredTransitionError } from "../audit/index.js";
import { installAuthorization, principal, authorizedRelationship } from "./policy.js";
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
  /**
   * S5 contract decision (Claude, 2026-10-27): the invitee's phone, but
   * only for the inviter's view. The inviter is always user_a (invite()
   * sets role_of_a "sender"), and the invitee's phone is their app_user
   * row — findOrCreateUserByPhone looks the invitee up by the supplied
   * phone, so it is that phone by construction. Absent for the invitee's
   * view and for anyone else; absent, never null, when it does not apply.
   */
  inviteePhoneE164: z.string().optional(),
});
export const InviteResponseSchema = z.object({ id: z.uuid() });
/**
 * The relationship lifecycle, as URLs.
 *
 * `role` is who may do it, enforced by the policy before the handler runs.
 * Accepting is the recipient's — it is their consent. Resending an
 * invitation is the sender's, since the recipient has not accepted one yet.
 * Pausing, resuming and terminating are either side's: both people are in
 * this relationship and either may step out of it or stop it.
 */
export const RELATIONSHIP_ACTIONS = [
  { action: "accept", role: "recipient", apply: activate },
  { action: "pause", role: undefined, apply: pause },
  { action: "resume", role: undefined, apply: resume },
  { action: "terminate", role: undefined, apply: terminate },
  { action: "resend-invitation", role: "sender", apply: resendInvitation },
] as const satisfies readonly {
  action: string;
  role: UserRole | undefined;
  apply: (db: Kysely<Database>, input: StatusChangeInput) => Promise<void>;
}[];

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
  const router = installAuthorization(app, { db, identity });
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
  function view(
    row: Awaited<ReturnType<typeof member>>,
    viewerId: string,
    phones: ReadonlyMap<string, string>,
  ) {
    const inviteePhone = viewerId === row.user_a_id ? phones.get(row.user_b_id) : undefined;
    return RelationshipResponseSchema.parse({
      id: row.id,
      status: row.status,
      displayName: row.display_name,
      userAId: row.user_a_id,
      userBId: row.user_b_id,
      invitedAt: row.invited_at.toISOString(),
      activatedAt: row.activated_at?.toISOString() ?? null,
      ...(inviteePhone === undefined ? {} : { inviteePhoneE164: inviteePhone }),
    });
  }
  /**
   * One query for every invitee phone a handler needs: the invitee is
   * always user_b, so the ids are known before the lookup. A missing row
   * yields no field, never a fabricated phone.
   */
  async function inviteePhones(
    rows: readonly { user_b_id: string }[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((row) => row.user_b_id))];
    if (ids.length === 0) return new Map();
    const users = await db
      .selectFrom("app_user")
      .select(["id", "phone"])
      .where("id", "in", ids)
      .execute();
    return new Map(users.map((user) => [user.id, user.phone]));
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
  router.route({
    method: "GET",
    url: "/relationships",
    policy: { kind: "sender" },
    handler: async (request, reply) => {
      const userId = principal(request).id;
      z.object({}).strict().parse(request.query);
      const rows = await db
        .selectFrom("relationship")
        .selectAll()
        .where((eb) => eb.or([eb("user_a_id", "=", userId), eb("user_b_id", "=", userId)]))
        .orderBy("seq", "desc")
        .execute();
      reply.header("cache-control", "no-store");
      const phones = await inviteePhones(rows);
      return rows.map((row) => view(row, userId, phones));
    },
  });
  router.route({
    method: "GET",
    url: "/relationships/:id",
    policy: { kind: "relationship" },
    handler: async (request, reply) => {
      z.object({}).strict().parse(request.query);
      reply.header("cache-control", "no-store");
      const row = authorizedRelationship(request);
      const phones = await inviteePhones([row]);
      return view(row, principal(request).id, phones);
    },
  });
  router.route({
    method: "POST",
    url: "/relationships/invite",
    policy: { kind: "sender" },
    handler: async (request, reply) => {
      const userId = principal(request).id;
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
        const recipient = await findOrCreateUserByPhone(db, {
          phone: body.phone,
          role: "recipient",
        });
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
    },
  });
  // One entry per lifecycle capability in ../relationships/relationships.ts.
  // `relationship-routes.test.ts` fails if that module grows another one and
  // it is not listed here or exempted there with a reason.
  for (const { action, role, apply } of RELATIONSHIP_ACTIONS) {
    router.route({
      method: "POST",
      url: `/relationships/:id/${action}`,
      policy: { kind: "relationship", ...(role === undefined ? {} : { role }) },
      handler: async (request, reply) => {
        const userId = principal(request).id;
        const { id } = RelationshipParamsSchema.parse(request.params);
        const body = EmptyWriteSchema.parse(request.body ?? {});
        const result = await write(request, userId, action, { ...body, id }, async () => {
          await apply(db, {
            relationshipId: id,
            actor: { kind: "user" as const, id: userId },
            channel: "app" as const,
          });
          const row = await member(userId, id);
          return view(row, userId, await inviteePhones([row]));
        });
        return reply.header("cache-control", "no-store").send(result);
      },
    });
  }
}
