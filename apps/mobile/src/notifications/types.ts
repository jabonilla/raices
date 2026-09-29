/**
 * Notification scaffold types (K2.32).
 *
 * Permission flow, token registration behind an interface, fake sender.
 * No credentials, no real pushes — the real push provider lands in Phase 3.
 *
 * PRIVACY RULE (the point of this ticket): notification copy carries NO
 * amounts and NO names. A lock-screen preview is visible to whoever holds
 * the phone, and in this product that may be someone the user is hiding
 * money from. The copy builder (copy.ts) enforces this by construction —
 * it accepts no amount or name parameters — and the fake sender
 * double-checks at send time.
 */

/** OS-level notification permission state. */
export type NotificationPermissionStatus =
  "undetermined" /** Never asked. */ | "granted" | "denied";

/** A push token, opaque to the app. Registered with the backend. */
export interface PushToken {
  readonly value: string;
  /** e.g. "expo", "fcm", "apns" — which provider issued it. */
  readonly provider: string;
}

/**
 * What the app asks the OS + backend to do. All platform specifics live
 * behind this interface; Phase 3 provides the real implementation.
 */
export interface NotificationManager {
  /** Current OS permission status. Never throws. */
  getPermissionStatus(): Promise<NotificationPermissionStatus>;
  /**
   * Ask the OS for permission. Returns the resulting status.
   * Must be called from a user gesture on iOS.
   */
  requestPermission(): Promise<NotificationPermissionStatus>;
  /**
   * Get the device push token, registering permission first if needed.
   * Returns null when permission is denied — the app works without it.
   */
  getPushToken(): Promise<PushToken | null>;
}

/**
 * Sends a notification. In production this goes to the push provider;
 * here it's a fake that records what WOULD be sent, so tests and the demo
 * can assert on copy without credentials.
 */
export interface NotificationSender {
  send(notification: OutgoingNotification): Promise<void>;
  /** What the fake has "sent" — for tests and the demo. */
  readonly sent: readonly OutgoingNotification[];
}

/** A notification ready to send. Title/body are pre-built by copy.ts. */
export interface OutgoingNotification {
  readonly title: string;
  readonly body: string;
  /** Token of the target device. */
  readonly to: PushToken;
}

/** Events the app can notify about. Generic — no personal data. */
export type NotificationEvent =
  | "transfer.received"
  | "transfer.approved"
  | "transfer.needs_approval"
  | "invite.received"
  | "relationship.updated";
