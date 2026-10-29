import { useLocalSearchParams, useRouter } from "expo-router";
import type { JSX } from "react";
import { useEffect, useState } from "react";

import type { ScreenContentState } from "../src/components/ScreenState";
import { ApiClientError } from "../src/data/apiClient";
import { getApiClient } from "../src/data/api";
import { fixtureProvider } from "../src/data/fixtureProvider";
import { selectProvider } from "../src/data/realProvider";
import { ScreenData } from "../src/data/ScreenDataContext";
import { useSession } from "../src/data/SessionContext";
import { loadApproval } from "../src/data/sliceLoader";
import { snapshotProvider } from "../src/data/snapshotProvider";
import type { ApprovalData } from "../src/data/types";
import { ApprovalScreen } from "../src/screens/ApprovalScreen";

/**
 * Route: /approval (K2.48). Not a tab — reached from Home's pending
 * approvals (deep-linkable for the demo).
 *
 * The app root chooses the concrete provider (K2.24) — the screen itself
 * only ever sees the interface through `useScreenData()`.
 *
 * Real path (S5): /approval?requestId=<uuid> loads that request from the
 * API. Without a request id there is nothing to load, so the route
 * renders its error state. When the server has not supplied amountDisplay
 * yet, loadApproval returns null and the route renders its error state —
 * never minor units (S5 contract decision).
 */
export default function ApprovalRoute(): JSX.Element {
  if (selectProvider() !== "real") {
    return (
      <ScreenData provider={fixtureProvider}>
        <ApprovalScreen />
      </ScreenData>
    );
  }
  return <RealApprovalRoute />;
}

function RealApprovalRoute(): JSX.Element {
  const router = useRouter();
  const { requestId } = useLocalSearchParams<{ requestId?: string }>();
  const { session } = useSession();
  const token = session?.token ?? null;
  const [screenState, setScreenState] = useState<ScreenContentState>("loading");
  const [data, setData] = useState<ApprovalData | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (token === null) {
      router.replace("/auth");
      return;
    }
    if (requestId === undefined) {
      setScreenState("error");
      return;
    }
    loadApproval(getApiClient(), token, requestId).then(
      (loaded) => {
        if (cancelled) {
          return;
        }
        if (loaded === null) {
          setScreenState("error");
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
  }, [token, requestId, router]);

  const provider =
    data === null ? snapshotProvider({}) : snapshotProvider({ getApprovalData: () => data });
  return (
    <ScreenData provider={provider}>
      <ApprovalScreen screenState={screenState} />
    </ScreenData>
  );
}
