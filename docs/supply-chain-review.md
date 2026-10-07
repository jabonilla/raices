# K3.9: dependency and supply-chain review

Main `04b64f6`, 2026-09-29. Review only: no manifests, lockfile, CI workflow or dependency version is modified. Inspected root/seven workspace manifests, lockfile, pnpm policy, workflows, installed transitive call sites, and current registry advisories. Ran local export and checks; did not inspect private repository/deployment secret settings or exercise a compromised package.

## Dependency graph and trust boundaries

The lockfile has 1,063 package records and 1,063 snapshots, matching the registry audit's total graph count. These are lock records, not a claim of 1,063 unique publisher identities. Source packages money/channels/templates/settlement have no declared third-party runtime dependencies. API imports Fastify/Pino, Kysely/pg, Zod and the OpenAPI generator; mobile imports Expo/router/React Native plus their extensive tooling graph. Root dev tooling includes ESLint, TypeScript, Vitest/Vite, tsx/esbuild, jsdom, Testcontainers and fast-check.

| Compromised component | What it could reach in this project | Concrete tightening |
|---|---|---|
| API runtime dependency | Process environment (DB/provider/OTP secret when configured), pooled DB role, request phones/codes/tokens, outgoing network, log exporters | Minimize runtime graph and privileges; deploy the constrained app DB role separately from migration owner; restrict secret scope and egress where feasible; review lockfile provenance and runtime call sites |
| Expo/router/native/build plugin | App source/assets/config; build environment; signing/deploy tokens if co-located; shipped JS/native code | Build with no production privileged secrets; isolate signing/deploy job behind reviewed environment approval; audit native/config plugins and what is bundled |
| Test/bundler/linter dependency or repo script | Full CI checkout, runner env/files, network, and Docker socket used by Testcontainers | Treat test/install/build execution as arbitrary code; don't expose production secrets to verification; separate privileged release work and runner state |
| GitHub action referenced by movable tag | Same workflow job/files/env/token exposure; can change without a repo diff | Pin reviewed full commit SHA, retain version in a comment, review automated SHA updates |
| Malicious lockfile/manifests | New execution/dependency entry points and registry/tarball integrity metadata | Required owner review for manifests/lock/workflows, dependency diff and advisory gates, frozen installs, explicit release-age/provenance policies |

No production secret reference is present in the checked-in CI workflow. This does not prove there are no configured secrets or broad token defaults at the account level. A compromised API runtime can access credentials even when it has no lifecycle install script.

## Current advisory results

`pnpm@10.33.0 audit --json` exited 1 and reported **two moderate**, zero high/critical advisories. Machine-readable summary is in `docs/supply-chain/registry-audit-2026-09-29.json`.

