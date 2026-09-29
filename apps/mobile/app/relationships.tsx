import { useRouter } from "expo-router";
import type { JSX } from "react";

import { ScreenData } from "../src/data/ScreenDataContext";
import { fixtureProvider } from "../src/data/fixtureProvider";
import { RelationshipsScreen } from "../src/screens/RelationshipsScreen";

/**
 * Route: /relationships. The app root chooses the concrete provider (K2.24).
 */
export default function RelationshipsRoute(): JSX.Element {
  const router = useRouter();
  return (
    <ScreenData provider={fixtureProvider}>
      <RelationshipsScreen
        onSelectRelationship={(id) => {
          router.push(`/relationships/${id}`);
        }}
        onInvite={() => {
          router.push("/invite");
        }}
      />
    </ScreenData>
  );
}
