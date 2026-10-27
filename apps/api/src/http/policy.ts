import type { FastifyInstance, FastifyRequest, RouteOptions } from "fastify";
import type { ExpressionBuilder, Kysely, Selectable } from "kysely";
import { z } from "zod";
import type { Database } from "../db/schema.js";
import type { IdentityService, IdentityUser } from "../identity/service.js";
import type { UserRole } from "../relationships/schema.js";
import { NotFoundError, UnauthorizedError } from "../errors.js";
import { installHttpIdempotency, type HttpIdempotencyOptions } from "./idempotency-http.js";

export type AuthorizationPolicy =
  | { readonly kind: "public" }
  /**
   * Provider-authenticated webhook route. The route's signature verifier is
   * the authentication boundary; this policy must never invoke bearer auth.
   */
  | { readonly kind: "signature-verified" }
  | { readonly kind: "sender" }
  /**
   * A route whose `:id` is a relationship id. `role`, where given, restricts
   * the action to one side of it.
   */
  | { readonly kind: "relationship"; readonly role?: UserRole }
  /**
   * A route whose `:id` is a *request* id, not a relationship id.
   *
   * Requests belong to a relationship, so the membership question is the same
   * one `relationship` asks — but one join further out. It needs its own kind
   * because `relationship` reads `:id` as a relationship and would 404 every
   * request route by looking the wrong id up in the wrong table.
   *
   * `role` gates the action to one side of the relationship. The domain does
   * not: `approveRequest` accepts any actor and writes whoever it is given
   * into `resolved_by`. Nothing below this line stops a recipient approving
   * their own request, so this is the only place it is stopped.
   */
  | { readonly kind: "request"; readonly role?: UserRole };
declare module "fastify" {
  interface FastifyContextConfig {
    authorizationPolicy?: AuthorizationPolicy;
  }
}
export interface AuthorizationOptions {
  identity: Pick<IdentityService, "authenticate">;
  db?: Kysely<Database>;
  httpIdempotency?: Omit<HttpIdempotencyOptions, "scope">;
}
type Relationship = Selectable<Database["relationship"]>;
/**
 * Which side of the relationship this person is on, or undefined if neither.
 *
 * The caller has already been proved a member by the query above; this only
 * says which half. It is a function rather than two inline comparisons so
 * that "which role is this person" has one definition.
 */
function roleOf(row: Relationship, userId: string): UserRole | undefined {
  if (row.user_a_id === userId) return row.role_of_a;
  if (row.user_b_id === userId) return row.role_of_b;
  return undefined;
}
const principals = new WeakMap<FastifyRequest, IdentityUser>();
const relationships = new WeakMap<FastifyRequest, Relationship>();
const installed = new WeakMap<
  FastifyInstance,
  { options: AuthorizationOptions; router: PolicyRouter }
>();
export function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  const token =
    typeof header === "string" ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header)?.[1] : undefined;
  if (token === undefined) throw new UnauthorizedError();
  return token;
}
export function principal(request: FastifyRequest): IdentityUser {
  const user = principals.get(request);
  if (user === undefined) throw new UnauthorizedError();
  return user;
}
export function authorizedRelationship(request: FastifyRequest): Relationship {
  const row = relationships.get(request);
  if (row === undefined) throw new NotFoundError();
  return row;
}
export type PolicyRoute = Omit<RouteOptions, "config"> & {
  policy: AuthorizationPolicy;
  config?: RouteOptions["config"];
};
export interface PolicyRouter {
  route(options: PolicyRoute): void;
  inventory(): readonly { method: string; url: string; policy: AuthorizationPolicy["kind"] }[];
}
/**
 * Every route registered on this instance since the guard went in, with the
 * policy it declared.
 *
 * The guard already refuses a route with no policy, so this is not how
 * coverage is enforced — it is how coverage is *inspected*, by the test that
 * checks each domain capability reached a route and that nothing became
 * public by accident.
 */
export function routeInventory(
  app: FastifyInstance,
): readonly { method: string; url: string; policy: AuthorizationPolicy["kind"] }[] {
  const entry = installed.get(app);
  if (entry === undefined) throw new Error("Authorization is not installed on this instance");
  return entry.router.inventory();
}

