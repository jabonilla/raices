import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * P2.4 database-level guarantees.
 *
 * A request is the record of what somebody asked for. The ask is immutable:
 * only its resolution moves. Everything below is proven by attempting the
 * forbidden operation against real Postgres and requiring it to fail.
 */

const FROZEN_VIOLATION = "RQ001";
const AUDIT_REQUIRED = "AU002";
const CHECK_VIOLATION = "23514";
const NOT_NULL_VIOLATION = "23502";
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

let phoneCounter = 0;
function aPhone(): string {
  phoneCounter += 1;
  return `+5028${String(8_000_000 + phoneCounter).padStart(7, "0")}`;
}

interface Seed {
  readonly relationshipId: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly categoryId: string;
}

let seed: Seed;

/** A relationship, a plan version and a category, written directly in SQL. */
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

    const plan = await client.query<{ id: string }>(
      `insert into money_plan (relationship_id) values ($1) returning id`,
      [relationshipId],
    );
    const version = await client.query<{ id: string }>(
      `insert into plan_version (plan_id, version_number, created_by)
       values ($1, 1, $2) returning id`,
      [plan.rows[0]?.id, senderId],
    );
    const category = await client.query<{ id: string }>(
      `insert into category (plan_version_id, name, icon) values ($1, 'Housing', 'home')
       returning id`,
      [version.rows[0]?.id],
    );
    const categoryId = category.rows[0]?.id;
    if (categoryId === undefined) throw new Error("seed failed");

    return { relationshipId, senderId, recipientId, categoryId };
  });
}

