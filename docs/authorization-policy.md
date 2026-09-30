# K3.10 — declared authorization policies

Every route in the owned HTTP scope registers through `PolicyRouter.route` with
an explicit policy: public, authenticated sender, or relationship membership.
Acceptance additionally declares recipient-only membership. Authentication,
family membership and acceptance-role checks execute centrally before handlers.
No handler can obtain a principal/relationship without a successful policy check.

The TypeScript route shape requires a policy. An `onRoute` guard rejects ordinary
Fastify registration without one, including inherited child routes and generated
HEAD routes. `inventory()` exposes the effective declarations for tests/review.
Existing family-isolation and credential tests remain unchanged.

Install `installAuthorization` BEFORE registration on a fresh Fastify scope.
`registerIdentityRoutes` and `registerRelationshipRoutes` install/reuse it on their
shared scope. The limiter still runs first in onRequest, before authentication.

Host integration is pending K2: main's buildApp, health/ready/OpenAPI and webhook
routes are outside K3 ownership and were registered without this policy module.
Installing a hook later cannot retroactively validate earlier registrations.
K2 must install the guard before all host routes and declare their policies;
we do not claim whole-server coverage until that work and its inventory test land.

Validation this turn: missing-policy/child-plugin and implicit HEAD denial tests
passed; existing database-backed family-isolation tests still require execution
in a Docker or non-root Postgres 16 environment. No production merge is authorized.
