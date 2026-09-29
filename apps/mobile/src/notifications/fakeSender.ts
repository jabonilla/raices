import type {
  NotificationEvent,
  NotificationSender,
  OutgoingNotification,
  PushToken,
} from "./types.js";
import { buildNotificationCopy } from "./copy.js";

/**
 * Patterns that must NEVER appear in notification copy. Defense in depth:
 * copy.ts already prevents amounts/names by construction (no such
 * parameters), but the sender checks again at the boundary — if a future
 * change leaks personal data into a template, the send fails loudly in
 * tests instead of quietly reaching a lock screen.
 */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /\$\s?\d/, // $25, $ 25 — dollar amounts
  /\d+\.\d{2}\b/, // 25.00 — decimal amounts
  /\b\d{1,3}(,\d{3})+(\.\d{2})?\b/, // 1,234.56 — grouped amounts
];

/**
 * Fake notification sender (K2.32). Records what WOULD be sent — no
 * credentials, no network, no real pushes. The privacy guard runs here:
 * `send` throws if the copy contains anything amount-like, so a template
 * regression fails the test suite instead of shipping to a lock screen.
 */
export class FakeNotificationSender implements NotificationSender {
  private readonly outbox: OutgoingNotification[] = [];

  constructor(private readonly translate: (key: string) => string) {}

  get sent(): readonly OutgoingNotification[] {
    return this.outbox;
  }

  async send(notification: OutgoingNotification): Promise<void> {
    assertCopyIsSafe(notification.title);
    assertCopyIsSafe(notification.body);
    await Promise.resolve();
    this.outbox.push(notification);
  }

  /** Convenience: build copy for an event and send it to a token. */
  async notify(event: NotificationEvent, to: PushToken): Promise<void> {
    const { title, body } = buildNotificationCopy(event, this.translate);
    await this.send({ title, body, to });
  }
}

function assertCopyIsSafe(text: string): void {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(
        `Notification copy failed the privacy guard: ${JSON.stringify(text)} looks like it contains an amount. ` +
          `Notification copy must never carry amounts or names.`,
      );
    }
  }
}
