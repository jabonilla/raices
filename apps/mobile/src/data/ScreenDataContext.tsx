import { createContext, useContext, type JSX, type ReactNode } from "react";

import type { ScreenDataProvider } from "./provider";

/**
 * Screen data injection (K2.24).
 *
 * The app root (or a test) chooses the concrete provider and passes it here:
 *
 *   <ScreenData provider={fixtureProvider}>
 *     <HomeScreen />
 *   </ScreenData>
 *
 * In Phase 3 the root swaps `fixtureProvider` for the real implementation —
 * screens don't change, because they only ever see the ScreenDataProvider
 * interface through `useScreenData()`.
 *
 * This module imports the interface type ONLY. It must never import a
 * concrete provider: the default when unconfigured is to throw, loudly, so
 * a missing provider can never silently render empty screens.
 */
const ScreenDataContext = createContext<ScreenDataProvider | null>(null);

export function ScreenData({
  provider,
  children,
}: {
  readonly provider: ScreenDataProvider;
  readonly children: ReactNode;
}): JSX.Element {
  return <ScreenDataContext.Provider value={provider}>{children}</ScreenDataContext.Provider>;
}

export function useScreenData(): ScreenDataProvider {
  const provider = useContext(ScreenDataContext);
  if (provider === null) {
    throw new Error("useScreenData must be used inside <ScreenData provider={...}>");
  }
  return provider;
}
