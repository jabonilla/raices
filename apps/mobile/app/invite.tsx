import { useRouter } from "expo-router";
import type { JSX } from "react";

import { ScreenData } from "../src/data/ScreenDataContext";
import { getApiClient } from "../src/data/api";
import { fixtureProvider } from "../src/data/fixtureProvider";
import { selectProvider } from "../src/data/realProvider";
import { useSession } from "../src/data/SessionContext";
import { inviteRelationship } from "../src/data/sliceLoader";
import { snapshotProvider } from "../src/data/snapshotProvider";
import { InviteScreen } from "../src/screens/InviteScreen";

/**
 * Route: /invite. The app root chooses the concrete provider (K2.24) — the
 * screen itself only ever sees the interface through `useScreenData()`.
 *
 * Provider selection (K2.41): EXPO_PUBLIC_DATA_PROVIDER=real uses the live
 * API; anything else uses the fixture (default).
 *
 * Real path (S5): submit posts POST /relationships/invite. A rejection
 * keeps the form on screen with an error line (the screen owns that);
 * the route passes no fixture data — the invite screen needs no records.
 */
export default function InviteRoute(): JSX.Element {
  if (selectProvider() !== "real") {
    return (
      <ScreenData provider={fixtureProvider}>
        <InviteScreen />
      </ScreenData>
    );
  }
  return <RealInviteRoute />;
}

function RealInviteRoute(): JSX.Element {
  const router = useRouter();
  const { session } = useSession();
  const token = session?.token ?? null;
  return (
    <ScreenData provider={snapshotProvider({})}>
      <InviteScreen
        onSubmit={async ({ displayName, phoneE164 }) => {
          if (token === null) {
            router.replace("/auth");
            return;
          }
          await inviteRelationship(getApiClient(), token, phoneE164, displayName);
        }}
      />
    </ScreenData>
  );
}
