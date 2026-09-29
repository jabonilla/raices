import type { ScreenDataProvider } from "./provider";

/**
 * Real provider stub (K2.24): the Phase 3 placeholder. Every method throws
 * "not implemented" — the real backend implementation will replace this
 * object without touching any screen, because screens depend on the
 * ScreenDataProvider interface only.
 */
function notImplemented(): never {
  throw new Error("not implemented");
}

export const realProvider: ScreenDataProvider = {
  getHomeData: notImplemented,
  getApprovalData: notImplemented,
  getGoalData: notImplemented,
  getHistoryData: notImplemented,
  getAssistantData: notImplemented,
};
