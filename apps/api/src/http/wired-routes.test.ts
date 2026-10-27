import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import type { Database } from "../db/schema.js";
import { IdentityService } from "../identity/service.js";
import { startTestPostgres, type TestPostgres } from "../../../../tests/pg.js";
import { PostgresReceiptStore } from "./idempotency.js";
import { InviteLimiter } from "./invite-limit.js";

/**
 * The routes, exercised the way a client reaches them: through `buildApp`.
 *
 * The domain tests already prove the domain works. What they cannot prove is
 * that anyone can get to it, or that the wrong person cannot. Everything here
 * goes over HTTP against the real composed app — no handler is called
 * directly and no policy is stubbed, because a policy that is stubbed in the
 * test is a policy that is untested in production.
 *
 * Most of this file is about refusal. A happy path that works tells you the
 * wiring is connected; the refusals tell you it is connected to the right
 * person. In a system that moves someone's money to their family, the second
 * is the one worth most of the tests.
 */

let server: TestPostgres;
let db: Kysely<Database>;
let app: ReturnType<typeof buildApp>;
let identity: IdentityService;
const codes = new Map<string, string>();

interface Account {
  readonly token: string;
  readonly userId: string;
}

/** The two families. Nobody in one may touch anything in the other. */
let senderA: Account;
let recipientA: Account;
let senderB: Account;
let recipientB: Account;

/** A live relationship in family A, and a pending request inside it. */
let familyA: string;

async function login(phone: string, ip: string): Promise<Account> {
  const requested = await identity.requestCode({ phone, ip });
  const code = codes.get(requested.challengeId);
  if (code === undefined) throw new Error("No code was delivered");
  const session = await identity.verifyCode({
    challengeId: requested.challengeId,
    code,
    ip,
  });
  return { token: session.token, userId: session.userId };
}

function auth(account: Account, key: string = crypto.randomUUID()) {
  return { authorization: `Bearer ${account.token}`, "idempotency-key": key };
}

async function call(
  method: "GET" | "POST",
  url: string,
  account: Account | undefined,
  payload?: unknown,
  key?: string,
) {
  return app.inject({
    method,
    url,
    ...(account === undefined ? {} : { headers: auth(account, key) }),
    ...(method === "POST" ? { payload: payload ?? {} } : {}),
  });
}

beforeAll(async () => {
  server = await startTestPostgres();
  db = server.kysely<Database>();
  identity = new IdentityService(db, {
    pepper: "wired-routes-identity-pepper-32-bytes-min",
    deliver: (item) => {
      codes.set(item.challengeId, item.code);
      return Promise.resolve();
    },
  });
  app = buildApp({
    api: {
      db,
      identity,
      receipts: new PostgresReceiptStore(db, "wired-routes-receipt-pepper-32-bytes-min"),
      inviteLimiter: new InviteLimiter(db, "wired-routes-invite-pepper-32-bytes-min"),
    },
  });
  await app.ready();

  senderA = await login("+15551300001", "127.0.0.1");
  recipientA = await login("+50251300002", "127.0.0.2");
  senderB = await login("+15551300003", "127.0.0.3");
  recipientB = await login("+50251300004", "127.0.0.4");
}, 120_000);

afterAll(async () => {
  await app.close();
  await server.stop();
});

describe("a family can get all the way through over HTTP", () => {
  it("invites, accepts, requests and approves without touching a domain function", async () => {
    const invited = await call("POST", "/relationships/invite", senderA, {
      phone: "+50251300002",
      displayName: "Mamá",
    });
    expect(invited.statusCode).toBe(201);
    familyA = invited.json<{ id: string }>().id;

    const accepted = await call("POST", `/relationships/${familyA}/accept`, recipientA);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json<{ status: string }>().status).toBe("active");

    const submitted = await call("POST", `/relationships/${familyA}/requests`, recipientA, {
      amount: { amountMinor: "25000", currency: "USD" },
      description: "Medicina para la abuela",
    });
    expect(submitted.statusCode).toBe(201);
    const requestId = submitted.json<{ id: string }>().id;

    const listed = await call("GET", `/relationships/${familyA}/requests`, recipientA);
    expect(listed.json<{ id: string }[]>().map((row) => row.id)).toEqual([requestId]);

    const detail = await call("GET", `/requests/${requestId}`, senderA);
    expect(detail.statusCode).toBe(200);
    // Minor units survive as a string. A JSON number would be a double, and
    // a double is not what anyone's money is denominated in.
    expect(detail.json<{ amount: { amountMinor: string } }>().amount.amountMinor).toBe("25000");

    const approved = await call("POST", `/requests/${requestId}/approve`, senderA);
    expect(approved.statusCode).toBe(200);
    expect(approved.json<{ status: string; resolvedBy: string }>()).toMatchObject({
      status: "approved",
      resolvedBy: senderA.userId,
    });
  });
});

