import { useRouter } from "expo-router";
import type { JSX } from "react";
import { useEffect, useState } from "react";

import type { ScreenContentState } from "../src/components/ScreenState";
import { ApiClientError } from "../src/data/apiClient";
import { getApiClient } from "../src/data/api";
import { fixtureProvider } from "../src/data/fixtureProvider";
import { selectProvider } from "../src/data/realProvider";
import { ScreenData } from "../src/data/ScreenDataContext";
import { useSession } from "../src/data/SessionContext";
import { loadRelationships } from "../src/data/sliceLoader";
import { snapshotProvider } from "../src/data/snapshotProvider";
import type { RelationshipsData } from "../src/data/types";
import { RelationshipsScreen } from "../src/screens/RelationshipsScreen";

/**
 * Route: /relationships. The app root chooses the concrete provider (K2.24).
 *
 * Real path (S5): the route fetches the sender's relationships from the
 * API, holds the screenState, and passes a snapshot provider. The phone
 * line renders only when the API supplies inviteePhoneE164 (inviter-only).
 */
export default function RelationshipsRoute(): JSX.Element {
  if (selectProvider() !== "real") {
    return <FixtureRelationshipsRoute />;
  }
  return <RealRelationshipsRoute />;
}

function FixtureRelationshipsRoute(): JSX.Element {
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

function RealRelationshipsRoute(): JSX.Element {
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
        setScreenState(loaded.relationships.length === 0 ? "empty" : "content");
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
      <RelationshipsScreen
        screenState={screenState}
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
