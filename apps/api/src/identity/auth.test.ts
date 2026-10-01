import type { Kysely } from "kysely";
import { sql } from "kysely";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Database } from "../db/schema.js";
import { startTestPostgres, type TestPostgres } from "../../../../tests/pg.js";
import { IdentityService } from "./service.js";

let server: TestPostgres;
let db: Kysely<Database>;
let service: IdentityService;
const deliveries: { phone: string; code: string; challengeId: string }[] = [];
beforeAll(async () => {
  server = await startTestPostgres();
  db = server.kysely<Database>();
  service = new IdentityService(db, {
    pepper: "synthetic-test-only-pepper-32-bytes-minimum",
    deliver: (item) => {
      deliveries.push(item);
      return Promise.resolve();
    },
  });
});
afterAll(async () => {
  await server.stop();
});

it("stores only digests, consumes OTP once under racing verifies, and revokes sessions", async () => {
  const requested = await service.requestCode({ phone: "+15551000001", ip: "127.0.0.1" });
  const delivered = deliveries.find((item) => item.challengeId === requested.challengeId);
  expect(delivered).toBeDefined();
  if (delivered === undefined) throw new Error("Missing fake delivery");
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      service.verifyCode({
        challengeId: requested.challengeId,
        code: delivered.code,
        ip: "127.0.0.1",
      }),
    ),
  );
  const successes = results.filter((result) => result.status === "fulfilled");
  expect(successes).toHaveLength(1);
  const session = successes[0]?.value;
  if (session === undefined) throw new Error("Missing session");
  expect((await service.authenticate(session.token)).id).toBe(session.userId);
  const stored = await sql<{
    digest: string;
    token_hash: string;
  }>`select c.digest, s.token_hash from identity_challenge c join identity_session s on s.challenge_id=c.id where c.id=${requested.challengeId}`.execute(
    db,
  );
  expect(stored.rows[0]?.digest).not.toBe(delivered.code);
  expect(stored.rows[0]?.token_hash).not.toBe(session.token);
  await service.revoke(session.token);
  await expect(service.authenticate(session.token)).rejects.toMatchObject({ statusCode: 401 });
  const audits = await db.selectFrom("audit_log").select("action").execute();
  expect(audits.map((row) => row.action)).toContain("identity.verified");
  expect(audits.map((row) => row.action)).toContain("identity.session_revoked");
});

it("audits lockout and rejects the correct code after repeated failures", async () => {
  const requested = await service.requestCode({ phone: "+15551000002", ip: "127.0.0.2" });
  const delivered = deliveries.find((item) => item.challengeId === requested.challengeId);
  if (delivered === undefined) throw new Error("Missing fake delivery");
  const wrong = delivered.code === "000000" ? "111111" : "000000";
  for (let attempt = 0; attempt < 5; attempt += 1)
    await expect(
      service.verifyCode({ challengeId: requested.challengeId, code: wrong, ip: "127.0.0.2" }),
    ).rejects.toMatchObject({ statusCode: 401 });
  await expect(
    service.verifyCode({
      challengeId: requested.challengeId,
      code: delivered.code,
      ip: "127.0.0.2",
    }),
  ).rejects.toMatchObject({ statusCode: 401 });
  const audits = await db
    .selectFrom("audit_log")
    .select("action")
    .where("entity_id", "=", requested.challengeId)
    .execute();
  expect(audits.map((row) => row.action)).toContain("identity.locked");
});

it("rejects expired challenge and session even when digests match", async () => {
  const requested = await service.requestCode({ phone: "+15551000003", ip: "127.0.0.3" });
  const delivered = deliveries.find((item) => item.challengeId === requested.challengeId);
  if (delivered === undefined) throw new Error("Missing fake delivery");
  await sql`update identity_challenge set expires_at=created_at where id=${requested.challengeId}`.execute(
    db,
  );
  await expect(
    service.verifyCode({
      challengeId: requested.challengeId,
      code: delivered.code,
      ip: "127.0.0.3",
    }),
  ).rejects.toMatchObject({ statusCode: 401 });
  const next = await service.requestCode({ phone: "+15551000004", ip: "127.0.0.4" });
  const code = deliveries.find((item) => item.challengeId === next.challengeId)?.code;
  if (code === undefined) throw new Error("Missing delivery");
  const session = await service.verifyCode({
    challengeId: next.challengeId,
    code,
    ip: "127.0.0.4",
  });
  await sql`update identity_session set expires_at=created_at where token_hash=${service.tokenHash(session.token)}`.execute(
    db,
  );
  await expect(service.authenticate(session.token)).rejects.toMatchObject({ statusCode: 401 });
});

