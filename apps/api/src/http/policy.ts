import type { FastifyInstance, FastifyRequest, RouteOptions } from "fastify";
import type { Kysely, Selectable } from "kysely";
import { z } from "zod";
import type { Database } from "../db/schema.js";
import type { IdentityService, IdentityUser } from "../identity/service.js";
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
  | { readonly kind: "relationship"; readonly recipientOnly?: boolean };
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
      !["public", "signature-verified", "sender", "relationship"].includes(policy.kind)
    )
      throw new Error(`Missing or invalid authorization policy: ${route.url}`);
    if (policy.kind === "relationship" && state.db === undefined)
      throw new Error("Relationship policy requires database");
    for (const method of Array.isArray(route.method) ? route.method : [route.method])
      inventory.push({ method, url: route.url, policy: policy.kind });
  });
  app.addHook("preValidation", async (request, reply) => {
    const policy = request.routeOptions.config.authorizationPolicy;
    if (policy === undefined) throw new UnauthorizedError();
    if (policy.kind === "public" || policy.kind === "signature-verified") return;
    reply.header("cache-control", "no-store");
    const user = await state.identity.authenticate(bearerToken(request));
    principals.set(request, user);
    if (policy.kind === "sender") return;
    const { id } = z.object({ id: z.uuid() }).strict().parse(request.params);
    if (state.db === undefined) throw new UnauthorizedError();
    const row = await state.db
      .selectFrom("relationship")
      .selectAll()
      .where("id", "=", id)
      .where((eb) => eb.or([eb("user_a_id", "=", user.id), eb("user_b_id", "=", user.id)]))
      .executeTakeFirst();
    if (row === undefined) throw new NotFoundError();
    if (
      policy.recipientOnly === true &&
      !(
        (row.user_a_id === user.id && row.role_of_a === "recipient") ||
        (row.user_b_id === user.id && row.role_of_b === "recipient")
      )
    )
      throw new NotFoundError();
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
