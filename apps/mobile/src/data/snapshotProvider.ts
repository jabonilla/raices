import type { ScreenDataProvider } from "./provider";

/**
 * Snapshot provider (S5): a route that fetched its own data wraps it in
 * this provider and passes it to the screen. Getters the route did not
 * load throw instead of returning fixture data — a screen that asks for
 * data its route never fetched fails loudly in development rather than
 * silently rendering sample records. Screens render their loading /
 * error / empty shells before calling getters, so the throw is
 * unreachable in the normal flow.
 */
export function snapshotProvider(overrides: Partial<ScreenDataProvider>): ScreenDataProvider {
  const missing = (name: string) => (): never => {
    throw new Error(`Screen data not loaded by this route: ${name}`);
  };
  return {
    getHomeData: overrides.getHomeData ?? missing("getHomeData"),
    getApprovalData: overrides.getApprovalData ?? missing("getApprovalData"),
    getGoalData: overrides.getGoalData ?? missing("getGoalData"),
    getHistoryData: overrides.getHistoryData ?? missing("getHistoryData"),
    getAssistantData: overrides.getAssistantData ?? missing("getAssistantData"),
    getRelationshipsData: overrides.getRelationshipsData ?? missing("getRelationshipsData"),
  };
}
