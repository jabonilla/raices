import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * P2.5 database-level guarantees.
 *
 * The load-bearing one is CLAUDE.md rule 4: intent state and settlement state
 * are separate columns and neither is derived from the other. "What we agreed
 * to do" and "what the money actually did" answer different questions, and a
 * combined status is how a failed payout starts reading as a cancelled
 * intent. The tests below fail if a third column, a generated column or a
 * view ever collapses them.
 */

const STATE_PAIR_VIOLATION = "TX001";
const DECLINED_REQUEST = "TX002";
const AUDIT_REQUIRED = "AU002";
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
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

async function failureCode(
  statement: string,
  options: { role?: string; values?: unknown[] } = {},
): Promise<string | undefined> {
  return withClient(async (client) => {
    try {
      await client.query(statement, options.values as never);
      return undefined;
    } catch (error) {
      return errorCode(error);
    }
  }, options);
}

async function rows<T extends Record<string, unknown>>(
  statement: string,
  values: unknown[] = [],
): Promise<T[]> {
  return withClient(async (client) => {
    const result = await client.query<T>(statement, values as never);
    return result.rows;
  });
}

let phoneCounter = 0;
function aPhone(): string {
  phoneCounter += 1;
  return `+50241${String(100_000 + phoneCounter).padStart(6, "0")}`;
}

interface Seed {
  readonly relationshipId: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly approvedRequestId: string;
  readonly declinedRequestId: string;
  readonly pendingRequestId: string;
}

let seed: Seed;

async function seedFixture(): Promise<Seed> {
  return withClient(async (client) => {
    const users = await client.query<{ id: string }>(
      `insert into app_user (phone, roles) values ($1, '{sender}'), ($2, '{recipient}')
       returning id`,
      [aPhone(), aPhone()],
    );
    const senderId = users.rows[0]?.id;
    const recipientId = users.rows[1]?.id;
    if (senderId === undefined || recipientId === undefined) throw new Error("seed failed");

    const rel = await client.query<{ id: string }>(
      `insert into relationship (user_a_id, user_b_id, role_of_a, role_of_b)
       values ($1, $2, 'sender', 'recipient') returning id`,
      [senderId, recipientId],
    );
    const relationshipId = rel.rows[0]?.id;
    if (relationshipId === undefined) throw new Error("seed failed");

    const made = await client.query<{ id: string }>(
      `insert into request (relationship_id, requested_by, amount_minor, amount_currency,
                            description, tier, channel_of_origin, status,
                            resolved_by, resolved_at, decline_reason)
       values
         ($1, $2, 5000, 'USD', 'Aprobada', 'recurring', 'app', 'approved', $3, now(), null),
         ($1, $2, 5000, 'USD', 'Rechazada', 'unrecognized', 'app', 'declined', $3, now(), 'No'),
         ($1, $2, 5000, 'USD', 'Pendiente', 'unrecognized', 'app', 'pending', null, null, null)
       returning id`,
      [relationshipId, recipientId, senderId],
    );
    const [approved, declined, pending] = made.rows;
    if (approved === undefined || declined === undefined || pending === undefined) {
      throw new Error("seed failed");
    }

    return {
      relationshipId,
      senderId,
      recipientId,
      approvedRequestId: approved.id,
      declinedRequestId: declined.id,
      pendingRequestId: pending.id,
    };
  });
}

/** A fresh approved request, so each transaction test gets its own. */
async function anApprovedRequest(): Promise<string> {
  const made = await rows<{ id: string }>(
    `insert into request (relationship_id, requested_by, amount_minor, amount_currency,
                          description, tier, channel_of_origin, status, resolved_by, resolved_at)
     values ($1, $2, 5000, 'USD', 'Aprobada', 'recurring', 'app', 'approved', $3, now())
     returning id`,
    [seed.relationshipId, seed.recipientId, seed.senderId],
  );
  const id = made[0]?.id;
  if (id === undefined) throw new Error("could not create an approved request");
  return id;
}

