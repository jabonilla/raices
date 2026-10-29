import { useRouter } from "expo-router";
import type { JSX } from "react";

import "../src/i18n";
import { getApiClient } from "../src/data/api";
import { useSession } from "../src/data/SessionContext";
import { AuthScreen } from "../src/screens/AuthScreen";

/**
 * Sign-in route (S5).
 *
 * Only meaningful on the real-API build: the fixture build never needs a
 * session, and nothing links here unless the provider is real (see index).
 * On success the session lands in the root SessionProvider and the sender
 * continues to /home.
 */
export default function Auth(): JSX.Element {
  const router = useRouter();
  const { signIn } = useSession();
  return (
    <AuthScreen
      client={getApiClient()}
      onAuthenticated={(session) => {
        signIn(session);
        router.replace("/home");
      }}
    />
  );
}
