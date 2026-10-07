# K3.18 — CI claims audit

Audited 2026-10-07 at `7679d9b2e540579651afbf049c61db6635d54687`.
Scope: the two committed workflows, their invoked commands, test discovery,
negative probes, and actual Actions logs. Report only; no checks were fixed.
K2 owns the image/smoke repair. Deployed API exercises remain blocked on image
boot. Later owner fixes must be verified at their own heads.

## Findings and ownership

| ID | Priority | Finding | Owner / disposition |
| --- | --- | --- | --- |
| CI-1 | High | `make verify` discards typecheck and lint exit codes; main is already green with both errors in its log. | K2/platform; notified with reproduction. |
| CI-2 | High | Image smoke succeeds even when neither endpoint responds. Current main's successful job reports readiness `000`. | K2; existing assigned smoke fix, no duplication. |
| CI-3 | Medium | Font-scaling regression test passes when its selector is disabled; it observes a different lint rule. | K2/mobile guardrails. |
| CI-4 | Medium | Two red-team files remain outside root test discovery. | Claude decides gate scope; K2 wires approved cases. |
| CI-5 | Medium | No configured coverage collection or threshold gate exists. | Claude decides whether required; K2 implements. |
| CI-6 | Low | Bundle budget accepts an existing export directory containing no `.js` bundles as zero bytes. | K2/mobile build. |

## Every committed check: claim versus execution

| Workflow/job/step or invoked gate | Name's claim | Actual execution | What can remain broken while it passes |
| --- | --- | --- | --- |
| CI / checkout, pnpm setup, Node setup | Correct repository and toolchain available | Checkout plus pnpm action and `.nvmrc` Node; install is frozen-lockfile | These do not prove product behavior or production runtime resolution. |
| Confirm Docker is available for Testcontainers | Docker is usable | `docker info` | Pulling Postgres, starting a container, migrating, or SQL behavior may still fail; downstream DB tests cover those. |
| Install dependencies | Locked dependencies install | `pnpm install --frozen-lockfile` | Final image uses a separate install/layout; runner resolution does not prove container resolution. |
| make verify | Typecheck, lint/format, and tests pass | `pnpm typecheck & pnpm lint & wait`, then `pnpm test` | Bare `wait` returns success without preserving child failures (CI-1). Tests still gate their own failures. |
| typecheck (inside verify) | Strict TypeScript program compiles | `tsc --noEmit -p tsconfig.json`; includes API/mobile/packages/tests/scripts TS/TSX | Its nonzero status is swallowed by make. JS config and `.mjs` scripts are outside this TS program; types do not verify runtime dependencies. |
| lint (inside verify) | ESLint and formatting pass | `eslint . && prettier --check .` | ESLint failure prevents Prettier from running, and make swallows either failure. Selectors and scope are only as strong as their probes. |
| test (inside verify) | Registered Vitest tests pass | Root `vitest run` projects, not every nested config | Omitted files never execute; `passWithNoTests: true` supplies no minimum discovery count. No coverage enforcement. |
| Bundle-size budget | Android production JS stays within budget | Expo Android export, `--no-bytecode`; sums top-level `.js` in `_expo/static/js/android`, compares to 2,500,000 bytes | Empty bundle set passes. Assets, APK/native code, Hermes bytecode, web build and nested bundles are not measured. This is a JS proxy, not an install-size guarantee. |
| API image build + Postgres smoke test / Build image | Production image builds | Dockerfile multi-stage build and production install | Successful build does not execute the final CMD or resolve its external imports. |
| Start throwaway Postgres | Postgres starts and accepts connections | Detached `postgres:16-alpine`, 30 `pg_isready` attempts | Exhaustion does not fail explicitly: final `sleep` succeeds. Detached startup is not readiness. |
| Start API container | API boots | Detached `docker run` with DATABASE_URL and port | Container ID can be returned before process exits. Neither running state nor Docker HEALTHCHECK status is inspected. |
| Assert /health and /ready | Running image passes liveness and DB readiness | Two curl retry loops, then `echo` commands | Both loops can exhaust successfully; echo masks failed command substitutions (CI-2). HTTP errors and connection refusal can pass. No body validation, curl time limit, migrations, or authenticated-route exercise. |
| Show API logs on failure | Failed boot is diagnosable | `docker logs api-ci` only if the job failed | A falsely green smoke job never emits the failure logs. |
| Cleanup | Containers removed | `docker rm -f api-ci pg-ci || true`, always | Cleanup failures are intentionally tolerated; this is not a behavioral gate. |
| CodeQL / Analyze / Initialize and Perform analysis | CodeQL analysis executes | JS/TS extraction, queries, SARIF upload | Successful analysis is not a proof of no alerts or business correctness. No custom ledger/auth queries or explicit alert-failure step in this workflow. See scan evidence below. |

