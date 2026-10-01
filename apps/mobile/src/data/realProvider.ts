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

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";
const API_TOKEN = process.env.EXPO_PUBLIC_API_TOKEN ?? "";

async function apiGet<T>(path: string): Promise<T> {
  if (!API_BASE) {
    throw new Error(
      "EXPO_PUBLIC_API_URL is not set. " +
        "Set it to the API base URL, or use the fixture provider (default).",
    );
  }
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`API ${res.status} on ${path}`);
  }
  return (await res.json()) as T;
}

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
