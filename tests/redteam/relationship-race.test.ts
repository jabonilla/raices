import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Database } from "../../apps/api/src/db/schema.js";
import { activate, invite, terminate } from "../../apps/api/src/relationships/relationships.js";
import { findOrCreateUserByPhone } from "../../apps/api/src/relationships/users.js";
import { startTestPostgres, type TestPostgres } from "../pg.js";

let server: TestPostgres;
let db: Kysely<Database>;
beforeAll(async () => {
  server = await startTestPostgres();
  db = server.kysely<Database>();
});
afterAll(async () => {
  await server.stop();
});

it("does not revive a terminated invitation after a stale domain read", async () => {
  const sender = await findOrCreateUserByPhone(db, { phone: "+15550000001", role: "sender" });
  const recipient = await findOrCreateUserByPhone(db, { phone: "+50250000001", role: "recipient" });
  const relationship = await invite(db, { senderId: sender.id, recipientId: recipient.id });
  let announceRead!: () => void;
  let releaseRead!: () => void;
  const read = new Promise<void>((resolve) => {
    announceRead = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const pool = new pg.Pool({ connectionString: server.connectionString });
  let held = false;
  pool.on("connect", (client) => {
    const original = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
    Object.defineProperty(client, "query", {
      configurable: true,
      value: async (...args: unknown[]) => {
        const result = await original(...args);
        if (
          !held &&
          typeof args[0] === "string" &&
          /select "status" from "relationship"/.test(args[0])
        ) {
          held = true;
          announceRead();
          await gate;
        }
        return result;
      },
    });
  });
  const delayed = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  const pending = activate(delayed, {
    relationshipId: relationship.id,
    actor: { kind: "user", id: recipient.id },
  }).then(
    () => ({ accepted: true }),
    (error: unknown) => ({ accepted: false, error }),
  );
  try {
    await read;
    await terminate(db, {
      relationshipId: relationship.id,
      actor: { kind: "user", id: sender.id },
    });
    releaseRead();
    await pending;
    const row = await db
      .selectFrom("relationship")
      .select("status")
      .where("id", "=", relationship.id)
      .executeTakeFirstOrThrow();
    expect(row.status, "a terminal relationship must stay terminated").toBe("terminated");
  } finally {
    releaseRead();
    await pending;
    await delayed.destroy();
  }
});