CI runs on push and pull request, with older runs on the same ref cancelled.
CodeQL runs on PRs targeting main and weekly Monday 07:00 UTC; there is no
push trigger in its committed workflow. Direct pushes therefore have no immediate
CodeQL scan from this workflow. Dependabot configuration creates dependency update
PRs; it is not a source/runtime test or a committed third verification workflow.
Repository-level required-check/alert policies were not independently established
by this audit; no claim that green Analyze bypasses every external merge policy.

## Execution evidence

[Main CI run 37695405443](https://github.com/jabonilla/raices/actions/runs/37695405443)
ran the audited SHA. Both jobs concluded success.

- Verify job `113046056546` contains `TS2554` in
  `tests/redteam/redaction-adversarial.test.ts:45`, and ESLint errors in the newly
  merged suite. They are not hypothetical failures. It then reports **77 test
  files / 1,091 tests passed** and a **1,890,780-byte** bundle. Green does not
  establish typecheck/lint success.
- Docker job `113046056346` ends with empty `health:` and `ready: 000`, yet
  succeeds. `000` is no HTTP response. This verifies the false-green symptom;
  the job omits container logs, so this audit does not independently attribute
  that run's boot failure to a particular missing package. Claude's deployed
  fastify error is his reported incident.
- The image places its bundle at `/app/dist/index.mjs`, while third-party
  dependencies are installed through the API workspace manifest. Bundled
  third-party imports stay external. Runner tests cannot prove that this final
  location can resolve workspace-installed runtime dependencies. K2 owns repair.
- `/ready` checks database connectivity (`apps/api/src/health.ts`); even a
  genuine 200 does not prove application schema migrations or money endpoints
  work. Smoke does not invoke `dist/migrate.mjs` before probing.

## Discovery, database execution, and coverage

`vitest list --json` discovers **77 unique files**. Compared against tracked
`*.test.{ts,tsx,js,jsx,mjs}`, exactly two are omitted:

- `tests/redteam/money-fuzz.test.ts`
- `tests/redteam/redaction-adversarial.test.ts`

The root redteam project explicitly includes only ledger-adversarial and
relationship-race. Its comment describes an intentional rollout of fixed findings;
this is a scope gap, not an instruction to enable still-failing cases. The nested
standalone config includes all four, but CI never calls it. Source-colocated
identity/http tests and the seven guardrail files **are discovered**. The load
harness is not a test suite invoked by either workflow: no CI throughput/latency
claim should be inferred from its presence.

Ledger tests call `startTestPostgres()` in hooks. `tests/pg.ts` starts Postgres 16
via Testcontainers, applies SQL migrations, and throws on startup/migration errors.
No silent database-unavailable skip was found. CI leaves TEST_DATABASE_URL unset.
Actual main logs show ledger-schema (51 tests), ledger-kysely (3), post-concurrency
(8), and both selected red-team files passing. An isolated ledger-kysely run with
no Docker and no TEST_DATABASE_URL exited 1 with container startup error. Vitest
labelled the hook-blocked cases skipped, **but the suite/job failed**; teardown also
reported undefined `pgx`. That is diagnostic noise, not a false green.

No `--coverage`, coverage provider, coverage thresholds, or coverage workflow was
found in committed scripts/config. This is an absent gate, not a threshold proven
to work. Line extraction coverage reported by CodeQL is a different measurement.

## Isolated mutation probes

All mutations were restored; none are included in this branch. Local behavioral
probes used installed dependencies, pnpm 10.33.0 and Node 24 (initial Node 22 copy
was damaged); actual runner evidence above uses the workflow's Node version.
These probes test gate mechanics, not deployed banking behavior.

| Probe | Result | Interpretation |
| --- | --- | --- |
| Unchanged Makefile with PATH stub pnpm exiting 42 for typecheck/lint and 0 for test | `make verify` exits 0 | CI-1 confirmed without changing a test assertion. |
| Unchanged Assert shell block under `bash -eo pipefail`, with stub curl always exiting 22/printing 503 for status and sleep returning 0 | exits 0, `ready: 503` | CI-2 reproduced even with Actions-style fail-fast shell options. |
| Original bundle counting/threshold code; only exporter replaced with synthetic output: 100 bytes / 2,500,001 bytes / empty directory | exits 0 / 1 / 0 | Oversize threshold works; missing output-set assertion (CI-6). Not a real Expo export mutation. |
| Baseline seven guardrail files | 68 tests pass | Controls before disarming checks. |
| Disable float, tier-import, a11y and syntax restrictions in real ESLint config | 37 tests fail, 12 pass | Many regression probes correctly detect removed rules. |
| Disable only allowFontScaling selector; keep hardcoded JSX rule | all 3 a11y guardrail tests still pass | CI-3: fixture is in `apps/mobile/app`, where the later i18n `no-restricted-syntax` replaces the font selector. Its literal `Fixed size` text triggers that unrelated rule; test checks only rule ID. |
| Make multiply rounding argument optional | targeted guardrail fails | Missing rounding diagnostic is correctly required, rather than arbitrary compiler failure. |
| Widen RequestDatabase / ReconciliationDatabase with ledger tables | 4 / 3 negative cases fail | Type boundary guardrails detect widening for the tested operations. |
| Widen IntentState to accept SettlementState | 2 negative cases fail | State separation probe detects this conflation. |
| Remove Docker runtime availability for ledger-kysely | suite exits 1 | DB tests fail closed rather than silently disappear. |

Reproduce CI-1 with a temporary executable named `pnpm` on PATH whose case statement
returns 42 for `typecheck|lint`, 0 otherwise, then run the original `make verify`.
Reproduce CI-2 by extracting the unchanged Assert step and substituting temporary
curl/sleep executables as described above. For CI-3 change only the font-scaling
selector to a nonexistent JSX attribute and run
`pnpm exec vitest run --project guardrails eslint-mobile-a11y`; restore afterward.
Other targeted commands use `--project guardrails` and their existing filename.
Do not publish any disarmed config or modify migration files.

## CodeQL scope and limits

[CodeQL run 37694272201](https://github.com/jabonilla/raices/actions/runs/37694272201),
Analyze job `113041887948`, succeeded on PR head
`a11710071b021a80d3faf48bd5dc2ac3b6e00e14` (a separate revision from audited main).
Logs confirm real extraction and query execution: **193/193 TypeScript files,
2/2 GitHub Actions files, 4/4 HTML files, 4/4 JavaScript files** scanned in that
invocation. There is no evidence of a wholesale skipped JS/TS scan. That summary
is not a file-by-file guarantee for later main changes.

Workflow selects `javascript-typescript`, with no custom paths/config or extended
query suite. Default query behavior is documented in
[GitHub's workflow options](https://docs.github.com/en/enterprise-cloud@latest/code-security/reference/code-scanning/workflow-configuration-options)
and [query suites](https://github.com/github/docs/blob/main/content/code-security/concepts/code-scanning/codeql/codeql-query-suites.md).
Analysis and alert reporting are separate concerns; see
[code scanning alerts](https://docs.github.com/en/code-security/concepts/code-scanning/code-scanning-alerts).
SQL migrations/triggers, Docker packaging correctness, proxy behavior, family
business authorization, ledger balance, and a running deployed image have no
runtime guarantee from this static job. No custom domain queries are configured.
The two previously dismissed alerts were not reclassified by this audit; their
manual review does not expand scan scope.

## Handoff and acceptance

Every committed job and named step is mapped above; root discovery, DB failure
behavior, budget boundaries and guardrail disarming were exercised. CodeQL actual
scan counts were checked against its logs. Confirmed CI-1/CI-2 evidence was emailed
to K2 and Claude immediately. Findings only: owners decide and implement fixes.
Full `make verify` command success must not be represented as independent type/lint
success while CI-1 exists. This report deliberately preserves the broken gates
so its PR cannot itself repair or conceal the findings.