it("enforces shared persistent phone and IP request limits across service instances", async () => {
  const other = new IdentityService(db, {
    pepper: "synthetic-test-only-pepper-32-bytes-minimum",
    deliver: async () => {},
  });
  for (let index = 0; index < 3; index += 1)
    await other.requestCode({ phone: "+15551000005", ip: `192.0.2.${index.toString()}` });
  await expect(
    service.requestCode({ phone: "+15551000005", ip: "192.0.2.99" }),
  ).rejects.toMatchObject({ statusCode: 429 });
  const low = new IdentityService(db, {
    pepper: "synthetic-test-only-pepper-32-bytes-minimum",
    policy: { requestPerIp: 2 },
    deliver: async () => {},
  });
  for (let index = 0; index < 2; index += 1)
    await low.requestCode({ phone: `+1555100001${index.toString()}`, ip: "198.51.100.1" });
  await expect(
    low.requestCode({ phone: "+15551000019", ip: "198.51.100.1" }),
  ).rejects.toMatchObject({ statusCode: 429 });
});

it("invalidates a prior device session after a new successful phone verification", async () => {
  const phone = "+15551000006";
  const first = await service.requestCode({ phone, ip: "203.0.113.1" });
  const code1 = deliveries.find((item) => item.challengeId === first.challengeId)?.code;
  if (code1 === undefined) throw new Error("Missing code");
  const old = await service.verifyCode({
    challengeId: first.challengeId,
    code: code1,
    ip: "203.0.113.1",
  });
  const second = await service.requestCode({ phone, ip: "203.0.113.2" });
  const code2 = deliveries.find((item) => item.challengeId === second.challengeId)?.code;
  if (code2 === undefined) throw new Error("Missing code");
  const current = await service.verifyCode({
    challengeId: second.challengeId,
    code: code2,
    ip: "203.0.113.2",
  });
  await expect(service.authenticate(old.token)).rejects.toMatchObject({ statusCode: 401 });
  expect((await service.authenticate(current.token)).id).toBe(current.userId);
});

it("cannot bypass phone-wide lockout by requesting a new OTP", async () => {
  const phone = "+15551000007";
  const a = await service.requestCode({ phone, ip: "203.0.113.7" });
  const codeA = deliveries.find((item) => item.challengeId === a.challengeId)?.code;
  if (codeA === undefined) throw new Error("Missing code");
  const wrong = codeA === "000000" ? "111111" : "000000";
  for (let index = 0; index < 5; index += 1)
    await expect(
      service.verifyCode({ challengeId: a.challengeId, code: wrong, ip: "203.0.113.7" }),
    ).rejects.toMatchObject({ statusCode: 401 });
  const b = await service.requestCode({ phone, ip: "203.0.113.8" });
  const codeB = deliveries.find((item) => item.challengeId === b.challengeId)?.code;
  if (codeB === undefined) throw new Error("Missing code");
  await expect(
    service.verifyCode({ challengeId: b.challengeId, code: codeB, ip: "203.0.113.8" }),
  ).rejects.toMatchObject({ statusCode: 401 });
});

it("rolls back OTP consumption and session issuance when audit insertion fails", async () => {
  const challenge = await service.requestCode({ phone: "+15551000008", ip: "203.0.113.9" });
  const code = deliveries.find((item) => item.challengeId === challenge.challengeId)?.code;
  if (code === undefined) throw new Error("Missing code");
  await sql`create function redteam_reject_identity_audit() returns trigger language plpgsql as $$ begin if new.action='identity.verified' then raise exception 'synthetic audit failure'; end if; return new; end $$`.execute(
    db,
  );
  await sql`create trigger redteam_identity_audit_failure before insert on audit_log for each row execute function redteam_reject_identity_audit()`.execute(
    db,
  );
  try {
    await expect(
      service.verifyCode({ challengeId: challenge.challengeId, code, ip: "203.0.113.9" }),
    ).rejects.toThrow("synthetic audit failure");
    const row = await sql<{
      state: string;
      sessions: string;
    }>`select state,(select count(*)::text from identity_session where challenge_id=${challenge.challengeId}) as sessions from identity_challenge where id=${challenge.challengeId}`.execute(
      db,
    );
    expect(row.rows[0]).toEqual({ state: "active", sessions: "0" });
  } finally {
    await sql`drop trigger redteam_identity_audit_failure on audit_log`.execute(db);
  }
  expect(
    (await service.verifyCode({ challengeId: challenge.challengeId, code, ip: "203.0.113.9" }))
      .token,
  ).toHaveLength(43);
});
