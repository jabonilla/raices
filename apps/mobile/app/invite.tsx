import type { JSX } from "react";

import { ScreenData } from "../src/data/ScreenDataContext";
import { fixtureProvider } from "../src/data/fixtureProvider";
import { realProvider, selectProvider } from "../src/data/realProvider";
import { InviteScreen } from "../src/screens/InviteScreen";

/**
 * Route: /invite. The app root chooses the concrete provider (K2.24) — the
 * screen itself only ever sees the interface through `useScreenData()`.
 *
 * Provider selection (K2.41): EXPO_PUBLIC_DATA_PROVIDER=real uses the live
 * API; anything else uses the fixture (default).
 */
export default function InviteRoute(): JSX.Element {
  const provider = selectProvider() === "real" ? realProvider : fixtureProvider;
  return (
    <ScreenData provider={provider}>
      <InviteScreen />
    </ScreenData>
  );
}
