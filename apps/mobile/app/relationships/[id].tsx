import { useLocalSearchParams, useRouter } from "expo-router";
import type { JSX } from "react";

import { ScreenData } from "../../src/data/ScreenDataContext";
import { fixtureProvider } from "../../src/data/fixtureProvider";
import { RelationshipDetailScreen } from "../../src/screens/RelationshipDetailScreen";

/**
 * Route: /relationships/[id]. The app root chooses the concrete provider
 * (K2.24); the id comes from the route params.
 */
export default function RelationshipDetailRoute(): JSX.Element {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <ScreenData provider={fixtureProvider}>
      <RelationshipDetailScreen
        relationshipId={id}
        onBack={() => {
          router.back();
        }}
      />
    </ScreenData>
  );
}