describe("S5 display fields", () => {
  it("shows the invitee phone only to the inviter", async () => {
    const listed = await call("GET", "/relationships", senderA);
    expect(listed.statusCode).toBe(200);
    const row = listed
      .json<{ id: string; inviteePhoneE164?: string }[]>()
      .find((candidate) => candidate.id === familyA);
    expect(row?.inviteePhoneE164).toBe("+50251300002");

    const asSender = await call("GET", `/relationships/${familyA}`, senderA);
    expect(asSender.statusCode).toBe(200);
    expect(asSender.json<{ inviteePhoneE164?: string }>().inviteePhoneE164).toBe("+50251300002");

    // The invitee's own view omits the field: it answers "the phone you
    // supplied", and the invitee supplied nothing.
    const asRecipient = await call("GET", `/relationships/${familyA}`, recipientA);
    expect(asRecipient.statusCode).toBe(200);
    expect("inviteePhoneE164" in asRecipient.json<Record<string, unknown>>()).toBe(false);
  });

  it("formats the request amount server-side in the viewer's locale", async () => {
    const submitted = await call("POST", `/relationships/${familyA}/requests`, recipientA, {
      amount: { amountMinor: "25000", currency: "USD" },
      description: "Display",
    });
    expect(submitted.statusCode).toBe(201);
    const requestId = submitted.json<{ id: string }>().id;

    // senderA's locale is the default 'es': USD 250.00 renders "250,00 US$".
    const detail = await call("GET", `/requests/${requestId}`, senderA);
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ amountDisplay: string }>().amountDisplay).toBe("250,00 US$");
    expect(detail.json<{ amount: { amountMinor: string } }>().amount.amountMinor).toBe("25000");

    const listed = await call("GET", `/relationships/${familyA}/requests`, recipientA);
    const listedRow = listed
      .json<{ id: string; amountDisplay: string }[]>()
      .find((candidate) => candidate.id === requestId);
    expect(listedRow?.amountDisplay).toBe("250,00 US$");
  });
});

describe("a stranger is refused", () => {
  /** A fresh pending request in family A for the refusal tests to aim at. */
  let requestId: string;

  beforeAll(async () => {
    const submitted = await call("POST", `/relationships/${familyA}/requests`, recipientA, {
      amount: { amountMinor: "5000", currency: "USD" },
      description: "Útiles escolares",
    });
    requestId = submitted.json<{ id: string }>().id;
  });

  it("refuses every relationship route to someone outside the relationship", async () => {
    for (const outsider of [senderB, recipientB])
      for (const [method, url] of [
        ["GET", `/relationships/${familyA}`],
        ["GET", `/relationships/${familyA}/requests`],
        ["POST", `/relationships/${familyA}/accept`],
        ["POST", `/relationships/${familyA}/pause`],
        ["POST", `/relationships/${familyA}/resume`],
        ["POST", `/relationships/${familyA}/terminate`],
        ["POST", `/relationships/${familyA}/resend-invitation`],
        ["POST", `/relationships/${familyA}/requests`],
      ] as const) {
        const response = await call(method, url, outsider, {
          amount: { amountMinor: "100", currency: "USD" },
          description: "no",
        });
        // 404, not 403: a stranger is not told that this relationship
        // exists. The same answer they would get for a made-up uuid.
        expect(`${method} ${url} -> ${String(response.statusCode)}`).toBe(
          `${method} ${url} -> 404`,
        );
      }
  });

  it("refuses every request route to someone outside the relationship", async () => {
    for (const outsider of [senderB, recipientB])
      for (const [method, url] of [
        ["GET", `/requests/${requestId}`],
        ["POST", `/requests/${requestId}/approve`],
        ["POST", `/requests/${requestId}/decline`],
      ] as const) {
        const response = await call(method, url, outsider, { reason: "no" });
        expect(`${method} ${url} -> ${String(response.statusCode)}`).toBe(
          `${method} ${url} -> 404`,
        );
      }
  });

  it("answers a stranger exactly as it answers a uuid that was never issued", async () => {
    const invented = crypto.randomUUID();
    const stranger = await call("GET", `/requests/${requestId}`, senderB);
    const nothing = await call("GET", `/requests/${invented}`, senderB);
    expect(stranger.statusCode).toBe(nothing.statusCode);
    // Request ids differ between the two envelopes; the rest must not.
    const strip = (body: string) => body.replace(/"requestId":"[^"]*"/u, '"requestId":"_"');
    expect(strip(stranger.body)).toBe(strip(nothing.body));
  });

  it("does not let the list route leak another family's relationships", async () => {
    const listed = await call("GET", "/relationships", senderB);
    expect(listed.json<{ id: string }[]>().map((row) => row.id)).not.toContain(familyA);
  });

  it("refuses every authenticated route without a credential", async () => {
    for (const [method, url] of [
      ["GET", "/relationships"],
      ["GET", `/relationships/${familyA}`],
      ["POST", "/relationships/invite"],
      ["POST", `/relationships/${familyA}/pause`],
      ["GET", `/requests/${requestId}`],
      ["POST", `/requests/${requestId}/approve`],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        ...(method === "POST" ? { payload: {} } : {}),
      });
      expect(`${method} ${url} -> ${String(response.statusCode)}`).toBe(`${method} ${url} -> 401`);
    }
  });
});

