import type { JSX } from "react";

import { ScreenData } from "../src/data/ScreenDataContext";
import { fixtureProvider } from "../src/data/fixtureProvider";
import { realProvider, selectProvider } from "../src/data/realProvider";
import { ApprovalScreen } from "../src/screens/ApprovalScreen";

/**
 * Route: /approval (K2.48). Not a tab — reached from Home's pending
 * approvals (deep-linkable for the demo).
 *
 * The app root chooses the concrete provider (K2.24) — the screen itself
 * only ever sees the interface through `useScreenData()`.
 */
export default function ApprovalRoute(): JSX.Element {
  const provider = selectProvider() === "real" ? realProvider : fixtureProvider;
  return (
    <ScreenData provider={provider}>
      <ApprovalScreen />
    </ScreenData>
  );
}