/** Insert a pending request, returning its id. Overrides are raw SQL literals. */
async function insertRequest(overrides: Record<string, string> = {}): Promise<string> {
  const columns: Record<string, string> = {
    relationship_id: `'${seed.relationshipId}'`,
    requested_by: `'${seed.recipientId}'`,
    amount_minor: "5000",
    amount_currency: "'USD'",
    category_id: `'${seed.categoryId}'`,
    description: "'Renta'",
    tier: "'planned_investment'",
    channel_of_origin: "'whatsapp'",
    ...overrides,
  };
  const names = Object.keys(columns).join(", ");
  const values = Object.values(columns).join(", ");
  return withClient(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into request (${names}) values (${values}) returning id`,
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("insert returned no id");
    return id;
  });
}

/** Insert a request in a resolved state, bypassing the audit trigger. */
async function insertResolved(status: string, extra: Record<string, string>): Promise<string> {
  return insertRequest({ status: `'${status}'`, ...extra });
}

beforeAll(async () => {
  pgx = await startTestPostgres();
  seed = await seedFixture();
}, 180_000);

afterAll(async () => {
  await pgx.stop();
});

describe("request columns", () => {
  it("accepts a well-formed pending request", async () => {
    await expect(insertRequest()).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects a description over 200 characters", async () => {
    const code = await failureCode(
      `insert into request (relationship_id, requested_by, amount_minor, amount_currency,
                            category_id, description, tier, channel_of_origin)
       values ($1, $2, 5000, 'USD', $3, $4, 'planned_investment', 'app')`,
      { values: [seed.relationshipId, seed.recipientId, seed.categoryId, "a".repeat(201)] },
    );
    expect(code).toBe(CHECK_VIOLATION);
  });

  it("accepts a description of exactly 200 characters", async () => {
    await expect(insertRequest({ description: `'${"a".repeat(200)}'` })).resolves.toBeTruthy();
  });

  it("rejects an empty description", async () => {
    await expect(insertRequest({ description: "'   '" })).rejects.toThrow();
  });

  it("rejects a non-positive amount", async () => {
    await expect(insertRequest({ amount_minor: "0" })).rejects.toThrow();
    await expect(insertRequest({ amount_minor: "-1" })).rejects.toThrow();
  });

  it("rejects an unsupported currency", async () => {
    await expect(insertRequest({ amount_currency: "'EUR'" })).rejects.toThrow();
  });

  it("rejects an unknown tier", async () => {
    await expect(insertRequest({ tier: "'vip'" })).rejects.toThrow();
  });

  it("rejects an unknown status", async () => {
    await expect(insertRequest({ status: "'cancelled'" })).rejects.toThrow();
  });

  it("rejects an unknown channel of origin", async () => {
    await expect(insertRequest({ channel_of_origin: "'telegram'" })).rejects.toThrow();
  });

  it("allows a null category, which is how a request outside any plan is stored", async () => {
    await expect(insertRequest({ category_id: "null", tier: "'unrecognized'" })).resolves.toBeTruthy();
  });

  it("requires the relationship and the requester to exist", async () => {
    expect(
      await failureCode(
        `insert into request (relationship_id, requested_by, amount_minor, amount_currency,
                              description, tier, channel_of_origin)
         values ('00000000-0000-4000-8000-000000000000', $1, 100, 'USD', 'x',
                 'unrecognized', 'app')`,
        { values: [seed.recipientId] },
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("requires a tier", async () => {
    expect(
      await failureCode(
        `insert into request (relationship_id, requested_by, amount_minor, amount_currency,
                              description, channel_of_origin)
         values ($1, $2, 100, 'USD', 'x', 'app')`,
        { values: [seed.relationshipId, seed.recipientId] },
      ),
    ).toBe(NOT_NULL_VIOLATION);
  });
});

describe("decline reasons", () => {
  it("refuses a declined request with no reason", async () => {
    expect(
      await failureCode(
        `insert into request (relationship_id, requested_by, amount_minor, amount_currency,
                              description, tier, channel_of_origin, status,
                              resolved_by, resolved_at)
         values ($1, $2, 100, 'USD', 'x', 'unrecognized', 'app', 'declined', $3, now())`,
        { values: [seed.relationshipId, seed.recipientId, seed.senderId] },
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("refuses a declined request whose reason is only whitespace", async () => {
    await expect(
      insertResolved("declined", {
        resolved_by: `'${seed.senderId}'`,
        resolved_at: "now()",
        decline_reason: "'  '",
      }),
    ).rejects.toThrow();
  });

  it("refuses a decline reason over 200 characters", async () => {
    await expect(
      insertResolved("declined", {
        resolved_by: `'${seed.senderId}'`,
        resolved_at: "now()",
        decline_reason: `'${"a".repeat(201)}'`,
      }),
    ).rejects.toThrow();
  });

  it("accepts a declined request with a reason", async () => {
    await expect(
      insertResolved("declined", {
        resolved_by: `'${seed.senderId}'`,
        resolved_at: "now()",
        decline_reason: "'No este mes'",
      }),
    ).resolves.toBeTruthy();
  });

  it("refuses a decline reason on a request that is not declined", async () => {
    await expect(insertRequest({ decline_reason: "'No este mes'" })).rejects.toThrow();
    await expect(
      insertResolved("approved", {
        resolved_by: `'${seed.senderId}'`,
        resolved_at: "now()",
        decline_reason: "'No este mes'",
      }),
    ).rejects.toThrow();
  });
});

describe("resolution fields", () => {
  it("refuses a pending request that is already resolved", async () => {
    await expect(insertRequest({ resolved_at: "now()" })).rejects.toThrow();
    await expect(insertRequest({ resolved_by: `'${seed.senderId}'` })).rejects.toThrow();
  });

  it("refuses an approved request with no resolver", async () => {
    await expect(insertResolved("approved", { resolved_at: "now()" })).rejects.toThrow();
  });

  it("refuses an approved request with no resolution time", async () => {
    await expect(
      insertResolved("approved", { resolved_by: `'${seed.senderId}'` }),
    ).rejects.toThrow();
  });

  it("accepts an expired request with a time and no resolver, because no person expired it", async () => {
    await expect(insertResolved("expired", { resolved_at: "now()" })).resolves.toBeTruthy();
  });

  it("refuses an expired request attributed to a person", async () => {
    await expect(
      insertResolved("expired", { resolved_at: "now()", resolved_by: `'${seed.senderId}'` }),
    ).rejects.toThrow();
  });
});

describe("the ask is immutable", () => {
  const FROZEN: Record<string, string> = {
    amount_minor: "9999",
    amount_currency: "'GTQ'",
    category_id: "null",
    description: "'Otra cosa'",
    tier: "'recurring'",
    is_emergency: "true",
    requested_by: "requested_by",
    relationship_id: "relationship_id",
    channel_of_origin: "'sms'",
  };

  for (const [column, value] of Object.entries(FROZEN)) {
    it(`refuses an update to ${column}`, async () => {
      const id = await insertRequest();
      expect(
        await failureCode(`update request set ${column} = ${value} where id = '${id}'`),
      ).toBe(FROZEN_VIOLATION);
    });
  }

  it("refuses to clear an emergency flag after the fact", async () => {
    // PRD: "Emergency status cannot be applied retroactively." Removing one is
    // the same rewrite in the other direction.
    const id = await insertRequest({ is_emergency: "true" });
    expect(
      await failureCode(`update request set is_emergency = false where id = '${id}'`),
    ).toBe(FROZEN_VIOLATION);
  });

  it("allows the resolution fields to move", async () => {
    const id = await insertRequest();
    // Status is guarded separately by the audit trigger, so move only the
    // fields that travel with it.
    expect(
      await failureCode(`update request set resolved_at = now() where id = '${id}'`),
    ).toBeUndefined();
  });
});

describe("status changes need an audit row", () => {
  it("refuses a bare status update with no audit row in the same transaction", async () => {
    const id = await insertRequest();
    expect(
      await failureCode(
        `update request
            set status = 'approved', resolved_by = '${seed.senderId}', resolved_at = now()
          where id = '${id}'`,
      ),
    ).toBe(AUDIT_REQUIRED);
  });

  it("accepts the same update when an audit row is written alongside it", async () => {
    const id = await insertRequest();
    const failed = await withClient(async (client) => {
      await client.query("begin");
      try {
        await client.query(
          `update request
              set status = 'approved', resolved_by = $1, resolved_at = now()
            where id = $2`,
          [seed.senderId, id],
        );
        await client.query(
          `insert into audit_log (actor_id, actor_kind, action, entity_type, entity_id,
                                  before_state, after_state)
           values ($1, 'user', 'request.approve', 'request', $2,
                   '{"state":"pending"}'::jsonb, '{"state":"approved"}'::jsonb)`,
          [seed.senderId, id],
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
});

describe("grants", () => {
  it("does not let the app role delete a request", async () => {
    const id = await insertRequest();
    expect(
      await failureCode(`delete from request where id = '${id}'`, { role: "app" }),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("does not let the app role truncate requests", async () => {
    expect(await failureCode("truncate request", { role: "app" })).toBe(INSUFFICIENT_PRIVILEGE);
  });
});
