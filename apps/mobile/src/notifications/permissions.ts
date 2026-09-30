import type { NotificationManager, NotificationPermissionStatus, PushToken } from "./types.js";

/**
 * Permission flow state machine (K2.32).
 *
 * The OS owns the actual permission dialog; this class owns the APP's
 * policy around it:
 * - Ask once. If the user denies, don't nag — they can enable it in
 *   Settings. (Repeated prompts train users to tap "don't allow".)
 * - Token registration happens only after permission is granted, and the
 *   token goes to the backend through the injected `registerToken`
 *   callback — the manager never touches the network itself.
 * - Everything is behind the NotificationManager interface so Phase 3
 *   can swap the platform bindings without touching callers.
 */
export class PermissionFlow implements NotificationManager {
  private status: NotificationPermissionStatus;
  private token: PushToken | null = null;
  private asked = false;

  /**
   * @param platform — platform bindings (OS permission dialog + token
   *   fetch). Injected so tests can drive the flow without a device.
   * @param registerToken — sends the token to the backend. Injected so
   *   the manager stays network-free.
   */
  constructor(
    private readonly platform: {
      getStatus(): Promise<NotificationPermissionStatus>;
      request(): Promise<NotificationPermissionStatus>;
      fetchToken(): Promise<PushToken>;
    },
    private readonly registerToken: (token: PushToken) => Promise<void>,
  ) {
    this.status = "undetermined";
  }

  async getPermissionStatus(): Promise<NotificationPermissionStatus> {
    try {
      this.status = await this.platform.getStatus();
    } catch {
      // Never throw for a status check — callers treat errors as "unknown",
      // which behaves like undetermined (may ask once).
      this.status = "undetermined";
    }
    return this.status;
  }

  async requestPermission(): Promise<NotificationPermissionStatus> {
    const current = await this.getPermissionStatus();
    if (this.asked || current === "denied") {
      // Ask once. A denial is final until the user changes it in Settings.
      return current;
    }
    this.asked = true;
    try {
      this.status = await this.platform.request();
    } catch {
      this.status = "undetermined";
    }
    return this.status;
  }

  async getPushToken(): Promise<PushToken | null> {
    const status = await this.getPermissionStatus();
    if (status !== "granted") return null;
    if (this.token === null) {
      this.token = await this.platform.fetchToken();
      await this.registerToken(this.token);
    }
    return this.token;
  }
}
