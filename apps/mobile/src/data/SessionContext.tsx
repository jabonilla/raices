import { createContext, useContext, useState, type JSX, type ReactNode } from "react";

import type { Session } from "./apiClient";

/**
 * Session state (S5).
 *
 * Holds the authenticated session for the real-API build: the bearer token
 * from POST /auth/otp/verify, the user id, and the expiry. The token lives
 * in memory only, for exactly the same reason the API client keeps it out
 * of storage: it is unencrypted in AsyncStorage, and session persistence
 * across restarts is a separate decision, not a default.
 *
 * The provider sits in the root layout so every route shares one session:
 * the auth route signs in, the slice routes read the token. A route that
 * needs the token and finds none renders its signed-out state instead of
 * calling the API unauthenticated.
 */
export interface SessionState {
  readonly session: Session | null;
  readonly signIn: (session: Session) => void;
  readonly signOut: () => void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  return (
    <SessionContext.Provider
      value={{
        session,
        signIn: (next: Session) => {
          setSession(next);
        },
        signOut: () => {
          setSession(null);
        },
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const session = useContext(SessionContext);
  if (session === null) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return session;
}
