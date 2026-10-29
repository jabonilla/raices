import type { JSX } from "react";

import { ScreenData } from "../src/data/ScreenDataContext";
import { fixtureProvider } from "../src/data/fixtureProvider";
import { selectProvider } from "../src/data/realProvider";
import { snapshotProvider } from "../src/data/snapshotProvider";
import { HistoryScreen } from "../src/screens/HistoryScreen";

/**
 * Route: /history (K2.48). Tab: Historial.
 *
 * The app root chooses the concrete provider (K2.24) — the screen itself
 * only ever sees the interface through `useScreenData()`.
 *
 * Real path (S5): UNWIRED. Requests carry a categoryId uuid and the API
 * has no category lookup, so no honest category label exists yet. The
 * route renders the error shell rather than fixture records in a real
 * build. Wiring waits on a categories endpoint.
 */
export default function HistoryRoute(): JSX.Element {
  if (selectProvider() !== "real") {
    return (
      <ScreenData provider={fixtureProvider}>
        <HistoryScreen />
      </ScreenData>
    );
  }
  return (
    <ScreenData provider={snapshotProvider({})}>
      <HistoryScreen screenState="error" />
    </ScreenData>
  );
}
