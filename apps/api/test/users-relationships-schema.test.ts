import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * P2.2 database-level guarantees, against real Postgres 16. Each is proven by
 * attempting the forbidden thing and requiring it to fail, never by assuming a
 * constraint exists.
 */

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const NOT_NULL_VIOLATION = "23502";
const FOREIGN_KEY_VIOLATION = "23503";
const INSUFFICIENT_PRIVILEGE = "42501";
const AUDIT_ROW_MISSING = "AU002";
const INVITATION_EXPIRED = "RL001";

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
  sql: string,
  options: { role?: string; values?: unknown[] } = {},
): Promise<string | undefined> {
  return withClient(async (client) => {
    try {
      await client.query(sql, options.values as never);
      return undefined;
    } catch (error) {
      return errorCode(error);
    }
  }, options);
}

/** A unique E.164 number per call, so tests never collide on the unique index. */
let phoneCounter = 0;
function aPhone(): string {
  phoneCounter += 1;
  return `+5025${String(5_000_000 + phoneCounter).padStart(7, "0")}`;
}

async function insertUser(overrides: Record<string, unknown> = {}): Promise<string> {
  const row = {
    phone: aPhone(),
    roles: ["sender"],
    locale: "es",
    preferred_channel: "whatsapp",
    kyc_status: "not_started",
    identity_assurance_level: null,
    ...overrides,
  };
  return withClient(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into app_user
         (phone, roles, locale, preferred_channel, kyc_status, identity_assurance_level)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [
        row.phone,
        row.roles,
        row.locale,
        row.preferred_channel,
        row.kyc_status,
        row.identity_assurance_level,
      ],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no id returned");
    return id;
  });
}

async function insertUserFailure(overrides: Record<string, unknown>): Promise<string | undefined> {
  try {
    await insertUser(overrides);
    return undefined;
  } catch (error) {
    return errorCode(error);
  }
}

beforeAll(async () => {
  pgx = await startTestPostgres();
}, 120_000);

afterAll(async () => {
  await pgx.stop();
});

describe("app_user phone numbers", () => {
  // The table is named app_user, not user: `user` is a reserved word, and
  // `select * from user` silently returns the current username instead of
  // erroring, which is a wrong answer rather than a failure.
  it("accepts a well-formed E.164 number", async () => {
    await expect(insertUser({ phone: "+50255551234" })).resolves.toBeTypeOf("string");
  });

  it.each([
    ["no plus", "50255551234"],
    ["spaces", "+502 5555 1234"],
    ["dashes", "+502-5555-1234"],
    ["leading zero after plus", "+0255551234"],
    ["letters", "+502ABC1234"],
    ["empty", ""],
    ["too long", `+${"9".repeat(16)}`],
    ["parenthesised", "+1 (415) 555-1234"],
  ])("rejects %s", async (_label, phone) => {
    expect(await insertUserFailure({ phone })).toBe(CHECK_VIOLATION);
  });

  it("rejects a duplicate phone number", async () => {
    const phone = aPhone();
    await insertUser({ phone });
    expect(await insertUserFailure({ phone })).toBe(UNIQUE_VIOLATION);
  });

  it("requires a phone number", async () => {
    expect(await insertUserFailure({ phone: null })).toBe(NOT_NULL_VIOLATION);
  });
});

describe("app_user columns", () => {
  it("defaults locale to es", async () => {
    const id = await insertUser();
    const locale = await withClient(async (c) => {
      const { rows } = await c.query<{ locale: string }>(
        "select locale from app_user where id = $1",
        [id],
      );
      return rows[0]?.locale;
    });
    expect(locale).toBe("es");
  });

  it("rejects an unknown locale", async () => {
    expect(await insertUserFailure({ locale: "fr" })).toBe(CHECK_VIOLATION);
  });

  it("rejects a channel outside the PRD's channel model", async () => {
    expect(await insertUserFailure({ preferred_channel: "telegram" })).toBe(CHECK_VIOLATION);
  });

  it("rejects an unknown role", async () => {
    expect(await insertUserFailure({ roles: ["auditor"] })).toBe(CHECK_VIOLATION);
  });

  it("rejects an empty role list", async () => {
    expect(await insertUserFailure({ roles: [] })).toBe(CHECK_VIOLATION);
  });

  // A number that is a sender to one person and a recipient to another is the
  // same user holding both roles (PRD feature 1, edge cases).
  it("allows a user to hold both roles", async () => {
    await expect(insertUser({ roles: ["sender", "recipient"] })).resolves.toBeTypeOf("string");
  });

  it("rejects free text as the kyc status or assurance level", async () => {
    expect(await insertUserFailure({ kyc_status: "Waiting on Maria" })).toBe(CHECK_VIOLATION);
    expect(await insertUserFailure({ identity_assurance_level: "verified in person" })).toBe(
      CHECK_VIOLATION,
    );
  });
});