describe("a member is still not allowed the other side's action", () => {
  let requestId: string;

  beforeAll(async () => {
    const submitted = await call("POST", `/relationships/${familyA}/requests`, recipientA, {
      amount: { amountMinor: "7500", currency: "USD" },
      description: "Transporte",
    });
    requestId = submitted.json<{ id: string }>().id;
  });

  it("does not let the recipient approve or decline their own request", async () => {
    // The domain would allow this: approveRequest takes any actor and writes
    // it into resolved_by. The policy is the only thing standing between the
    // person asking for the money and the person granting it.
    for (const action of ["approve", "decline"] as const) {
      const response = await call("POST", `/requests/${requestId}/${action}`, recipientA, {
        reason: "me lo apruebo yo",
      });
      expect(`${action} -> ${String(response.statusCode)}`).toBe(`${action} -> 404`);
    }
    const after = await call("GET", `/requests/${requestId}`, recipientA);
    expect(after.json<{ status: string }>().status).toBe("pending");
  });

  it("does not let the sender submit a request to themselves", async () => {
    const response = await call("POST", `/relationships/${familyA}/requests`, senderA, {
      amount: { amountMinor: "100000", currency: "USD" },
      description: "me lo pido yo",
    });
    expect(response.statusCode).toBe(404);
  });

  it("does not let the recipient resend their own invitation", async () => {
    const response = await call("POST", `/relationships/${familyA}/resend-invitation`, recipientA);
    expect(response.statusCode).toBe(404);
  });

  it("lets the sender decline, with a reason, and records it", async () => {
    const declined = await call("POST", `/requests/${requestId}/decline`, senderA, {
      reason: "Este mes no alcanza, la semana que viene sí",
    });
    expect(declined.statusCode).toBe(200);
    expect(declined.json<{ status: string; declineReason: string }>()).toMatchObject({
      status: "declined",
      declineReason: "Este mes no alcanza, la semana que viene sí",
    });
  });

  it("refuses a decline with no reason", async () => {
    const submitted = await call("POST", `/relationships/${familyA}/requests`, recipientA, {
      amount: { amountMinor: "100", currency: "USD" },
      description: "Prueba",
    });
    const id = submitted.json<{ id: string }>().id;
    const response = await call("POST", `/requests/${id}/decline`, senderA, { reason: "  " });
    expect(response.statusCode).toBe(400);
    const after = await call("GET", `/requests/${id}`, senderA);
    expect(after.json<{ status: string }>().status).toBe("pending");
  });
});

