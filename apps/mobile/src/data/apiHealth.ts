/**
 * Live API reachability check (k2/web-live).
 *
 * The ONLY real network call the web demo makes. The deployed API exposes
 * /health, /ready, /openapi.json, and /webhooks/channel — it has NO
 * screen-data endpoints, so screen content in this build is the labeled demo
 * dataset (see realProvider.ts). The connectivity itself is genuinely live:
 * every app boot probes the API's /health endpoint.
 *
 * CORS limitation (verified 2026-10-08): the API sends no
 * Access-Control-Allow-Origin headers, so a browser page cannot READ the
 * response. The probe therefore uses `mode: "no-cors"`: an opaque response
 * proves the server answered; a rejection proves it did not. We can
 * distinguish reachable from unreachable, but NOT healthy (/ready 200) from
 * degraded (/ready 503). If K3 adds CORS for the demo origin, switch to a
 * normal fetch and read the status codes.
 *
 * The probe is bounded (10s) so a hung API cannot hang the app boot.
 */

export type ApiReachability = "checking" | "reachable" | "unreachable";

const PROBE_TIMEOUT_MS = 10_000;

/**
 * Probe the live API. Returns true when the server answers /health,
 * false on network failure, timeout, or any fetch rejection.
 * Never throws; never leaks anything (no auth, no PII, no body read).
 */
export async function checkApiReachable(baseUrl: string): Promise<boolean> {
  const clean = baseUrl.replace(/\/+$/, "");
  if (clean === "") {
    return false;
  }
  try {
    // The fetch promise never rejects (both outcomes map to boolean), so
    // a late response after the timeout wins nothing and warns nothing.
    // No AbortController: React Native's fetch types clash with the DOM's
    // AbortSignal, and a race is all a reachability probe needs.
    const fetchPromise = fetch(`${clean}/health`, { mode: "no-cors" }).then(
      () => true,
      () => false,
    );
    const timeoutPromise = new Promise<false>((resolve) => {
      setTimeout(() => {
        resolve(false);
      }, PROBE_TIMEOUT_MS);
    });
    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch {
    return false;
  }
}

/**
 * The API base URL for this build. EXPO_PUBLIC_API_URL is public by design
 * (it is the endpoint address, not a credential) — see WEB_BUILD.md.
 */
export function apiBaseUrl(): string {
  const url: unknown = process.env.EXPO_PUBLIC_API_URL;
  return typeof url === "string" ? url : "";
}
