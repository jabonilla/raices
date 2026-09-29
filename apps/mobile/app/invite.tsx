import type { JSX } from "react";

import { ScreenData } from "../src/data/ScreenDataContext";
import { fixtureProvider } from "../src/data/fixtureProvider";
import { InviteScreen } from "../src/screens/InviteScreen";

/**
 * Route: /invite. The app root chooses the concrete provider (K2.24) — the
 * screen itself only ever sees the interface through `useScreenData()`.
 */
export default function InviteRoute(): JSX.Element {
  return (
    <ScreenData provider={fixtureProvider}>
      <InviteScreen />
    </ScreenData>
  );
}
