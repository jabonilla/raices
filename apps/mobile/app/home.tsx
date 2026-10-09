import type { JSX } from "react";

import { ScreenData } from "../src/data/ScreenDataContext";
import { fixtureProvider } from "../src/data/fixtureProvider";
import { realProvider, selectProvider } from "../src/data/realProvider";
import { HomeScreen } from "../src/screens/HomeScreen";

/**
 * Route: /home (K2.48). Tab: Inicio.
 *
 * The app root chooses the concrete provider (K2.24) — the screen itself
 * only ever sees the interface through `useScreenData()`.
 */
export default function HomeRoute(): JSX.Element {
  const provider = selectProvider() === "real" ? realProvider : fixtureProvider;
  return (
    <ScreenData provider={provider}>
      <HomeScreen />
    </ScreenData>
  );
}
