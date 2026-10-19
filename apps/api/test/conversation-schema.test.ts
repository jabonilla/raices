import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * P3.2 database-level guarantees for `conversation`.
 *
 * The invariant worth the most here is that a pending context cannot exist
 * without a deadline. If that is only enforced in application code then a
 * migration, a console session or a future caller can create a proposal that
 * never goes stale, and a "sí" will eventually land on it. Everything below
 * is proven by attempting the forbidden write against real Postgres.
 */

/** Raised by conversation_reject_erasure. */
const ERASURE_REFUSED = "CV001";
/** Raised by conversation_born_idle. */
const NOT_BORN_IDLE = "CV002";
/** Raised by audit_require_row in 0003. */
const AUDIT_REQUIRED = "AU002";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
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

let phoneCounter = 0;
function aPhone(): string {
  phoneCounter += 1;
  return `+5024${String(8_000_000 + phoneCounter).padStart(7, "0")}`;
}

/** An active relationship, built with plain SQL so this file owns no module. */
async function aRelationship(client: pg.Client): Promise<string> {
  const sender = await client.query<{ id: string }>(
    `insert into app_user (phone, roles) values ($1, array['sender']) returning id`,
    [aPhone()],
  );
  const recipient = await client.query<{ id: string }>(
    `insert into app_user (phone, roles) values ($1, array['recipient']) returning id`,
    [aPhone()],
  );
  const rel = await client.query<{ id: string }>(
    `insert into relationship (user_a_id, user_b_id, role_of_a, role_of_b)
     values ($1, $2, 'sender', 'recipient') returning id`,
    [sender.rows[0]?.id, recipient.rows[0]?.id],
  );
  const id = rel.rows[0]?.id;
  if (id === undefined) throw new Error("relationship insert returned no id");
  return id;
}

async function aConversation(client: pg.Client, relationshipId?: string): Promise<string> {
  const rel = relationshipId ?? (await aRelationship(client));
  const row = await client.query<{ id: string }>(
    `insert into conversation (relationship_id, channel) values ($1, 'whatsapp') returning id`,
    [rel],
  );
  const id = row.rows[0]?.id;
  if (id === undefined) throw new Error("conversation insert returned no id");
  return id;
}

beforeAll(async () => {
  pgx = await startTestPostgres();
});

afterAll(async () => {
  await pgx.stop();
});

describe("conversation: a pending context always has a deadline", () => {
  it("refuses a pending state with no expires_at", async () => {
    await withClient(async (client) => {
      const rel = await aRelationship(client);
      await client.query(
        `insert into conversation (relationship_id, channel) values ($1, 'whatsapp')`,
        [rel],
      );
      // The hazard in one statement: a proposal that never goes stale.
      await expect(
        client.query(
          `update conversation
             set state = 'awaiting_confirmation', pending_payload = '{"k":1}'::jsonb
           where relationship_id = $1`,
          [rel],
        ),
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === CHECK_VIOLATION);
    });
  });

  it("refuses a pending state with no payload", async () => {
    await withClient(async (client) => {
      const rel = await aRelationship(client);
      await aConversation(client, rel);
      await expect(
        client.query(
          `update conversation
             set state = 'awaiting_confirmation', expires_at = now() + interval '30 minutes'
           where relationship_id = $1`,
          [rel],
        ),
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === CHECK_VIOLATION);
    });
  });

  it("refuses an idle row that still carries a payload or a deadline", async () => {
    await withClient(async (client) => {
      const rel = await aRelationship(client);
      await aConversation(client, rel);
      // The other direction matters too: context left behind on an idle
      // conversation is a proposal nothing will ever expire.
      await expect(
        client.query(
          `update conversation set pending_payload = '{"k":1}'::jsonb where relationship_id = $1`,
          [rel],
        ),
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === CHECK_VIOLATION);
      await expect(
        client.query(
          `update conversation set expires_at = now() + interval '1 hour' where relationship_id = $1`,
          [rel],
        ),
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === CHECK_VIOLATION);
    });
  });
});

describe("conversation: born idle", () => {
  it("refuses a conversation inserted straight into a pending state", async () => {
    await withClient(async (client) => {
      const rel = await aRelationship(client);
      // 0003's audit trigger fires on UPDATE only, so a row born pending
      // would hold a proposal that no audit row accounts for.
      await expect(
        client.query(
          `insert into conversation (relationship_id, channel, state, pending_payload, expires_at)
           values ($1, 'whatsapp', 'awaiting_confirmation', '{"k":1}'::jsonb, now() + interval '30 minutes')`,
          [rel],
        ),
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === NOT_BORN_IDLE);
    });
  });

  it("accepts a conversation born idle", async () => {
    await withClient(async (client) => {
      await expect(aConversation(client)).resolves.toBeTypeOf("string");
    });
  });
});

describe("conversation: one per relationship per channel", () => {
  it("refuses a second conversation on the same relationship and channel", async () => {
    await withClient(async (client) => {
      const rel = await aRelationship(client);
      await aConversation(client, rel);
      await expect(aConversation(client, rel)).rejects.toSatisfy(
        (error: unknown) => errorCode(error) === UNIQUE_VIOLATION,
      );
    });
  });

  it("allows the same relationship on a different channel", async () => {
    await withClient(async (client) => {
      const rel = await aRelationship(client);
      await aConversation(client, rel);
      await expect(
        client.query(`insert into conversation (relationship_id, channel) values ($1, 'sms')`, [
          rel,
        ]),
      ).resolves.toBeDefined();
    });
  });

  it("requires a real relationship", async () => {
    await withClient(async (client) => {
      await expect(
        client.query(
          `insert into conversation (relationship_id, channel)
           values ('00000000-0000-0000-0000-000000000000', 'whatsapp')`,
        ),
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === FOREIGN_KEY_VIOLATION);
    });
  });
});

