import { createApiClient, type ApiClient } from "./apiClient";

/**
 * The shared API client for the real-API build (S5).
 *
 * Built once from EXPO_PUBLIC_API_URL. A real build without the URL fails
 * loudly here instead of fetching relative paths that can never work —
 * the same fail-loud rule as a missing ScreenData provider.
 */
let shared: ApiClient | null = null;

export function getApiClient(): ApiClient {
  if (shared === null) {
    const raw: unknown = process.env["EXPO_PUBLIC_API_URL"];
    const baseUrl = typeof raw === "string" ? raw : undefined;
    if (baseUrl === undefined || baseUrl === "") {
      throw new Error("EXPO_PUBLIC_API_URL is not set for the real data provider");
    }
    shared = createApiClient({ baseUrl });
  }
  return shared;
}
