# K3.8: secrets and observability audit

Examined main `04b64f6`, 2026-09-29; additionally reviewed the unmerged K3 identity/HTTP implementation. Report only: no platform/mobile production fix. No real credential or customer data was used in probes. No deployed server, secret store or production APK was inspected.

## Exercised exposure paths

| Path | Evidence and implication | Recommendation / owner |
|---|---|---|
| app.ts genReqId accepts nonempty x-request-id unchanged → Pino reqId/requestId bindings → telemetry request.id | Injected a synthetic phone sentinel in the header. It appeared in JSON logs and the captured span attribute. Request ID keys are not sensitive-key deny-list entries, and child logger bindings are a separate path. | Generate correlation UUIDs server-side or validate against a narrow bounded opaque-ID grammar; review bindings independently of formatters. K2 |
| Fastify default incoming-request log serializes raw URL | Synthetic query token in `/health?token=...` appeared in request logs. Route-pattern spans did not include it. Future signed URLs/tokens/phone query inputs can therefore leak into a log sink even when handlers never log them. | Serialize only the route pattern and vetted query metadata; never bearer credentials in URLs. K2 |
| telemetry.ts SpanImpl.setStatus accepts free-text message | K3.1 exporter capture preserved synthetic phone/name/amount in status.message. Current production callers use no message; unsafe helper, not a claimed current handler exploit. | Fixed safe status vocabulary or omit free-text message. K2 |

These findings were emailed immediately to K0. Public disclosure/push of detailed findings remains blocked pending Jose's explicit approval.

## Other surfaces inspected

| Surface | Current behavior / risk | Evidence class |
|---|---|---|
| logging.ts | Plain nested deny-listed phone/name/amount keys are recursively censored. Arbitrary strings, unrecognized spellings and non-plain objects are outside that protection. auth code/token/password/authorization are not in the deny-list. | Code inspection; nested plain-object protection exercised in K3.1 |
| app.ts error handler / index.ts startup failure | Generic 5xx client envelopes are safe, but full original error is logged. Error message/stack/custom fields can hold PII, driver detail, provider URL or credential. Startup also logs original error. | Code inspection; not every serializer/driver failure exercised |
| errors.ts | ApiError messages and arbitrary duck-typed 4xx error messages reach the client. Safe only if callers construct safe messages; 5xx/Zod/retry-exhaustion use generic envelopes. | Code inspection |
| /ready and DB helpers | Readiness returns only `ok`; createPool receives server DATABASE_URL. No intentional connection-string logging in these helpers. Driver errors remain a logging concern elsewhere. | Existing tests plus inspection |
| scripts/migrate.ts, seed.ts, db-guard.ts | Success logs contain migration names/counts. Uncaught error/cause printing can expose nested driver detail; DB guard deliberately omits raw connection string but displays database name. | Inspection; no production migration run |
| telemetry console exporter | Dev defaults to console; arbitrary status messages and innocent-key sensitive values survive. BigInt is replaced, which does not protect amounts supplied as text. | Inspection and exporter probes |
| Provider/channel mocks | Fake provider state and payloads are held for tests. Replacing these with production adapters must not introduce raw payload/error/token logging or persist privileged fixtures. | Inspection, not real-provider testing |
| K3 unmerged identity | Pepper is server-injected; code is HMAC-bound to challenge UUID; token is hashed at rest. Delivery callback necessarily receives plaintext OTP but errors are swallowed into a safe audited delivery-failure result. No raw OTP/token log/span call exists. | Inspection + real-DB/HTTP regression tests, not independent review |
| Mobile source | Fixture provider contains synthetic names/phones/financial displays; realProvider is a throwing stub. No implemented real auth persistence or server credential configuration found in app source. Secure session storage must be added by mobile owner before live auth. | Inspection |

## What the Android bundle exposes

Exported current mobile source with the installed Expo CLI using production minified JS (`--platform android --no-bytecode`, 2 workers). Ambient client-variable and dotenv embedding were explicitly disabled for this local audit. Produced one **1,888,897-byte** JS bundle (below the existing 2,500,000-byte budget). This is a JS export, not a deployed APK or a Hermes/native reverse-engineering exercise.

Inspection found the synthetic fixture phone and greeting name strings, UI/copy resources and an `EXPO_PUBLIC_` reference from bundled code. That reference does not establish any embedded secret value. No recognizable GitHub-token or private-key literal matched the bundle pattern scan. Device owners can inspect shipped JS/assets, strings, route/client configuration and embedded public env values; minification cannot make a privileged credential safe. Do not place DB credentials, OTP pepper, settlement signing keys, service-role keys or CI tokens in any mobile configuration. Expo explicitly warns that EXPO_PUBLIC variables are visible in plain text in the compiled app ([official documentation](https://docs.expo.dev/guides/environment-variables/)).

Local scan is reproducible but incomplete: no production EAS environment, actual device storage, push-token registration, crash reporter, distributed tracing collector or published source-map permissions were inspected. The production build may embed a different environment.

## Repository/history pattern scan

Scanned 179 tracked files at baseline and diffs across 94 reachable commits (including local review branches). Searched recognizable private-key blocks, GitHub token prefixes, AWS access-key prefixes and JWT-shaped literals. No matches were found. This is a limited pattern scan, **not proof that no secret exists**: passwords, vendor-specific credentials, high-entropy arbitrary strings, ignored files, inaccessible refs and external CI/deploy secret settings are not covered. No secrets were printed or copied into this report.

`.gitignore` ignores `.env` but does not broadly ignore `.env.*`; future `.env.local` or `.env.production` could accidentally become tracked. Keep a deliberately tracked placeholder example while ignoring credential-bearing env variants. Protect push-time secrets, enable repository secret scanning/push protection if supported, and require review for changes to log serializers/exporters and mobile environment wiring.

## Required owner follow-up

K2: sanitize correlation IDs and raw URLs; audit Error and binding serializers; keep mobile auth credentials in platform secure storage and out of diagnostics/backups where feasible. K0: review incident log-retention and disclosure policy, server secret rotation, least-privilege deployed DB user and identity-pepper provisioning. No existing credential compromise is asserted, and no rotation/deletion was performed based on hypothetical exposure.

## Updated main inspection: c778cfd

The subsequent main update adds an environment reader, webhook skeleton, build script, Dockerfile and demo script. Source inspection found only synthetic development database credentials and the deliberately public `test-signature` fixture, not newly committed production credentials. The webhook defaults to the fake verifier even in production; replace it and verify original bytes before deployment. Invalid PORT values are interpolated into startup errors, reinforcing the need to avoid arbitrary configuration values in logs. Existing request-ID/query log leaks remain present. This addendum is source inspection, not a deployed environment or container audit.
