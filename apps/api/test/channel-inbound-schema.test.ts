import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * P3.1 database-level guarantees for `channel_inbound_message`.
 *
 * An inbound message is the record of what actually arrived. It is never
 * rewritten, and the table carries the ledger's discipline: statement-level
 * triggers that refuse mutation even when no rows match, plus revoked grants
 * so the app role is stopped a layer earlier at the permission check.
 *
 * Every guarantee below is proven by attempting the forbidden thing against
 * real Postgres and requiring it to fail with the expected SQLSTATE.
 */

/** Raised by channel_inbound_reject_mutation. */
const APPEND_ONLY_VIOLATION = "CH001";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const NOT_NULL_VIOLATION = "23502";
const INSUFFICIENT_PRIVILEGE = "42501";

interface PostgresError extends Error {
  readonly code?: string;
}
function errorCode(error: unknown): string | undefined {
  return (error as PostgresError | undefined)?.code;
}

let pgx: TestPostgres;

async function withClient<T>(
  fn: (client: pg.Client) => Promise<T>,
  options: { role?: string } = {},
): Promise<T> {
  const client = new pg.Client({ connectionString: pgx.connectionString });
  await client.connect();
  try {
    if (options.role !== undefined) await client.query(`set role ${options.role}`);
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Insert one message and return its id. Owner rights, no role switch. */
async function insertMessage(
  client: pg.Client,
  overrides: Partial<{
    provider: string;
    providerMessageId: string;
    payload: string;
    state: string;
  }> = {},
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into channel_inbound_message
       (provider, provider_message_id, received_at, payload, processing_state)
     values ($1, $2, now(), $3, $4)
     returning id`,
    [
      overrides.provider ?? "whatsapp-fake",
      overrides.providerMessageId ?? `msg-${crypto.randomUUID()}`,
      overrides.payload ?? JSON.stringify({ text: "hola" }),
      overrides.state ?? "processed",
    ],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error("insert returned no id");
  return id;
}

beforeAll(async () => {
  pgx = await startTestPostgres();
});

afterAll(async () => {
  await pgx.stop();
});

describe("channel_inbound_message: the dedupe key", () => {
  it("refuses a second row with the same (provider, provider_message_id)", async () => {
    await withClient(async (client) => {
      const providerMessageId = `dup-${crypto.randomUUID()}`;
      await insertMessage(client, { providerMessageId });

      await expect(insertMessage(client, { providerMessageId })).rejects.toSatisfy(
        (error: unknown) => errorCode(error) === UNIQUE_VIOLATION,
      );
    });
  });

  it("allows the same provider_message_id under a different provider", async () => {
    await withClient(async (client) => {
      const providerMessageId = `shared-${crypto.randomUUID()}`;
      await insertMessage(client, { provider: "provider-a", providerMessageId });
      // Uniqueness is on the pair. If this throws, two providers that both
      // number their messages from 1 would silently swallow each other.
      await expect(
        insertMessage(client, { provider: "provider-b", providerMessageId }),
      ).resolves.toBeTypeOf("string");
    });
  });
});

describe("channel_inbound_message: append-only", () => {
  it("rejects UPDATE", async () => {
    await withClient(async (client) => {
      const id = await insertMessage(client);
      await expect(
        client.query(
          `update channel_inbound_message set processing_state = 'ignored' where id = $1`,
          [id],
        ),
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === APPEND_ONLY_VIOLATION);
    });
  });

  it("rejects DELETE", async () => {
    await withClient(async (client) => {
      const id = await insertMessage(client);
      await expect(
        client.query(`delete from channel_inbound_message where id = $1`, [id]),
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === APPEND_ONLY_VIOLATION);
    });
  });

  it("rejects TRUNCATE", async () => {
    await withClient(async (client) => {
      await expect(client.query(`truncate channel_inbound_message`)).rejects.toSatisfy(
        (error: unknown) => errorCode(error) === APPEND_ONLY_VIOLATION,
      );
    });
  });

  it("rejects an UPDATE that matches no rows", async () => {
    // The statement-level trigger is the point. A row-level trigger never
    // fires when nothing matches, so this statement would report success and
    // a reader would conclude the table is mutable.
    await withClient(async (client) => {
      await expect(
        client.query(
          `update channel_inbound_message set processing_state = 'ignored'
           where id = '00000000-0000-0000-0000-000000000000'`,
        ),
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === APPEND_ONLY_VIOLATION);
    });
  });

  it("rejects a DELETE that matches no rows", async () => {
    await withClient(async (client) => {
      await expect(
        client.query(
          `delete from channel_inbound_message
           where id = '00000000-0000-0000-0000-000000000000'`,
        ),
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === APPEND_ONLY_VIOLATION);
    });
  });

  it("rejects a DELETE with a predicate that is false for every row", async () => {
    await withClient(async (client) => {
      await expect(
        client.query(`delete from channel_inbound_message where false`),
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === APPEND_ONLY_VIOLATION);
    });
  });
});

describe("channel_inbound_message: grants", () => {
  it("lets the app role insert and select", async () => {
    await withClient(
      async (client) => {
        await expect(insertMessage(client)).resolves.toBeTypeOf("string");
        await expect(
          client.query(`select count(*) from channel_inbound_message`),
        ).resolves.toBeDefined();
      },
      { role: "app" },
    );
  });

  it("denies the app role UPDATE at the permission check, before the trigger", async () => {
    await withClient(
      async (client) => {
        // 42501, not CH001: the grant stops this a layer earlier than the
        // trigger. Both are required — a grant would not stop a migration or
        // a console session, and a trigger can be bypassed by a superuser
        // setting session_replication_role.
        await expect(
          client.query(`update channel_inbound_message set processing_state = 'ignored'`),
        ).rejects.toSatisfy((error: unknown) => errorCode(error) === INSUFFICIENT_PRIVILEGE);
      },
      { role: "app" },
    );
  });

  it("denies the app role DELETE at the permission check", async () => {
    await withClient(
      async (client) => {
        await expect(client.query(`delete from channel_inbound_message`)).rejects.toSatisfy(
          (error: unknown) => errorCode(error) === INSUFFICIENT_PRIVILEGE,
        );
      },
      { role: "app" },
    );
  });

  it("still refuses UPDATE through the trigger when a grant hands app the privilege", async () => {
    // Honest accounting: the `revoke` in the migration is a no-op today.
    // `grant select, insert` never conferred UPDATE, so the three tests above
    // pass because the privilege was never granted, not because it was taken
    // away — removing the revoke line leaves them all green.
    //
    // What the revoke documents is the shape of a future accident: somebody
    // adds a blanket `grant all ... to app`. This test simulates exactly that
    // and shows the trigger is the layer that actually holds.
    await withClient(async (owner) => {
      await owner.query(`grant all on channel_inbound_message to app`);
      try {
        await withClient(
          async (client) => {
            await expect(
              client.query(`update channel_inbound_message set processing_state = 'ignored'`),
            ).rejects.toSatisfy((error: unknown) => errorCode(error) === APPEND_ONLY_VIOLATION);
            await expect(client.query(`delete from channel_inbound_message`)).rejects.toSatisfy(
              (error: unknown) => errorCode(error) === APPEND_ONLY_VIOLATION,
            );
          },
          { role: "app" },
        );
      } finally {
        await owner.query(`revoke all on channel_inbound_message from app`);
        await owner.query(`grant select, insert on channel_inbound_message to app`);
      }
    });
  });

  it("denies the app role TRUNCATE at the permission check", async () => {
    await withClient(
      async (client) => {
        await expect(client.query(`truncate channel_inbound_message`)).rejects.toSatisfy(
          (error: unknown) => errorCode(error) === INSUFFICIENT_PRIVILEGE,
        );
      },
      { role: "app" },
    );
  });
});

describe("channel_inbound_message: column constraints", () => {
  it("rejects an unknown processing_state", async () => {
    await withClient(async (client) => {
      // There is deliberately no 'pending': the claim shares a transaction
      // with the work, so a visible row is one whose work committed. A state
      // name for the in-flight window would invite reintroducing the bug
      // this table exists to prevent.
      await expect(insertMessage(client, { state: "pending" })).rejects.toSatisfy(
        (error: unknown) => errorCode(error) === CHECK_VIOLATION,
      );
    });
  });

  it("accepts both terminal states", async () => {
    await withClient(async (client) => {
      await expect(insertMessage(client, { state: "processed" })).resolves.toBeTypeOf("string");
      await expect(insertMessage(client, { state: "ignored" })).resolves.toBeTypeOf("string");
    });
  });

  it("rejects an empty or oversized provider", async () => {
    await withClient(async (client) => {
      await expect(insertMessage(client, { provider: "" })).rejects.toSatisfy(
        (error: unknown) => errorCode(error) === CHECK_VIOLATION,
      );
      await expect(insertMessage(client, { provider: "x".repeat(65) })).rejects.toSatisfy(
        (error: unknown) => errorCode(error) === CHECK_VIOLATION,
      );
    });
  });

  it("rejects an empty or oversized provider_message_id", async () => {
    // Unbounded keys in a unique index are a denial-of-service shape: a
    // broken or hostile provider should not be able to choose how much of
    // our index it occupies.
    await withClient(async (client) => {
      await expect(insertMessage(client, { providerMessageId: "" })).rejects.toSatisfy(
        (error: unknown) => errorCode(error) === CHECK_VIOLATION,
      );
      await expect(insertMessage(client, { providerMessageId: "x".repeat(201) })).rejects.toSatisfy(
        (error: unknown) => errorCode(error) === CHECK_VIOLATION,
      );
    });
  });

  it("requires a payload", async () => {
    await withClient(async (client) => {
      await expect(
        client.query(
          `insert into channel_inbound_message
             (provider, provider_message_id, received_at, payload, processing_state)
           values ('p', $1, now(), null, 'processed')`,
          [`nullpayload-${crypto.randomUUID()}`],
        ),
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === NOT_NULL_VIOLATION);
    });
  });

  it("stores the payload verbatim, including unrecognised provider fields", async () => {
    await withClient(async (client) => {
      const payload = { from: "+50255551234", weird: { nested: [1, null, "x"] } };
      const id = await insertMessage(client, { payload: JSON.stringify(payload) });
      const row = await client.query<{ payload: unknown }>(
        `select payload from channel_inbound_message where id = $1`,
        [id],
      );
      expect(row.rows[0]?.payload).toEqual(payload);
    });
  });
});
