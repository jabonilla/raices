import { useLocalSearchParams, useRouter } from "expo-router";
import type { JSX } from "react";

import { ScreenData } from "../../src/data/ScreenDataContext";
import { fixtureProvider } from "../../src/data/fixtureProvider";
import { realProvider, selectProvider } from "../../src/data/realProvider";
import { RelationshipDetailScreen } from "../../src/screens/RelationshipDetailScreen";

/**
 * Route: /relationships/[id]. The app root chooses the concrete provider
 * (K2.24); the id comes from the route params.
 */
export default function RelationshipDetailRoute(): JSX.Element {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const provider = selectProvider() === "real" ? realProvider : fixtureProvider;
  return (
    <ScreenData provider={provider}>
      <RelationshipDetailScreen
        relationshipId={id}
        onBack={() => {
          router.back();
        }}
      />
    </ScreenData>
  );
}