async function insertTransaction(overrides: Record<string, string> = {}): Promise<string> {
  const requestId = overrides["request_id"] ?? `'${await anApprovedRequest()}'`;
  const columns: Record<string, string> = {
    request_id: requestId,
    relationship_id: `'${seed.relationshipId}'`,
    amount_minor: "5000",
    amount_currency: "'USD'",
    approved_by: `'${seed.senderId}'`,
    ...overrides,
    ...{ request_id: requestId },
  };
  const made = await rows<{ id: string }>(
    `insert into transaction (${Object.keys(columns).join(", ")})
     values (${Object.values(columns).join(", ")}) returning id`,
  );
  const id = made[0]?.id;
  if (id === undefined) throw new Error("insert returned no id");
  return id;
}

beforeAll(async () => {
  pgx = await startTestPostgres();
  seed = await seedFixture();
}, 180_000);

afterAll(async () => {
  await pgx.stop();
});

describe("intent state and settlement state are separate (CLAUDE.md rule 4)", () => {
  it("has both columns, each with its own domain", async () => {
    const found = await rows<{ column_name: string; column_default: string | null }>(
      `select column_name, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'transaction'
          and column_name in ('intent_state', 'settlement_state')
        order by column_name`,
    );
    expect(found.map((r) => r.column_name)).toEqual(["intent_state", "settlement_state"]);
  });

  it("has no third column that could be a combined status", async () => {
    // A `status` column on this table could only mean one of the two, or a
    // blend of both. Either way somebody downstream reads the wrong thing.
    const suspicious = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'transaction'
          and column_name not in ('intent_state', 'settlement_state')
          and (column_name = 'status' or column_name = 'state'
               or column_name like '%status%' or column_name like '%state%')`,
    );
    expect(suspicious.map((r) => r.column_name)).toEqual([]);
  });

  it("has no generated column on the transaction table", async () => {
    // A generated column is the quiet way to derive one from the other.
    const generated = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'transaction'
          and is_generated <> 'NEVER'`,
    );
    expect(generated.map((r) => r.column_name)).toEqual([]);
  });

  it("has no view that folds the two into one column", async () => {
    // Deliberately strict: no view over `transaction` may expose a column
    // called status or state. When a read model is added it must keep the two
    // fields distinct, and this test is where that gets decided on purpose.
    const offending = await rows<{ table_name: string; column_name: string }>(
      `select c.table_name, c.column_name
         from information_schema.columns c
         join information_schema.views v
           on v.table_schema = c.table_schema and v.table_name = c.table_name
        where c.table_schema = 'public'
          and v.view_definition like '%transaction%'
          and c.column_name in ('status', 'state')`,
    );
    expect(offending).toEqual([]);
  });

  it("does not let one state be written into the other's column", async () => {
    const id = await insertTransaction();
    // 'settled' is a settlement state. It is not a thing intent can be.
    expect(
      await failureCode(`update transaction set intent_state = 'settled' where id = '${id}'`),
    ).toBe(CHECK_VIOLATION);
    // 'committed' is an intent state, equally meaningless for settlement.
    expect(
      await failureCode(`update transaction set settlement_state = 'committed' where id = '${id}'`),
    ).toBe(CHECK_VIOLATION);
  });

  it("starts committed and not_started, which are independent defaults", async () => {
    const id = await insertTransaction();
    const [row] = await rows<{ intent_state: string; settlement_state: string }>(
      `select intent_state, settlement_state from transaction where id = '${id}'`,
    );
    expect(row).toEqual({ intent_state: "committed", settlement_state: "not_started" });
  });
});

