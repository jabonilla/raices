# Web Build (K2.42)

Expo web build of the Raíces mobile app, deployable as static files. The demo is a link, not a simulator.

## Build

```bash
cd apps/mobile
pnpm web:build
```

Output: `apps/mobile/dist-web/` — static files ready for any static host (Railway, Vercel, Netlify, S3).

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

**No secrets in the bundle.** Verified:
- `EXPO_PUBLIC_*` vars are build-time only; unset vars are empty strings, not secrets
- No `sk_live`, `pk_live`, or `secret` strings in the JS bundle
- API base URL (`EXPO_PUBLIC_API_URL`) is public by design — it's the API endpoint, not a credential
- Auth tokens are runtime-only (phone-OTP flow), never bundled

Per the standing rule: production credentials go into Railway/Supabase env config, never into a commit, fixture, email, or PR description.

## Demo mode

The web build uses the fixture provider by default (`EXPO_PUBLIC_DATA_PROVIDER` unset). For the live demo with the real API:

```bash
EXPO_PUBLIC_DATA_PROVIDER=real \
EXPO_PUBLIC_API_URL=https://api.raices.example.com \
pnpm web:build
```

**Fake money, real logic.** Nothing in the demo touches a real payment rail.
