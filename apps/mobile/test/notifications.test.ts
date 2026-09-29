import { describe, expect, it } from "vitest";

import { buildNotificationCopy } from "../src/notifications/copy.js";
import { FakeNotificationSender } from "../src/notifications/fakeSender.js";
import { PermissionFlow } from "../src/notifications/permissions.js";
import type {
  NotificationEvent,
  NotificationPermissionStatus,
  PushToken,
} from "../src/notifications/types.js";
import en from "../src/i18n/en.json";
import es from "../src/i18n/es.json";

const EVENTS: NotificationEvent[] = [
  "transfer.received",
  "transfer.approved",
  "transfer.needs_approval",
  "invite.received",
  "relationship.updated",
];

function tFor(locale: "en" | "es"): (key: string) => string {
  const catalog = locale === "en" ? en : es;
  return (key: string) => {
    const parts = key.split(".");
    let node: unknown = catalog;
    for (const part of parts) {
      node = (node as Record<string, unknown>)[part];
    }
    if (typeof node !== "string") throw new Error(`missing i18n key: ${key}`);
    return node;
  };
}

/**
 * Amount-like patterns. If any of these appear in notification copy, the
 * privacy rule is broken: a lock-screen preview would show money.
 */
const AMOUNT_PATTERNS = [/\$\s?\d/, /\d+\.\d{2}\b/, /\b\d{1,3}(,\d{3})+(\.\d{2})?\b/];

describe("notification copy privacy (K2.32)", () => {
  it.each(["en", "es"] as const)("no event copy contains amounts or names (%s)", (locale) => {
    const t = tFor(locale);
    for (const event of EVENTS) {
      const { title, body } = buildNotificationCopy(event, t);
      for (const pattern of AMOUNT_PATTERNS) {
        expect(title, `${event} title`).not.toMatch(pattern);
        expect(body, `${event} body`).not.toMatch(pattern);
      }
      // Names can't be pattern-matched, but the copy builder takes no name
      // parameter — assert the signature by construction: only (event, t).
      expect(buildNotificationCopy.length).toBe(2);
    }
  });

  it("copy is generic: opening the app is the only call to action", () => {
    const t = tFor("en");
    for (const event of EVENTS) {
      const { body } = buildNotificationCopy(event, t);
      // Every body directs into the app — details live behind authentication.
      expect(body).toMatch(/open raíces/i);
    }
  });
});

describe("FakeNotificationSender privacy guard", () => {
  const token: PushToken = { value: "tok", provider: "fake" };
  const sender = new FakeNotificationSender(tFor("en"));

  it("sends clean copy", async () => {
    await sender.notify("transfer.received", token);
    expect(sender.sent).toHaveLength(1);
  });

  it("rejects copy containing a dollar amount", async () => {
    await expect(
      sender.send({ title: "Update", body: "You got $25.00", to: token }),
    ).rejects.toThrow("privacy guard");
  });

  it("rejects copy containing a decimal amount", async () => {
    await expect(
      sender.send({ title: "Update", body: "Amount: 2500.00 USD", to: token }),
    ).rejects.toThrow("privacy guard");
  });
});

describe("PermissionFlow", () => {
  function makePlatform(initial: NotificationPermissionStatus) {
    let status = initial;
    return {
      getStatus: (): Promise<NotificationPermissionStatus> => Promise.resolve(status),
      request: (): Promise<NotificationPermissionStatus> => {
        status = "granted";
        return Promise.resolve(status);
      },
      fetchToken: (): Promise<PushToken> =>
        Promise.resolve({ value: "device-token", provider: "fake" }),
      setStatus: (s: NotificationPermissionStatus) => {
        status = s;
      },
    };
  }

  it("asks once: a second request does not re-prompt", async () => {
    const platform = makePlatform("undetermined");
    let requests = 0;
    const counting = {
      ...platform,
      request: (): Promise<NotificationPermissionStatus> => {
        requests += 1;
        return platform.request();
      },
    };
    const flow = new PermissionFlow(counting, () => Promise.resolve());
    await flow.requestPermission();
    await flow.requestPermission();
    expect(requests).toBe(1);
  });

  it("a denial is final until changed in Settings", async () => {
    const platform = makePlatform("denied");
    const flow = new PermissionFlow(platform, () => Promise.resolve());
    expect(await flow.requestPermission()).toBe("denied");
    expect(await flow.getPushToken()).toBeNull();
  });

  it("registers the token after grant, once", async () => {
    const platform = makePlatform("undetermined");
    const registered: PushToken[] = [];
    const flow = new PermissionFlow(platform, (t) => {
      registered.push(t);
      return Promise.resolve();
    });
    await flow.requestPermission();
    const token1 = await flow.getPushToken();
    const token2 = await flow.getPushToken();
    expect(token1).not.toBeNull();
    expect(token1).toBe(token2);
    expect(registered).toHaveLength(1);
  });

  it("never throws from a status check", async () => {
    const flow = new PermissionFlow(
      {
        getStatus: (): Promise<NotificationPermissionStatus> => {
          throw new Error("OS exploded");
        },
        request: (): Promise<NotificationPermissionStatus> => Promise.resolve("denied"),
        fetchToken: (): Promise<PushToken> => Promise.resolve({ value: "x", provider: "fake" }),
      },
      () => Promise.resolve(),
    );
    await expect(flow.getPermissionStatus()).resolves.toBe("undetermined");
  });
});