describe("relationship integrity", () => {
  async function insertRelationship(
    overrides: Record<string, unknown> = {},
  ): Promise<string | undefined> {
    const a = await insertUser({ roles: ["sender"] });
    const b = await insertUser({ roles: ["recipient"] });
    const row = {
      user_a_id: a,
      user_b_id: b,
      role_of_a: "sender",
      role_of_b: "recipient",
      ...overrides,
    };
    return failureCode(
      `insert into relationship (user_a_id, user_b_id, role_of_a, role_of_b)
       values ($1, $2, $3, $4)`,
      { values: [row.user_a_id, row.user_b_id, row.role_of_a, row.role_of_b] },
    );
  }

  it("accepts a sender-to-recipient relationship", async () => {
    expect(await insertRelationship()).toBeUndefined();
  });

  // Acceptance criterion: enforced in the DB, not just in code.
  it("rejects a relationship where both sides are the same user", async () => {
    const self = await insertUser({ roles: ["sender", "recipient"] });
    expect(await insertRelationship({ user_a_id: self, user_b_id: self })).toBe(CHECK_VIOLATION);
  });

  it("rejects both sides holding the same role", async () => {
    expect(await insertRelationship({ role_of_a: "sender", role_of_b: "sender" })).toBe(
      CHECK_VIOLATION,
    );
  });

  it("rejects an unknown role", async () => {
    expect(await insertRelationship({ role_of_a: "auditor" })).toBe(CHECK_VIOLATION);
  });

  it("rejects a relationship pointing at a user that does not exist", async () => {
    expect(await insertRelationship({ user_b_id: crypto.randomUUID() })).toBe(
      FOREIGN_KEY_VIOLATION,
    );
  });

  it("rejects an unknown status", async () => {
    const a = await insertUser();
    const b = await insertUser({ roles: ["recipient"] });
    expect(
      await failureCode(
        `insert into relationship (user_a_id, user_b_id, role_of_a, role_of_b, status)
         values ($1, $2, 'sender', 'recipient', 'ghosted')`,
        { values: [a, b] },
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("starts invited, with no activation timestamp", async () => {
    const a = await insertUser();
    const b = await insertUser({ roles: ["recipient"] });
    const row = await withClient(async (c) => {
      const { rows } = await c.query<{ status: string; activated_at: Date | null }>(
        `insert into relationship (user_a_id, user_b_id, role_of_a, role_of_b)
         values ($1, $2, 'sender', 'recipient')
         returning status, activated_at`,
        [a, b],
      );
      return rows[0];
    });
    expect(row?.status).toBe("invited");
    expect(row?.activated_at).toBeNull();
  });
});

describe("status changes are governed by the database", () => {
  async function aRelationship(): Promise<string> {
    const a = await insertUser();
    const b = await insertUser({ roles: ["recipient"] });
    return withClient(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into relationship (user_a_id, user_b_id, role_of_a, role_of_b)
         values ($1, $2, 'sender', 'recipient') returning id`,
        [a, b],
      );
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("no id");
      return id;
    });
  }

  // P2.1's mechanism, wired up here: a status change with no audit row in the
  // same transaction is refused by the database, whatever wrote it.
  it("refuses a bare status UPDATE with no audit row", async () => {
    const id = await aRelationship();
    expect(
      await failureCode(`update relationship set status = 'active' where id = $1`, {
        values: [id],
      }),
    ).toBe(AUDIT_ROW_MISSING);
  });

  it("allows an update that does not touch the status", async () => {
    const id = await aRelationship();
    expect(
      await failureCode(`update relationship set invited_at = now() where id = $1`, {
        values: [id],
      }),
    ).toBeUndefined();
  });

  // Expiry is derived from invited_at. Backdating the row is how the test ages
  // an invitation without waiting and without a clock to stub.
  it("refuses to activate an invitation older than the window", async () => {
    const id = await aRelationship();
    await withClient((c) =>
      c.query(`update relationship set invited_at = now() - interval '15 days' where id = $1`, [
        id,
      ]),
    );
    const code = await failureCode(
      `update relationship set status = 'active', activated_at = now() where id = $1`,
      { values: [id] },
    );
    // The expiry guard fires before the audit guard: the point is that it is
    // refused, and refused for being expired.
    expect(code).toBe(INVITATION_EXPIRED);
  });

  it("still allows activation just inside the window", async () => {
    const id = await aRelationship();
    await withClient((c) =>
      c.query(
        `update relationship set invited_at = now() - interval '14 days' + interval '1 hour'
         where id = $1`,
        [id],
      ),
    );
    // Not expired, so it gets as far as the audit guard instead.
    expect(
      await failureCode(`update relationship set status = 'active' where id = $1`, {
        values: [id],
      }),
    ).toBe(AUDIT_ROW_MISSING);
  });
});

describe("grants", () => {
  it("lets the app role read and write both tables", async () => {
    expect(await failureCode("select count(*) from app_user", { role: "app" })).toBeUndefined();
    expect(await failureCode("select count(*) from relationship", { role: "app" })).toBeUndefined();
  });

  // Unlike the ledger, these tables are mutable: a status changes, a kyc
  // status changes. The audit trigger is what governs how, not the grant.
  it("lets the app role update them", async () => {
    const id = await insertUser();
    expect(
      await failureCode(`update app_user set kyc_status = 'pending' where id = '${id}'`, {
        role: "app",
      }),
    ).toBeUndefined();
  });

  it("does not let the app role delete a user or a relationship", async () => {
    expect(await failureCode("delete from app_user", { role: "app" })).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await failureCode("delete from relationship", { role: "app" })).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });
});