describe("a transaction belongs to exactly one approved request", () => {
  it("refuses a second transaction for the same request", async () => {
    const requestId = await anApprovedRequest();
    await insertTransaction({ request_id: `'${requestId}'` });
    expect(
      await failureCode(
        `insert into transaction (request_id, relationship_id, amount_minor, amount_currency,
                                  approved_by)
         values ('${requestId}', '${seed.relationshipId}', 5000, 'USD', '${seed.senderId}')`,
      ),
    ).toBe(UNIQUE_VIOLATION);
  });

  it("refuses a transaction for a declined request", async () => {
    // PRD invariant 3, now enforceable: before 0007 there was no link between
    // a request and a transaction, so there was nothing to constrain.
    expect(
      await failureCode(
        `insert into transaction (request_id, relationship_id, amount_minor, amount_currency,
                                  approved_by)
         values ('${seed.declinedRequestId}', '${seed.relationshipId}', 5000, 'USD',
                 '${seed.senderId}')`,
      ),
    ).toBe(DECLINED_REQUEST);
  });

  it("refuses a transaction for a pending request", async () => {
    expect(
      await failureCode(
        `insert into transaction (request_id, relationship_id, amount_minor, amount_currency,
                                  approved_by)
         values ('${seed.pendingRequestId}', '${seed.relationshipId}', 5000, 'USD',
                 '${seed.senderId}')`,
      ),
    ).toBe(DECLINED_REQUEST);
  });

  it("requires the request to exist", async () => {
    expect(
      await failureCode(
        `insert into transaction (request_id, relationship_id, amount_minor, amount_currency,
                                  approved_by)
         values ('00000000-0000-4000-8000-000000000000', '${seed.relationshipId}', 5000, 'USD',
                 '${seed.senderId}')`,
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("requires an approver", async () => {
    expect(
      await failureCode(
        `insert into transaction (request_id, relationship_id, amount_minor, amount_currency)
         values ('${await anApprovedRequest()}', '${seed.relationshipId}', 5000, 'USD')`,
      ),
    ).toBe(NOT_NULL_VIOLATION);
  });
});

describe("money and rate columns", () => {
  it("refuses a non-positive amount", async () => {
    await expect(insertTransaction({ amount_minor: "0" })).rejects.toThrow();
    await expect(insertTransaction({ amount_minor: "-1" })).rejects.toThrow();
  });

  it("refuses an unsupported currency", async () => {
    await expect(insertTransaction({ amount_currency: "'EUR'" })).rejects.toThrow();
  });

  it("stores the applied FX rate as exact numeric, not a float", async () => {
    const types = await rows<{ data_type: string }>(
      `select data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'transaction'
          and column_name = 'fx_rate_applied'`,
    );
    // double precision would make a disclosed rate and an applied rate differ
    // in the last place, which is exactly the number a customer can check.
    expect(types[0]?.data_type).toBe("numeric");
  });

  it("refuses a non-positive FX rate", async () => {
    await expect(insertTransaction({ fx_rate_applied: "0" })).rejects.toThrow();
  });

  it("refuses a fee amount without a currency", async () => {
    await expect(insertTransaction({ fee_minor: "100" })).rejects.toThrow();
  });

  it("accepts a fee with its currency", async () => {
    await expect(
      insertTransaction({ fee_minor: "100", fee_currency: "'USD'" }),
    ).resolves.toBeTruthy();
  });

  it("refuses a negative fee", async () => {
    await expect(insertTransaction({ fee_minor: "-1", fee_currency: "'USD'" })).rejects.toThrow();
  });

  it("refuses a recipient amount without a currency", async () => {
    await expect(insertTransaction({ recipient_amount_minor: "4900" })).rejects.toThrow();
  });
});

describe("the state pair guard", () => {
  it("refuses cancelling intent once settlement has left not_started", async () => {
    const id = await insertTransaction({ settlement_state: "'instructed'" });
    expect(
      await failureCode(`update transaction set intent_state = 'cancelled' where id = '${id}'`),
    ).toBe(STATE_PAIR_VIOLATION);
  });

  it("allows cancelling intent while settlement has not started", async () => {
    const id = await insertTransaction();
    // Still refused, but by the audit trigger rather than the pair guard:
    // the move is legal, it just has to be recorded.
    expect(
      await failureCode(`update transaction set intent_state = 'cancelled' where id = '${id}'`),
    ).toBe(AUDIT_REQUIRED);
  });

  it("refuses advancing settlement once intent is cancelled", async () => {
    const id = await insertTransaction({ intent_state: "'cancelled'" });
    expect(
      await failureCode(
        `update transaction set settlement_state = 'instructed' where id = '${id}'`,
      ),
    ).toBe(STATE_PAIR_VIOLATION);
  });

  it("refuses a row born cancelled with settlement already under way", async () => {
    await expect(
      insertTransaction({ intent_state: "'cancelled'", settlement_state: "'settled'" }),
    ).rejects.toThrow();
  });
});

describe("status changes need audit rows", () => {
  for (const [field, value] of [
    ["intent_state", "cancelled"],
    ["settlement_state", "instructed"],
  ] as const) {
    it(`refuses a bare ${field} update`, async () => {
      const id = await insertTransaction();
      expect(
        await failureCode(`update transaction set ${field} = '${value}' where id = '${id}'`),
      ).toBe(AUDIT_REQUIRED);
    });
  }

  it("accepts a settlement move written with its audit row", async () => {
    const id = await insertTransaction();
    const failed = await withClient(async (client) => {
      await client.query("begin");
      try {
        await client.query(`update transaction set settlement_state = 'instructed' where id = $1`, [
          id,
        ]);
        await client.query(
          `insert into audit_log (actor_id, actor_kind, action, entity_type, entity_id,
                                  before_state, after_state)
           values (null, 'system', 'transaction.instruct', 'transaction_settlement', $1,
                   '{"state":"not_started"}'::jsonb, '{"state":"instructed"}'::jsonb)`,
          [id],
        );
        await client.query("commit");
        return undefined;
      } catch (error) {
        await client.query("rollback");
        return errorCode(error);
      }
    });
    expect(failed).toBeUndefined();
  });

  it("does not accept an intent audit row as cover for a settlement move", async () => {
    // The two fields are audited under their own entity types, so a row for
    // one cannot authorise a change to the other.
    const id = await insertTransaction();
    const failed = await withClient(async (client) => {
      await client.query("begin");
      try {
        await client.query(`update transaction set settlement_state = 'instructed' where id = $1`, [
          id,
        ]);
        await client.query(
          `insert into audit_log (actor_id, actor_kind, action, entity_type, entity_id,
                                  before_state, after_state)
           values (null, 'system', 'transaction.instruct', 'transaction_intent', $1,
                   '{"state":"committed"}'::jsonb, '{"state":"instructed"}'::jsonb)`,
          [id],
        );
        await client.query("commit");
        return undefined;
      } catch (error) {
        await client.query("rollback");
        return errorCode(error);
      }
    });
    expect(failed).toBe(AUDIT_REQUIRED);
  });
});

describe("the agreement is frozen", () => {
  const FROZEN: Record<string, string> = {
    request_id: "null",
    relationship_id: "null",
    amount_minor: "9999",
    amount_currency: "'GTQ'",
    approved_by: "null",
  };

  for (const [column, value] of Object.entries(FROZEN)) {
    it(`refuses an update to ${column}`, async () => {
      const id = await insertTransaction();
      expect(
        await failureCode(`update transaction set ${column} = ${value} where id = '${id}'`),
      ).toBe("TX003");
    });
  }

  it("does not freeze the settlement provider fields", async () => {
    // The control: these are filled in when a provider is called, so freezing
    // everything would make the table useless the moment P3 lands.
    const id = await insertTransaction();
    expect(
      await failureCode(
        `update transaction set settlement_provider = 'mock',
                                provider_reference_id = 'abc123' where id = '${id}'`,
      ),
    ).toBeUndefined();
  });
});

describe("grants", () => {
  it("does not let the app role delete a transaction", async () => {
    const id = await insertTransaction();
    expect(await failureCode(`delete from transaction where id = '${id}'`, { role: "app" })).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("does not let even the owner delete a transaction", async () => {
    const id = await insertTransaction();
    expect(await failureCode(`delete from transaction where id = '${id}'`)).toBe("TX003");
  });

  it("does not let the app role truncate transactions", async () => {
    expect(await failureCode("truncate transaction", { role: "app" })).toBe(INSUFFICIENT_PRIVILEGE);
  });
});