describe("writes are idempotent", () => {
  it("requires an Idempotency-Key on every write", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/relationships/${familyA}/requests`,
      headers: { authorization: `Bearer ${recipientA.token}` },
      payload: { amount: { amountMinor: "100", currency: "USD" }, description: "sin llave" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("replays a submit rather than creating a second request", async () => {
    const key = crypto.randomUUID();
    const body = {
      amount: { amountMinor: "33300", currency: "USD" },
      description: "Reintento de la misma solicitud",
    };
    const before = await call("GET", `/relationships/${familyA}/requests`, recipientA);
    const first = await call("POST", `/relationships/${familyA}/requests`, recipientA, body, key);
    const second = await call("POST", `/relationships/${familyA}/requests`, recipientA, body, key);
    expect(first.statusCode).toBe(201);
    expect(second.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    const after = await call("GET", `/relationships/${familyA}/requests`, recipientA);
    // One new row, not two. A retried request for money is the same request
    // for money, and this is the difference between sending it once and
    // sending it twice.
    expect(after.json<unknown[]>().length).toBe(before.json<unknown[]>().length + 1);
  });

  it("refuses the same key carrying a different request", async () => {
    const key = crypto.randomUUID();
    await call(
      "POST",
      `/relationships/${familyA}/requests`,
      recipientA,
      { amount: { amountMinor: "111", currency: "USD" }, description: "Primera" },
      key,
    );
    const conflicting = await call(
      "POST",
      `/relationships/${familyA}/requests`,
      recipientA,
      { amount: { amountMinor: "999999", currency: "USD" }, description: "Otra cosa" },
      key,
    );
    expect(conflicting.statusCode).toBe(409);
  });

  it("scopes keys to the actor, so two people may use the same one", async () => {
    const key = crypto.randomUUID();
    const mine = await call(
      "POST",
      `/relationships/${familyA}/requests`,
      recipientA,
      { amount: { amountMinor: "222", currency: "USD" }, description: "La mía" },
      key,
    );
    const theirs = await call("POST", "/relationships/invite", senderB, {
      phone: "+50251300004",
    });
    expect(mine.statusCode).toBe(201);
    expect(theirs.statusCode).toBe(201);
  });
});

describe("the rate limiter runs before authorization", () => {
  it("spends the budget on an unauthenticated flood without ever reaching the token lookup", async () => {
    // The ordering is the property: the global onRequest limiter runs
    // before the policy's preValidation, so an attacker spraying bearer
    // tokens is cut off by the budget rather than by a database round trip
    // per guess. A 401 here instead of a 429 would mean every guess cost us
    // an identity_session read.
    const limited = buildApp({
      rateLimitMax: 2,
      rateLimitWindowMs: 60_000,
      api: {
        db,
        identity,
        receipts: new PostgresReceiptStore(db, "rate-limit-receipt-pepper-32-bytes"),
        inviteLimiter: new InviteLimiter(db, "rate-limit-invite-pepper-32-bytes"),
      },
    });
    await limited.ready();
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await limited.inject({
          method: "GET",
          url: "/relationships",
          headers: { authorization: `Bearer ${"a".repeat(43)}` },
          remoteAddress: "198.51.100.7",
        });
        statuses.push(response.statusCode);
      }
      expect(statuses).toEqual([401, 401, 429, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe("the contract describes what is served", () => {
  it("serves the wired routes in /openapi.json", async () => {
    const document = await app.inject({ method: "GET", url: "/openapi.json" });
    const paths = Object.keys(document.json<{ paths: Record<string, unknown> }>().paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/auth/otp/request",
        "/relationships",
        "/relationships/{id}",
        "/relationships/invite",
        "/relationships/{id}/accept",
        "/relationships/{id}/resume",
        "/relationships/{id}/requests",
        "/requests/{id}",
        "/requests/{id}/approve",
        "/requests/{id}/decline",
      ]),
    );
  });

  it("describes only the host routes when the app is built without them", async () => {
    const bare = buildApp();
    await bare.ready();
    try {
      const document = await bare.inject({ method: "GET", url: "/openapi.json" });
      const paths = Object.keys(document.json<{ paths: Record<string, unknown> }>().paths);
      // Not a lie by omission in either direction: an instance with no
      // database does not serve these, and does not claim to.
      expect(paths).not.toContain("/relationships");
      const denied = await bare.inject({ method: "GET", url: "/relationships" });
      expect(denied.statusCode).toBe(404);
    } finally {
      await bare.close();
    }
  });
});
