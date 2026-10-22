import { readFile } from "node:fs/promises";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp, HOST_ROUTE_POLICIES } from "../app.js";
import type { Database } from "../db/schema.js";
import { IdentityService } from "../identity/service.js";
import { startTestPostgres, type TestPostgres } from "../../../../tests/pg.js";
import { buildHttpOpenApiDocument } from "./document.js";
import { PostgresReceiptStore } from "./idempotency.js";
import { InviteLimiter } from "./invite-limit.js";
import { routeInventory } from "./policy.js";

/**
 * Does every domain capability have a way in?
 *
 * Issue #136 existed because the answer was no and nothing said so: identity,
 * relationships and requests were written, tested and unreachable, and the
 * test suite was green the whole time. A green suite that proves the domain
 * works is exactly the suite that will not notice the domain is unreachable,
 * because every one of its tests calls the functions directly.
 *
 * So this file does not call them. It reads the domain modules as text, takes
 * every capability they export, and insists each one is either bound to a
 * registered route or listed below with a reason it is not. Adding an
 * exported function to a domain module and not deciding which it is fails
 * here, which is the only way "we built it and forgot to wire it" stops being
 * a thing that can happen quietly.
 */

/** Source files whose exports are the domain's capabilities. */
const DOMAIN_MODULES = [
  "relationships/relationships.ts",
  "relationships/users.ts",
  "requests/requests.ts",
] as const;

/**
 * What each capability is bound to.
 *
 * A string is the route that exposes it. An object is a decision not to
 * expose it, and the reason is part of the record: an exemption without one
 * is indistinguishable from an oversight, which is how #136 happened.
 */
type Binding = string | { readonly exempt: string };

const BINDINGS: Readonly<Record<string, Binding>> = {
  // --- relationships ----------------------------------------------------
  "relationships/relationships.ts:invite": "POST /relationships/invite",
  "relationships/relationships.ts:activate": "POST /relationships/:id/accept",
  "relationships/relationships.ts:pause": "POST /relationships/:id/pause",
  "relationships/relationships.ts:resume": "POST /relationships/:id/resume",
  "relationships/relationships.ts:terminate": "POST /relationships/:id/terminate",
  "relationships/relationships.ts:resendInvitation": "POST /relationships/:id/resend-invitation",
  "relationships/relationships.ts:invitationExpiresAt": {
    exempt:
      "Pure date arithmetic over invited_at. It has no actor and nothing to " +
      "authorize; callers that need the deadline read it off the relationship.",
  },
  "relationships/relationships.ts:isInvitationExpired": {
    exempt:
      "A predicate the invite flow consults. Exposing it would be a route " +
      "whose whole output is derivable from GET /relationships/:id.",
  },
  "relationships/users.ts:findOrCreateUserByPhone": {
    exempt:
      "Deliberately not reachable. A route that turns a phone number into a " +
      "user row is a phone-number oracle: a caller could learn who is " +
      "registered, and create rows for people who never asked. It is called " +
      "only from inside the invite handler, for the phone the sender typed.",
  },

  // --- requests ---------------------------------------------------------
  "requests/requests.ts:submitRequest": "POST /relationships/:id/requests",
  "requests/requests.ts:readRequest": "GET /requests/:id",
  "requests/requests.ts:approveRequest": "POST /requests/:id/approve",
  "requests/requests.ts:declineRequest": "POST /requests/:id/decline",
  "requests/requests.ts:expireRequest": {
    exempt:
      "Expiry is the system's, not a person's: ExpireRequestInput has no " +
      "actor, and the audit row records no one. A route would require " +
      "inventing a human who decided it, and the thing a sender would use " +
      "one for — refusing a request — is decline, which records a reason.",
  },
  "requests/requests.ts:planVersionInForce": {
    exempt:
      "A read helper the classifier needs. Plan routes are K-owned and not " +
      "part of this ticket; when they land this becomes their business, not " +
      "a capability of the request module.",
  },
};

/**
 * Public methods of IdentityService, which is a class rather than a module of
 * functions and so is scanned separately.
 */
const IDENTITY_BINDINGS: Readonly<Record<string, Binding>> = {
  requestCode: "POST /auth/otp/request",
  verifyCode: "POST /auth/otp/verify",
  revoke: "POST /auth/session/revoke",
  authenticate: {
    exempt:
      "This is what every authenticated route runs before its handler. It is " +
      "the mechanism, not something to expose.",
  },
  tokenHash: {
    exempt: "A hashing helper. A route for it would be a hashing oracle.",
  },
};

const src = (file: string) => new URL(`../${file}`, import.meta.url);

async function exportedFunctions(file: string): Promise<string[]> {
  const text = await readFile(src(file), "utf8");
  return [...text.matchAll(/^export (?:async )?function (\w+)/gmu)].map((m) => m[1] as string);
}