/** Install before routes on the owned HTTP scope. Child plugins inherit the guard. */
export function installAuthorization(
  app: FastifyInstance,
  options: AuthorizationOptions,
): PolicyRouter {
  const existing = installed.get(app);
  if (existing !== undefined) {
    if (existing.options.identity !== options.identity)
      throw new Error("Conflicting identity policy service");
    if (options.db !== undefined) {
      if (existing.options.db !== undefined && existing.options.db !== options.db)
        throw new Error("Conflicting policy database");
      existing.options.db = options.db;
    }
    return existing.router;
  }
  const state = { ...options };
  const inventory: { method: string; url: string; policy: AuthorizationPolicy["kind"] }[] = [];
  app.addHook("onRoute", (route) => {
    const policy = route.config?.authorizationPolicy;
    if (
      policy === undefined ||
      !["public", "signature-verified", "sender", "relationship", "request"].includes(policy.kind)
    )
      throw new Error(`Missing or invalid authorization policy: ${route.url}`);
    if ((policy.kind === "relationship" || policy.kind === "request") && state.db === undefined)
      throw new Error("Relationship policy requires database");
    for (const method of Array.isArray(route.method) ? route.method : [route.method])
      inventory.push({ method, url: route.url, policy: policy.kind });
  });
  // Rate limiting for everything below is the global onRequest hook in
  // hardening.ts, which runs a whole lifecycle phase earlier — before the
  // body is parsed and before authenticate() reaches the database. The
  // ordering is the protection, so it is tested rather than assumed:
  // "spends the budget on an unauthenticated flood without ever reaching
  // the token lookup" in wired-routes.test.ts asserts [401, 401, 429, 429].
  app.addHook("preValidation", async (request, reply) => {
    // A request that matched no route has no policy to read and no handler
    // to protect. Letting it fall through to the not-found handler keeps an
    // unknown path answering 404 instead of 401, which is both what it is
    // and what it was before the guard existed: a 401 here would tell a
    // scanner that every path it guessed needs credentials, which is a
    // longer and more interesting list than the truth.
    if (request.routeOptions.url === undefined) return;
    const policy = request.routeOptions.config.authorizationPolicy;
    if (policy === undefined) throw new UnauthorizedError();
    if (policy.kind === "public" || policy.kind === "signature-verified") return;
    reply.header("cache-control", "no-store");
    const user = await state.identity.authenticate(bearerToken(request));
    principals.set(request, user);
    if (policy.kind === "sender") return;
    const { id } = z.object({ id: z.uuid() }).strict().parse(request.params);
    if (state.db === undefined) throw new UnauthorizedError();
    // Membership is part of the lookup, not a check after it. A query that
    // found the row and then compared ids would still have found the row,
    // and the difference shows up the first time someone edits the compare.
    const members = (eb: ExpressionBuilder<Database, "relationship">) =>
      eb.or([eb("user_a_id", "=", user.id), eb("user_b_id", "=", user.id)]);
    const row =
      policy.kind === "relationship"
        ? await state.db
            .selectFrom("relationship")
            .selectAll()
            .where("id", "=", id)
            .where(members)
            .executeTakeFirst()
        : await state.db
            .selectFrom("relationship")
            .selectAll("relationship")
            .where(members)
            .where((eb) =>
              eb.exists(
                eb
                  .selectFrom("request")
                  .select("request.id")
                  .whereRef("request.relationship_id", "=", "relationship.id")
                  .where("request.id", "=", id),
              ),
            )
            .executeTakeFirst();
    if (row === undefined) throw new NotFoundError();
    const required = policy.role;
    // 404, not 403, and the same 404 a stranger gets. A member asking to do
    // the other side's action learns nothing here that they could not learn
    // from the read route, but keeping one answer means there is no pair of
    // responses to diff — and `relationships.test.ts` already pins the sender
    // being told 404, not 403, when they try to accept their own invitation.
    if (required !== undefined && roleOf(row, user.id) !== required) throw new NotFoundError();
    relationships.set(request, row);
  });
  installHttpIdempotency(app, {
    ...options.httpIdempotency,
    skip: (request) =>
      request.routeOptions.config.authorizationPolicy?.kind === "signature-verified",
    scope: (request) =>
      request.routeOptions.config.authorizationPolicy?.kind === "public" ||
      request.routeOptions.config.authorizationPolicy?.kind === "signature-verified"
        ? "public"
        : principal(request).id,
  });
  const router: PolicyRouter = {
    route({ policy, config, ...route }) {
      app.route({ ...route, config: { ...config, authorizationPolicy: policy } });
    },
    inventory() {
      return inventory.map((entry) => ({ ...entry }));
    },
  };
  installed.set(app, { options: state, router });
  return router;
}
