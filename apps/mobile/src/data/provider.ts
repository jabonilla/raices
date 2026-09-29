import type { ApprovalData, AssistantData, GoalData, HistoryData, HomeData } from "./types";

/**
 * ScreenDataProvider — the data-layer contract for the mobile screens (K2.24).
 *
 * Screens depend on this interface ONLY (via `useScreenData()`). The two
 * implementations live beside it:
 * - `fixtureProvider` — realistic Spanish-language sample data for
 *   development and tests, including the ugly cases (long names, wide
 *   amounts, empty lists).
 * - `realProvider` — the Phase 3 stub. Every method throws "not implemented".
 *
 * Injection: the app root (or a test) chooses the implementation and passes
 * it through `<ScreenData provider={...}>`. Screens never import a concrete
 * provider — a test fails if they do.
 *
 * The interface is synchronous today because the screens are static shells.
 * When the real backend lands in Phase 3 these methods become async; the
 * existing `screenState="loading"` path on every screen already covers that
 * transition, so it is a swap, not a rewrite.
 */
export interface ScreenDataProvider {
  getHomeData(): HomeData;
  getApprovalData(): ApprovalData;
  getGoalData(): GoalData;
  getHistoryData(): HistoryData;
  getAssistantData(): AssistantData;
}
