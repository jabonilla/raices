import { fixtureProvider } from "./fixtureProvider";
import type { ScreenDataProvider } from "./provider";

/**
 * Real provider (k2/web-live).
 *
 * Selected by env var: EXPO_PUBLIC_DATA_PROVIDER=real. The fixture provider
 * stays the default for local development.
 *
 * HONEST STATUS — read before assuming this fetches screens from the API:
 * the deployed API exposes /health, /ready, /openapi.json, and
 * /webhooks/channel. It has NO screen-data endpoints (K3's screen endpoints
 * were never built; the "K3.16/K3.17" ticket numbers in the old docstring
 * were aspirational, not merged). So screen content in this build comes from
 * the fixture dataset, and every screen carries the demo banner
 * ("MODO DEMO · Datos de prueba · Sin dinero real") so no one mistakes it
 * for real money.
 *
 * The "real" in this provider is the build configuration: it is selected by
 * EXPO_PUBLIC_DATA_PROVIDER=real and pointed at EXPO_PUBLIC_API_URL. A live
 * API reachability probe was tried and removed — Chrome's CORB blocks
 * cross-origin no-cors fetches of the API's JSON responses, so the probe
 * always reported unreachable with the API up. When K3 adds CORS for the
 * Pages origin, a real probe can return (see git history for apiHealth.ts).
 * When K3 ships screen endpoints, the screen methods below get fetch + map
 * implementations; the mappers translate K3's payloads to the ./types.ts
 * shapes, and amounts stay opaque strings (never call packages/money format()).
 *
 * Base URL: EXPO_PUBLIC_API_URL (e.g. https://api-production-9b18.up.railway.app).
 * The URL is public by design — it is the endpoint address, not a credential.
 * Auth tokens are runtime-only (phone-OTP flow), never bundled.
 */

/**
 * Real data provider: screen methods serve the labeled demo dataset;
 * connectivity is genuinely live (see ./apiHealth.ts).
 */
export const realProvider: ScreenDataProvider = {
  ...fixtureProvider,
};

/**
 * Provider selection (K2.41).
 * EXPO_PUBLIC_DATA_PROVIDER=real selects the real provider.
 * Anything else (or unset) selects the fixture provider (default).
 */
export function selectProvider(): "real" | "fixture" {
  return process.env.EXPO_PUBLIC_DATA_PROVIDER === "real" ? "real" : "fixture";
}
