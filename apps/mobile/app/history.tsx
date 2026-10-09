import type { JSX } from "react";

import { ScreenData } from "../src/data/ScreenDataContext";
import { fixtureProvider } from "../src/data/fixtureProvider";
import { realProvider, selectProvider } from "../src/data/realProvider";
import { HistoryScreen } from "../src/screens/HistoryScreen";

/**
 * Route: /history (K2.48). Tab: Historial.
 *
 * The app root chooses the concrete provider (K2.24) — the screen itself
 * only ever sees the interface through `useScreenData()`.
 */
export default function HistoryRoute(): JSX.Element {
  const provider = selectProvider() === "real" ? realProvider : fixtureProvider;
  return (
    <ScreenData provider={provider}>
      <HistoryScreen />
    </ScreenData>
  );
}
