# Auth deployment contract — #78 follow-up

All three auth routes require a `rateLimitCheck` callback from K2.11's
`registerRateLimit`. It runs in each route's `onRequest`, before parsing the body,
validation, bearer processing or database calls. Persistent phone/IP counters
remain the policy layer. The outer in-memory budget is only a process-local flood
bound, multiplied by replica count. All auth responses, including denial and
rate-limit responses, carry `Cache-Control: no-store`.

In production `registerIdentityRoutes` throws synchronously unless `clientIp` is
provided. This must resolve the actual client using a verified deployment-specific
proxy topology: restrict trusted hops/networks, prevent direct access around the
edge, and confirm which header the edge overwrites. Passing `request.ip` when
Fastify has `trustProxy: true` is NOT sufficient evidence of that trust. Never
split an arbitrary caller-provided forwarded header and call it trusted. Confirm
the Railway configuration with K2 before enabling auth. We do not guess a Railway
CIDR or hop count in this module.

The resolver is evaluated once per request. A request view supplies this same IP
to K2.11's limiter; the cached value is passed to IdentityService. The underlying
request is not mutated. Development/test without a resolver uses the socket IP.

Host integration remains K2-owned. The current K2.11 helper also installs a global
hook, so reusing its callback on the same instance counts twice. That is a tighter
bound, not a bypass, but does not represent the configured request budget. K2 has
been asked for a route-only factory and trusted-key seam; do not deploy with a
broad forwarded-header trust setting or present double counting as verified
production integration. The default app still does not mount the auth routes.

`identity-hardening.test.ts` proves the missing-config guards fail and checks all
three routes with K2.11's actual limiter: forwarded-header rotation does not alter
the vetted bucket, and exhausted requests never call IdentityService. Service
spies in that test are only evidence of early rejection, not database behavior.
