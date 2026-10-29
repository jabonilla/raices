import { useLocalSearchParams, useRouter } from "expo-router";
import type { JSX } from "react";
import { useEffect, useState } from "react";

import type { ScreenContentState } from "../../src/components/ScreenState";
import { ApiClientError } from "../../src/data/apiClient";
import { getApiClient } from "../../src/data/api";
import { fixtureProvider } from "../../src/data/fixtureProvider";
import { selectProvider } from "../../src/data/realProvider";
import { ScreenData } from "../../src/data/ScreenDataContext";
import { useSession } from "../../src/data/SessionContext";
import { loadRelationships } from "../../src/data/sliceLoader";
import { snapshotProvider } from "../../src/data/snapshotProvider";
import type { RelationshipsData } from "../../src/data/types";
import { RelationshipDetailScreen } from "../../src/screens/RelationshipDetailScreen";

/**
 * Route: /relationships/[id]. The app root chooses the concrete provider
 * (K2.24); the id comes from the route params.
 *
 * Real path (S5): same fetch as the list route; the screen finds the
 * row by id and renders its own not-found error when the id is absent.
 * The phone row renders only when the API supplies inviteePhoneE164.
 */
export default function RelationshipDetailRoute(): JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (selectProvider() !== "real") {
    return <FixtureRelationshipDetailRoute relationshipId={id} />;
  }
  return <RealRelationshipDetailRoute relationshipId={id} />;
}

function FixtureRelationshipDetailRoute({
  relationshipId,
}: {
  readonly relationshipId: string;
}): JSX.Element {
  const router = useRouter();
  return (
    <ScreenData provider={fixtureProvider}>
      <RelationshipDetailScreen
        relationshipId={relationshipId}
        onBack={() => {
          router.back();
        }}
      />
    </ScreenData>
  );
}

function RealRelationshipDetailRoute({
  relationshipId,
}: {
  readonly relationshipId: string;
}): JSX.Element {
  const router = useRouter();
  const { session } = useSession();
  const token = session?.token ?? null;
  const [screenState, setScreenState] = useState<ScreenContentState>("loading");
  const [data, setData] = useState<RelationshipsData | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (token === null) {
      router.replace("/auth");
      return;
    }
    loadRelationships(getApiClient(), token).then(
      (loaded) => {
        if (cancelled) {
          return;
        }
        setData(loaded);
        setScreenState("content");
      },
      (error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof ApiClientError && error.kind === "unauthorized") {
          router.replace("/auth");
          return;
        }
        setScreenState(
          error instanceof ApiClientError && error.kind === "offline" ? "offline" : "error",
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  const provider =
    data === null ? snapshotProvider({}) : snapshotProvider({ getRelationshipsData: () => data });
  return (
    <ScreenData provider={provider}>
      <RelationshipDetailScreen
        relationshipId={relationshipId}
        screenState={screenState}
        onBack={() => {
          router.back();
        }}
      />
    </ScreenData>
  );
}