describe("conversation: not erasable", () => {
  it("rejects DELETE", async () => {
    await withClient(async (client) => {
      const id = await aConversation(client);
      await expect(client.query(`delete from conversation where id = $1`, [id])).rejects.toSatisfy(
        (error: unknown) => errorCode(error) === ERASURE_REFUSED,
      );
    });
  });

  it("rejects a DELETE that matches no rows", async () => {
    // Statement-level, so the refusal does not depend on a row being there.
    await withClient(async (client) => {
      await expect(client.query(`delete from conversation where false`)).rejects.toSatisfy(
        (error: unknown) => errorCode(error) === ERASURE_REFUSED,
      );
    });
  });

  it("rejects TRUNCATE", async () => {
    await withClient(async (client) => {
      await expect(client.query(`truncate conversation`)).rejects.toSatisfy(
        (error: unknown) => errorCode(error) === ERASURE_REFUSED,
      );
    });
  });

  it("still allows UPDATE, which is the whole point of the table", async () => {
    await withClient(async (client) => {
      const id = await aConversation(client);
      await expect(
        client.query(`update conversation set last_message_at = now() where id = $1`, [id]),
      ).resolves.toBeDefined();
    });
  });
});

describe("conversation: audited transitions", () => {
  it("refuses a state change with no audit row in the same transaction", async () => {
    await withClient(async (client) => {
      const rel = await aRelationship(client);
      await aConversation(client, rel);
      // CLAUDE.md rule 5, enforced in the database rather than by convention.
      await expect(
        client.query(
          `update conversation
             set state = 'awaiting_confirmation',
                 pending_payload = '{"k":1}'::jsonb,
                 expires_at = now() + interval '30 minutes'
           where relationship_id = $1`,
          [rel],
        ),
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === AUDIT_REQUIRED);
    });
  });

  it("allows a state change accompanied by its audit row", async () => {
    await withClient(async (client) => {
      const rel = await aRelationship(client);
      const id = await aConversation(client, rel);
      await client.query("begin");
      await client.query(
        `insert into audit_log
           (actor_kind, action, entity_type, entity_id, before_state, after_state)
         values ('system', 'conversation.awaiting_confirmation', 'conversation', $1,
                 '{"state":"idle"}'::jsonb, '{"state":"awaiting_confirmation"}'::jsonb)`,
        [id],
      );
      await client.query(
        `update conversation
           set state = 'awaiting_confirmation',
               pending_payload = '{"k":1}'::jsonb,
               expires_at = now() + interval '30 minutes'
         where id = $1`,
        [id],
      );
      await expect(client.query("commit")).resolves.toBeDefined();
    });
  });
});

describe("conversation: column constraints", () => {
  it("rejects an unknown state on insert, through the born-idle trigger", async () => {
    await withClient(async (client) => {
      const rel = await aRelationship(client);
      // CV002 rather than 23514, and the ordering is the reason: a BEFORE
      // ROW trigger runs ahead of the column CHECK constraints, so the
      // born-idle rule answers first. Both refuse the row; asserting 23514
      // here would be asserting something that is not what happens.
      await expect(
        client.query(
          `insert into conversation (relationship_id, channel, state) values ($1, 'whatsapp', 'waiting')`,
          [rel],
        ),
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === NOT_BORN_IDLE);
    });
  });

  it("rejects an unknown state on update, through the check constraint", async () => {
    await withClient(async (client) => {
      const rel = await aRelationship(client);
      await aConversation(client, rel);
      // Full context supplied, so this gets past the completeness check and
      // reaches conversation_state_known — the constraint actually under
      // test here.
      await expect(
        client.query(
          `update conversation
             set state = 'waiting',
                 pending_payload = '{"k":1}'::jsonb,
                 expires_at = now() + interval '30 minutes'
           where relationship_id = $1`,
          [rel],
        ),
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === CHECK_VIOLATION);
    });
  });

  it("rejects an unknown channel", async () => {
    await withClient(async (client) => {
      const rel = await aRelationship(client);
      await expect(
        client.query(
          `insert into conversation (relationship_id, channel) values ($1, 'telegram')`,
          [rel],
        ),
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === CHECK_VIOLATION);
    });
  });
});

describe("conversation: grants", () => {
  it("lets the app role select, insert and update", async () => {
    await withClient(
      async (client) => {
        const id = await aConversation(client);
        await expect(
          client.query(`update conversation set last_message_at = now() where id = $1`, [id]),
        ).resolves.toBeDefined();
        await expect(client.query(`select count(*) from conversation`)).resolves.toBeDefined();
      },
      { role: "app" },
    );
  });

  it("denies the app role DELETE and TRUNCATE", async () => {
    await withClient(
      async (client) => {
        // DELETE and TRUNCATE are simply never granted. Unlike the ledger's
        // `revoke`, there is no statement here claiming to take away a
        // privilege that was never given — the triggers above are what
        // actually refuse these for every role, owner included.
        await expect(client.query(`delete from conversation`)).rejects.toSatisfy(
          (error: unknown) => errorCode(error) === INSUFFICIENT_PRIVILEGE,
        );
        await expect(client.query(`truncate conversation`)).rejects.toSatisfy(
          (error: unknown) => errorCode(error) === INSUFFICIENT_PRIVILEGE,
        );
      },
      { role: "app" },
    );
  });
});