async function identityMethods(): Promise<string[]> {
  const text = await readFile(src("identity/service.ts"), "utf8");
  const body = text.slice(text.indexOf("export class IdentityService"));
  return [...body.matchAll(/^ {2}(private )?(?:async )?(\w+)\(/gmu)]
    .filter(([, isPrivate, name]) => isPrivate === undefined && name !== "constructor")
    .map(([, , name]) => name as string);
}

let server: TestPostgres;
let db: Kysely<Database>;
let app: ReturnType<typeof buildApp>;
let routes: Set<string>;

beforeAll(async () => {
  server = await startTestPostgres();
  db = server.kysely<Database>();
  const identity = new IdentityService(db, {
    pepper: "coverage-test-identity-pepper-32-bytes-min",
    deliver: () => Promise.resolve(),
  });
  app = buildApp({
    api: {
      db,
      identity,
      receipts: new PostgresReceiptStore(db, "coverage-test-receipt-pepper-32-bytes-min"),
      inviteLimiter: new InviteLimiter(db, "coverage-test-invite-pepper-32-bytes-min"),
    },
  });
  await app.ready();
  routes = new Set(routeInventory(app).map((entry) => `${entry.method} ${entry.url}`));
}, 120_000);

afterAll(async () => {
  await app.close();
  await server.stop();
});

describe("every domain capability is reachable", () => {
  it("binds each exported domain function to a route or an explicit exemption", async () => {
    const unbound: string[] = [];
    for (const module of DOMAIN_MODULES)
      for (const name of await exportedFunctions(module)) {
        const binding = BINDINGS[`${module}:${name}`];
        if (binding === undefined) unbound.push(`${module}:${name}`);
      }
    expect(
      unbound,
      "These domain capabilities have no route and no stated reason to lack one. " +
        'Add the route, or add an { exempt: "..." } entry to BINDINGS saying why not.',
    ).toEqual([]);
  });

  it("binds each public IdentityService method to a route or an explicit exemption", async () => {
    const unbound = (await identityMethods()).filter(
      (name) => IDENTITY_BINDINGS[name] === undefined,
    );
    expect(unbound).toEqual([]);
  });

  it("registers every route a binding names", () => {
    const missing = Object.entries({ ...BINDINGS, ...IDENTITY_BINDINGS })
      .filter(([, binding]) => typeof binding === "string")
      .map(([capability, binding]) => [capability, binding as string] as const)
      .filter(([, route]) => !routes.has(route));
    expect(
      missing,
      "A capability claims a route that buildApp does not register. Either the " +
        "route was dropped or the binding is wrong — the point of this test is " +
        "that the claim cannot be the only thing that is true.",
    ).toEqual([]);
  });

  it("keeps no binding for a capability that no longer exists", async () => {
    const live = new Set<string>();
    for (const module of DOMAIN_MODULES)
      for (const name of await exportedFunctions(module)) live.add(`${module}:${name}`);
    const stale = Object.keys(BINDINGS).filter((key) => !live.has(key));
    expect(stale, "An exemption outlives its function and turns into folklore. Delete it.").toEqual(
      [],
    );
  });
});

describe("the wired routes are described and policed", () => {
  it("names every registered route in the generated OpenAPI document", () => {
    const document = buildHttpOpenApiDocument();
    const described = new Set<string>();
    for (const [path, operations] of Object.entries(document.paths))
      for (const method of Object.keys(operations as Record<string, unknown>))
        // OpenAPI writes {id}; Fastify writes :id. Same route.
        described.add(`${method.toUpperCase()} ${path.replace(/\{(\w+)\}/gu, ":$1")}`);
    const contract = [...routes].filter(
      (route) =>
        // Fastify derives a HEAD from every GET. OpenAPI does not describe
        // HEAD separately and neither does this.
        !route.startsWith("HEAD ") &&
        // The staging-only IP diagnostic is absent from a production
        // instance entirely, so it is not part of the published contract.
        !route.includes("/__diagnostics/") &&
        // The webhook is the provider calling us, not a client calling the
        // API. Its request shape is the provider's contract, published by
        // them; describing it here would claim an authority we do not have.
        route !== "POST /webhooks/channel",
    );
    expect(contract.filter((route) => !described.has(route))).toEqual([]);
  });

  it("gives every registered route a policy, and makes nothing public by accident", () => {
    const publicRoutes = routeInventory(app)
      .filter((entry) => entry.policy === "public" && entry.method !== "HEAD")
      .map((entry) => `${entry.method} ${entry.url}`)
      .sort();
    // Exactly the host routes declared public in app.ts, plus the two
    // unauthenticated steps of logging in. Anything else arriving in this
    // list is a route someone made reachable without credentials.
    expect(publicRoutes).toEqual(
      [
        ...Object.keys(HOST_ROUTE_POLICIES).filter(
          (route) => HOST_ROUTE_POLICIES[route as keyof typeof HOST_ROUTE_POLICIES] === "public",
        ),
        "POST /auth/otp/request",
        "POST /auth/otp/verify",
      ]
        .filter((route) => !route.includes("/__diagnostics/"))
        .sort(),
    );
  });

  it("puts every relationship and request write behind a membership policy", () => {
    const unguarded = routeInventory(app).filter(
      (entry) =>
        /^\/(relationships|requests)\b/u.test(entry.url) &&
        entry.policy !== "relationship" &&
        entry.policy !== "request" &&
        // These two are scoped by the principal rather than by a path id,
        // because there is no id yet: one lists the caller's own
        // relationships, the other creates one. A membership policy has
        // nothing to look up in either case.
        entry.url !== "/relationships" &&
        entry.url !== "/relationships/invite",
    );
    expect(unguarded).toEqual([]);
  });
});
