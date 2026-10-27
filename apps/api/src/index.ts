import { FakeChannelAdapter } from "@raices/channels";

import { buildApp, type ApiDependencies } from "./app.js";
import { getDb } from "./db/index.js";
import { readEnv } from "./env.js";
import { IdentityService } from "./identity/service.js";
import { PostgresReceiptStore } from "./http/idempotency.js";
import { InviteLimiter } from "./http/invite-limit.js";

const { port, secrets } = readEnv();

// One adapter, shared: the webhook route receives on it and OTP delivery
// sends on it. Still the fake — Phase 3 swaps in the real provider behind
// this same seam. Its `send` puts the message in an in-memory outbox and
// logs nothing, so an undelivered code is a login that does not happen
// rather than a code sitting in a log file.
const adapter = new FakeChannelAdapter({ channel: "fake" });

const api: ApiDependencies | undefined =
  secrets === undefined
    ? undefined
    : (() => {
        const db = getDb();
        return {
          db,
          identity: new IdentityService(db, {
            pepper: secrets.identityPepper,
            deliver: async ({ phone, code }) => {
              await adapter.send({ to: phone, body: code });
            },
          }),
          receipts: new PostgresReceiptStore(db, secrets.receiptPepper),
          inviteLimiter: new InviteLimiter(db, secrets.invitePepper),
        };
      })();

const app = buildApp({ api, webhooks: { adapter } });

if (api === undefined) {
  // Said out loud, because the failure mode this guards against is an
  // instance that looks healthy and serves nothing anyone can log in to.
  app.log.warn(
    "Identity, relationship and request routes are NOT registered: " +
      "IDENTITY_PEPPER, RECEIPT_PEPPER and INVITE_LIMIT_PEPPER are unset. " +
      "Serving health, readiness, the contract and the webhook only.",
  );
}

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
