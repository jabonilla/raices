# K3.19 — CI repair re-verification (in progress)

Pre-merge evidence as of 2026-10-08 UTC. Final signoff remains pending owner
repairs and a rerun after they land. Merge freeze respected. No checks fixed here.

## Revisions examined

- Claude #121: `e47c161de261565fd504cbd62d7857389eca1c67`.
- K2 #119 initial probe: `f5384e53b0050373d8768980cf8feaf4b7f7a7b3`.
- K2 #119 latest probe: `a1bf06e13c8757df69563a7022782b55d47d688c`.

These are revision-specific results, not a blanket endorsement of subsequent
commits. K2's combined runtime/smoke PR is not assumed to be the final CI-2 repair.

## CI-1: failure propagation confirmed before merge

The unchanged #121 Makefile runs typecheck, lint and tests serially. A temporary
PATH wrapper named `pnpm` made each command return a controlled status:

| Controlled failure | make exit | Observed execution |
| --- | --- | --- |
| None | 0 | All three commands run |
| Typecheck returns 42 | 2 | Stops before lint/test |
| Lint returns 42 | 2 | Typecheck then lint; no tests |
| Tests return 42 | 2 | Stops at test command |

A second wrapper used the real installed TypeScript compiler for `typecheck`,
with lint/test returning zero. An isolated valid `number = 1` fixture passed;
changing it to `number = "broken"` emitted TS2322 and made `make verify` exit 2.
This control separates propagation from the already-broken repository baseline.
It does not claim a new deliberate-error commit was submitted to hosted CI.

Hosted CI independently confirms the real inherited type error now stops make:
[run 37710000439](https://github.com/jabonilla/raices/actions/runs/37710000439),
job `113093440437`, reports TS2554 and exits 2 at Makefile line 12.

Direct local compiler and ESLint runs confirm the errors exist independently of
the make change (Node 24; hosted CI uses its configured Node version):

- `tests/redteam/redaction-adversarial.test.ts:45`: TS2554, two arguments passed
  to `span.setStatus`, whose current telemetry signature accepts only the code.
  It is a stale red-team probe against the privacy-hardened API.
- `scripts/migrate.test.ts`: five `no-confusing-void-expression` errors at lines
  10, 16, 22, 28, 34 and four deprecated `toThrowError` errors at 10, 16, 22, 28.

Typecheck exits 2; ESLint exits 1. #121 changes only Makefile. These match the
previous false-green main logs. The default local pnpm 11 bootstrap initially
failed on build-policy checks; that failure was discarded as evidence. Its
workspace edit was restored, and direct compiler/linter results above were used.

## CI-2: latest failure probes and remaining gap

Executed extracted workflow shell blocks under `bash -eo pipefail`. Temporary
sleep wrappers shorten delays. Dead HTTP probes invoke real curl against closed
localhost port 1; the other endpoint is controlled so each failure is isolated.
Docker responses are controlled for shell-exit tests; these are not actual
container/migration execution claims.

| Probe | Initial #119 | Latest #119 |
| --- | --- | --- |
| Health never answers | exit 1 | exit 1 |
| Ready never answers; health succeeds | exit 1 | exit 1 |
| Both endpoint success controls | exit 0 | exit 0 |
| Detached Postgres starts, every pg_isready fails | **exit 0** | exit 1 |
| First migration fails all three attempts | Not exercised | exit 1 |
| Second migration fails all three attempts | Not exercised | exit 1 |
| Both migration commands succeed | Not exercised | exit 0 |

Latest head removes the trailing curl-in-echo diagnostics that masked failures.

**Remaining mismatch:** the latest step claims both endpoints must return 200,
but `curl -sf` accepts other successful/redirect status codes. A real local Python
HTTP server, real curl, and the unchanged assertion shell (only URL/port replaced)
produced:

| Server response for both paths | Step exit |
| --- | --- |
| 200 | 0 |
| 204 | 0 |
| 302 | 0 |
| 503 | 1 |

The exact-200 contract is therefore not yet enforced. Neither curl invocation
has a connect or total timeout; the 30-attempt count does not itself bound elapsed
time for an unresponsive request. The latter is source inspection, not a hung
request experiment.

Reproduce with `http.server.HTTPServer` bound to an ephemeral localhost port and
`BaseHTTPRequestHandler.do_GET` sending each status in turn. Extract the Assert
step from the audited Git revision, replace localhost:3000 with that port, use
real curl and a no-op sleep, and record the bash exit status. Do not publish the
injected endpoints or disarmed controls.

## Handoff and remaining work

Both owners received the exact revision, failure matrix, inherited error inventory,
and real HTTP 204/302 reproduction by email. No code/migration/production changes
were made. This document records progress; it is not a final verification approval.

Pending: final CI-2 revision, exact contract resolution, hosted deliberate-failure
proof from the repair owner, and re-verification against landed #121/CI-2 revisions.
Full repository verification remains blocked by the real baseline failures, to be
routed by Claude. No new PR is opened while that gate is unresolved.
