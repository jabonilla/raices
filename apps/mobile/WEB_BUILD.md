# Web Build (K2.42, k2/web-live)

Expo web build of the Raíces mobile app, deployable as static files. The demo is a link, not a simulator.

## Live demo

Published to GitHub Pages via the `Web demo` workflow (manual dispatch):
**https://jabonilla.github.io/raices/**

The Pages build sets:

- `EXPO_PUBLIC_DATA_PROVIDER=real`
- `EXPO_PUBLIC_API_URL=https://api-production-9b18.up.railway.app`

## What "real" means in this build (honest status)

The deployed API exposes `/health`, `/ready`, `/openapi.json`, and
`/webhooks/channel` — it has **no screen-data endpoints**. So:

- **Real:** the build is configured with `EXPO_PUBLIC_DATA_PROVIDER=real`
  and `EXPO_PUBLIC_API_URL=https://api-production-9b18.up.railway.app`.
- **Demo data:** screen content comes from the fixture dataset, and every
  screen carries the banner "MODO DEMO · Datos de prueba · Sin dinero real".
  No one seeing this demo can mistake it for real money.
- **No live API status dot (CORB limitation, verified 2026-10-08):** a
  reachability probe was tried and removed. Chrome's CORB blocks
  cross-origin `no-cors` fetches of the API's JSON responses, so the probe
  always reported "unreachable" with the API up — a wrong red dot is worse
  than no dot. When K3 adds
  `Access-Control-Allow-Origin: https://jabonilla.github.io` to `/health`
  and `/ready`, a real probe can return (see git history for
  `src/data/apiHealth.ts`) with a normal fetch that reads status codes.

When K3 ships screen endpoints, `src/data/realProvider.ts` gets fetch + map
implementations; the demo banner stays until the data is real.

## Build

```bash
cd apps/mobile
pnpm web:build
```

Output: `apps/mobile/dist-web/` — static files ready for any static host.

Pages serves the project site from `/raices/`, so `app.json` sets
`"experiments": { "baseUrl": "/raices" }` — without it, Expo's absolute
`/_expo/...` asset URLs 404 and the page is blank.

## Serve locally

```bash
cd apps/mobile
pnpm web:serve
```

Opens at `http://localhost:3000`. Test on a phone browser by opening the machine's LAN IP.

## Phone browser support

The build uses responsive viewport meta tags (Expo default). The app layout adapts to small screens — tested at 390×844 (iPhone 14).

Touch targets meet the 44pt minimum (DS §13). No hover-dependent interactions.

## Secrets

**No secrets in the bundle.** Verified on every Pages build by the
`web-demo.yml` workflow (grep for secret-like strings fails the build):

- `EXPO_PUBLIC_*` vars are build-time only; unset vars are empty strings, not secrets
- No `sk_live`, `pk_live`, or `secret` strings in the JS bundle
- API base URL (`EXPO_PUBLIC_API_URL`) is public by design — it's the API endpoint, not a credential
- Auth tokens are runtime-only (phone-OTP flow), never bundled

Per the standing rule: production credentials go into Railway/Supabase env config, never into a commit, fixture, email, or PR description.

## Demo mode

The web build uses the fixture provider by default (`EXPO_PUBLIC_DATA_PROVIDER` unset). For the live demo with the real API:

```bash
EXPO_PUBLIC_DATA_PROVIDER=real \
EXPO_PUBLIC_API_URL=https://api-production-9b18.up.railway.app \
pnpm web:build
```

**Fake money, real logic.** Nothing in the demo touches a real payment rail.
