import { fixtureProvider } from "./fixtureProvider";
import type { ScreenDataProvider } from "./provider";

/**
 * Real provider (S5).
 *
 * Selected by env var: EXPO_PUBLIC_DATA_PROVIDER=real. The fixture provider
 * stays the default for local development.
 *
 * HONEST STATUS — read before assuming a screen fetches from the API:
 * - The slice routes fetch their own data and pass snapshot providers:
 *   /relationships and /relationships/[id] (GET /relationships),
 *   /invite (POST /relationships/invite), /approval?requestId= (GET
 *   /requests/:id + GET /relationships/:id). Their getters below throw
 *   so a screen that asks the shared provider for slice data fails
 *   loudly instead of silently rendering sample records.
 * - Home, goal, and assistant have no API backing yet and still serve
 *   the labeled demo dataset through this provider. The demo banner
 *   stays visible on those screens (see app/_layout.tsx); it is hidden
 *   only on slice routes in real mode, where the data is genuinely live.
 * - History is unwired in real mode: requests carry a categoryId uuid
 *   and the API has no category lookup, so no honest label exists yet.
 *   The history route renders its error shell in real mode until a
 *   categories endpoint lands.
 *
 * Base URL: EXPO_PUBLIC_API_URL (e.g. https://api-production-9b18.up.railway.app).
 * The URL is public by design — it is the endpoint address, not a credential.
 * Auth tokens are runtime-only (phone-OTP flow), never bundled.
 */

function notWired(name: string): () => never {
  return () => {
    throw new Error(
      `realProvider.${name} is not wired: the route fetches its own data ` +
        `and passes a snapshot provider (see src/data/sliceLoader.ts)`,
    );
  };
}

export const realProvider: ScreenDataProvider = {
  ...fixtureProvider,
  getRelationshipsData: notWired("getRelationshipsData"),
  getApprovalData: notWired("getApprovalData"),
  getHistoryData: notWired("getHistoryData"),
};

/**
 * Provider selection (K2.41).
 * EXPO_PUBLIC_DATA_PROVIDER=real selects the real provider.
 * Anything else (or unset) selects the fixture provider (default).
 */
export function selectProvider(): "real" | "fixture" {
  return process.env.EXPO_PUBLIC_DATA_PROVIDER === "real" ? "real" : "fixture";
}