| Locked path | Advisory and observed reachability | Recommended owner action |
|---|---|---|
| mobile → expo → @expo/config-plugins → xcode → uuid 7.0.3 | [GHSA-w5hq-g745-h8pq](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq): missing bounds checks in v3/v5/v6 buffer APIs. Installed xcode pbxProject.generateUuid calls uuid.v4() without an output buffer, which is outside those affected methods. Build dependency remains advisory-listed; no exploited identifier corruption demonstrated. | K2: pursue compatible upstream update and verify Xcode/config generation. Do not force a cross-major uuid override without compatibility tests. |
| mobile → expo-router → query-string → decode-uri-component 0.2.2 | [GHSA-vcc3-ghjq-m6fr](https://github.com/SamVerschueren/decode-uri-component/security/advisories/GHSA-vcc3-ghjq-m6fr): malformed percent-encoded input can cause excessive CPU work; maintainer identifies 0.5.0+ as patched. Installed Expo router path/state modules import query-string, so inbound URL/deep-link parsing is a plausible reachability seam. No device DoS was exercised. | K2: prioritize compatible router/query-string update or carefully tested transitive remediation and bound deep-link/query input size. Test malformed links and URI error handling. |

Registry and maintainer affected-version wording differs around decode-uri-component 0.4.2; the locked 0.2.2 is affected under both, so the disagreement does not change this finding. An audit match alone is not proof of application exploitability, and the graph scan is not a malware or zero-day detector.

## Current controls and gaps

- Node 22 and pnpm 10.33.0 are declared; frozen lockfile install is in CI. Reproduce the pinned manager/runtime. A first local attempt under ambient pnpm 11 rejected six freshly published Expo-related records under its release-age policy; the repo-pinned pnpm 10 install succeeded. This demonstrates a policy/version difference, not an exception silently configured in this repo. Adopt an explicit reviewed minimumReleaseAge for the pinned pnpm version and documented exceptions, rather than relying on ambient-manager defaults.
- `onlyBuiltDependencies: [esbuild]` restricts dependency install scripts. Keep this narrow and review expansion. It does **not** restrict code executed when a test, CLI, loader or bundler imports a package. [pnpm v10 settings](https://github.com/pnpm/pnpm.io/blob/main/versioned_docs/version-10.x/settings.md) document these distinct controls.
- `ci.yml` does not declare `permissions`; effective token default is not verified. Set top-level `contents: read` and explicit minimal job permissions; disable persistence of checkout credentials unless later steps need authenticated Git. Verify this against the actual action version rather than assuming credential-file placement.
- Checkout/setup-node/pnpm setup/CodeQL use version tags. Pin verified full action SHAs; GitHub's [secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use) recommends immutable pins and minimal token permissions.
- CodeQL has explicit contents/actions read and security-events write, but that upload permission lives in the analysis job. Review isolation from tests/build and maintain fork-PR protections. Workflows use push/pull_request/schedule, not pull_request_target; preserve the absence of a privileged untrusted-code checkout pattern.
- Testcontainers needs Docker; the CI job deliberately checks Docker availability. Docker socket exposure expands what compromised test code can do to the runner. Keep verification on disposable runners and secrets out of this job; do not share it with signing/deploy credentials.
- Dependabot groups all minor/patch updates weekly and actions monthly. Review sensitive auth/DB/parser/build updates individually when useful; a large all-packages group can obscure security-relevant changes. Add advisory/reachability triage and regression checks, not blind auto-merge.
- No explicit package provenance/trust gate or registry allow-list appears in the checked-in pnpm policy. Evaluate support for the pinned version before changing policy, include integrity verification and approved registry/tarball sources, and record exceptions.
- Existing `make verify` does not discover tests/redteam or production tests under identity/http. CI completeness is part of supply-chain defense: a green run cannot protect a suite it never runs. K2 integration is already requested.

## Prioritized follow-up

1. K2 fixes/triages the router decoding advisory, integrates new security suites and explicitly narrows CI token permissions/action pins.
2. K0 approves the identity/HTTP production review and durable receipt/recovery seam; no authentication code is self-merged.
3. K2 adopts an explicit pnpm release-age/trust policy and keeps lifecycle allow-list minimal; regenerate the lockfile with the pinned manager, never hand-edit.
4. Separate release signing/deploy work from untrusted verification; use narrowly scoped short-lived credentials/approved environments when adding deploy automation. Confirm actual settings with the account owner.
5. Repeat registry advisory checks on reviewed lockfile changes and periodically. Record reachability and fixes honestly; do not use a zero-advisory result as a guarantee.

The two advisory exposures, action-tag mutability and absent CI permission declaration are recommendations/findings for owners. No dependency is upgraded or service introduced without their review, and no guessed production-secret access is described as verified.

## Updated main inspection: c778cfd

The added Docker build uses mutable `node:22-slim` and `postgres:16-alpine` tags; pin reviewed digests for reproducibility. The final API image runs as a dedicated nonroot user, a positive boundary. The CI smoke job uses synthetic PostgreSQL credentials. Its readiness loops can exhaust without exiting nonzero, and the final curl output is wrapped in echo rather than asserting status 200. Code inspection therefore identifies a possible false-green smoke check; K2 should make exhaustion and final status failures explicit. Docker is unavailable in this execution environment, so no image-build or container-health success is claimed. The API build can be checked locally. New build/deploy scripts do not change the two dependency advisory findings above.
