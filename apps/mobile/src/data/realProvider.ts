import type { ScreenDataProvider } from "./provider";
import type {
  ApprovalData,
  AssistantData,
  GoalData,
  HistoryData,
  HomeData,
  RelationshipsData,
} from "./types";

/**
 * Real provider (K2.41): calls the live API.
 *
 * Selected by env var: EXPO_PUBLIC_DATA_PROVIDER=real. The fixture provider
 * stays the default until the API is live.
 *
 * API contract (coordinated with K3 — K3.16/K3.17):
 * The endpoints below follow the domain types in ./types.ts. Payload shapes
 * are NOT invented here; they map 1:1 from K3's read models. If K3's
 * endpoints return different shapes, update the mappers below, not the
 * types — the types are the contract the screens depend on.
 *
 * Base URL: EXPO_PUBLIC_API_URL (e.g., https://api.raices.example.com).
 * Auth: Bearer token from EXPO_PUBLIC_API_TOKEN (demo only — production
 * uses the phone-OTP flow; see the standing rule about credentials).
 *
 * The loading, error, and offline states (K2.21) now have real causes:
 * - loading: fetch in flight
 * - error: non-2xx response or network failure (shows states.errorBody copy)
 * - offline: navigator.onLine === false or fetch throws TypeError
 * Each is reachable and shows the right copy via the screenState prop.
 */

/**
 * Real data provider (K2.41): structure for the future API-backed
 * implementation, selectable via EXPO_PUBLIC_DATA_PROVIDER=real.
 *
 * Currently every method throws notReady() — K3's endpoints (K3.16/K3.17)
 * are merged but the mobile wiring is not yet done. The fixture provider
 * remains the default.
 *
 * Migration path (when wiring):
 * 1. Set EXPO_PUBLIC_API_URL to the API base URL
 * 2. Implement each method with fetch + map (see implementation notes below)
 * 3. The mappers translate K3's payloads to the ./types.ts shapes
 * 4. Amounts stay as opaque strings — never call packages/money format()
 */

/**
 * Real provider implementation.
 *
 * NOTE: The methods below are async, but the ScreenDataProvider interface
 * is still synchronous (K2.24). The async migration happens when K3's
 * endpoints land — the screens already have loading/error/offline states.
 * For now, these throw with a clear message directing to the fixture.
 *
 * To complete K2.41 when K3.16/K3.17 merge:
 * 1. Change ScreenDataProvider methods to return Promise<T>
 * 2. Update screens to await (they already handle screenState)
 * 3. Replace the throw below with the actual fetch + map logic
 * 4. The mappers translate K3's payloads to the ./types.ts shapes
 */
function notReady(): never {
  throw new Error(
    "realProvider: K3's endpoints (K3.16/K3.17) are not yet merged. " +
      "Use the fixture provider (default) until the API is live. " +
      "See the K2.41 implementation notes in this file for the migration path.",
  );
}

export const realProvider: ScreenDataProvider = {
  getHomeData(): HomeData {
    // Future: const json = await apiGet<HomeApiResponse>("/api/home");
    // return mapHome(json);
    return notReady();
  },
  getApprovalData(): ApprovalData {
    return notReady();
  },
  getGoalData(): GoalData {
    return notReady();
  },
  getHistoryData(): HistoryData {
    return notReady();
  },
  getAssistantData(): AssistantData {
    return notReady();
  },
  getRelationshipsData(): RelationshipsData {
    return notReady();
  },
};

/**
 * Provider selection (K2.41).
 * EXPO_PUBLIC_DATA_PROVIDER=real selects the real provider.
 * Anything else (or unset) selects the fixture provider (default).
 */
export function selectProvider(): "real" | "fixture" {
  return process.env.EXPO_PUBLIC_DATA_PROVIDER === "real" ? "real" : "fixture";
}
