import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * P2.1 acceptance criterion 1: UPDATE, DELETE and TRUNCATE on `audit_log` all
 * fail, as both `app` and owner.
 *
 * Everything here runs against a real Postgres 16. The guards under test are
 * triggers, grants and check constraints; a mock would assert nothing about
 * whether they exist. Each guard is proven by attempting the forbidden
 * operation and requiring it to fail, never by assuming the trigger fired.
 */

const APPEND_ONLY_VIOLATION = "AU001";
const INSUFFICIENT_PRIVILEGE = "42501";
const CHECK_VIOLATION = "23514";
const NOT_NULL_VIOLATION = "23502";

interface PostgresError extends Error {
  readonly code?: string;
}

function errorCode(error: unknown): string | undefined {
  return (error as PostgresError | undefined)?.code;
}

let pgx: TestPostgres;

/** A dedicated connection, so BEGIN/COMMIT and SET ROLE stay on one session. */
async function withClient<T>(
  fn: (client: pg.Client) => Promise<T>,
  options: { role?: string } = {},
): Promise<T> {
  const client = new pg.Client({ connectionString: pgx.connectionString });
  await client.connect();
  try {
    if (options.role !== undefined) {
      await client.query(`set role ${options.role}`);
    }
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Run `sql` and return the SQLSTATE it fails with, or undefined if it succeeds. */
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

/** Insert one audit row as the owner and return its id. */
async function insertAuditRow(overrides: Record<string, unknown> = {}): Promise<string> {
  const row = {
    actor_id: crypto.randomUUID(),
    actor_kind: "user",
    action: "widget.activate",
    entity_type: "widget",
    entity_id: crypto.randomUUID(),
    channel: "whatsapp",
    assurance_level: null,
    before_state: JSON.stringify({ state: "invited" }),
    after_state: JSON.stringify({ state: "active" }),
    ...overrides,
  };

  return withClient(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into audit_log
         (actor_id, actor_kind, action, entity_type, entity_id, channel,
          assurance_level, before_state, after_state)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [
        row.actor_id,
        row.actor_kind,
        row.action,
        row.entity_type,
        row.entity_id,
        row.channel,
        row.assurance_level,
        row.before_state,
        row.after_state,
      ],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("insert returned no id");
    return id;
  });
}

/** Attempt an insert with one column overridden, and report the SQLSTATE. */
async function insertFailureCode(overrides: Record<string, unknown>): Promise<string | undefined> {
  try {
    await insertAuditRow(overrides);
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

describe("audit_log append-only enforcement", () => {
  // The owner is stopped by the trigger; the app role is stopped earlier, by
  // the missing grant. Both are asserted because either alone leaves a hole.
  it("rejects UPDATE as the owner", async () => {
    await insertAuditRow();
    expect(await failureCode("update audit_log set action = 'widget.tampered'")).toBe(
      APPEND_ONLY_VIOLATION,
    );
  });

  it("rejects DELETE as the owner", async () => {
    await insertAuditRow();
    expect(await failureCode("delete from audit_log")).toBe(APPEND_ONLY_VIOLATION);
  });

  it("rejects TRUNCATE as the owner", async () => {
    await insertAuditRow();
    expect(await failureCode("truncate audit_log cascade")).toBe(APPEND_ONLY_VIOLATION);
  });

  it("rejects UPDATE as the app role", async () => {
    expect(
      await failureCode("update audit_log set action = 'widget.tampered'", { role: "app" }),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("rejects DELETE as the app role", async () => {
    expect(await failureCode("delete from audit_log", { role: "app" })).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("rejects TRUNCATE as the app role", async () => {
    expect(await failureCode("truncate audit_log cascade", { role: "app" })).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });

  // A row-level trigger never fires on an empty table, so a statement-level
  // trigger is the only kind that refuses a no-op DELETE. Without this the
  // guard would only protect a table that happens to be non-empty.
  it("rejects a DELETE that would match no rows", async () => {
    expect(await failureCode("delete from audit_log where 1 = 0")).toBe(APPEND_ONLY_VIOLATION);
  });

  it("rejects an UPDATE that would match no rows", async () => {
    expect(await failureCode("update audit_log set action = 'x.y' where 1 = 0")).toBe(
      APPEND_ONLY_VIOLATION,
    );
  });

  it("still allows the app role to INSERT and SELECT", async () => {
    const insertCode = await failureCode(
      `insert into audit_log (actor_id, actor_kind, action, entity_type, entity_id, after_state)
       values (gen_random_uuid(), 'user', 'widget.activate', 'widget', gen_random_uuid(),
               '{"state":"active"}'::jsonb)`,
      { role: "app" },
    );
    expect(insertCode).toBeUndefined();
    expect(await failureCode("select count(*) from audit_log", { role: "app" })).toBeUndefined();
  });
});

describe("audit_log rejects PII-shaped values", () => {
  // CLAUDE.md rule 5 and the P2.1 ticket: audit rows carry entity ids and
  // state names, never phone numbers, names or amounts in free text. The
  // columns that could carry free text are constrained to identifier shapes,
  // so a phone number or a person's name cannot be stored in the first place.
  it("rejects a phone number as the action", async () => {
    expect(await insertFailureCode({ action: "+50255551234" })).toBe(CHECK_VIOLATION);
  });

  it("rejects free text as the action", async () => {
    expect(await insertFailureCode({ action: "Maria approved 250 USD" })).toBe(CHECK_VIOLATION);
  });

  it("rejects free text as the entity type", async () => {
    expect(await insertFailureCode({ entity_type: "Maria Lopez" })).toBe(CHECK_VIOLATION);
  });

  it("rejects a state object carrying anything but a state name", async () => {
    expect(
      await insertFailureCode({
        after_state: JSON.stringify({ state: "active", phone: "+50255551234" }),
      }),
    ).toBe(CHECK_VIOLATION);
  });

  it("rejects a free-text state name", async () => {
    expect(await insertFailureCode({ after_state: JSON.stringify({ state: "Maria Lopez" }) })).toBe(
      CHECK_VIOLATION,
    );
  });

  it("rejects a bare string in place of a state object", async () => {
    expect(await insertFailureCode({ after_state: JSON.stringify("active") })).toBe(
      CHECK_VIOLATION,
    );
  });

  it("accepts a well-formed state object", async () => {
    await expect(
      insertAuditRow({ after_state: JSON.stringify({ state: "terminated" }) }),
    ).resolves.toBeTypeOf("string");
  });
});

describe("audit_log column constraints", () => {
  it("rejects an unknown actor kind", async () => {
    expect(await insertFailureCode({ actor_kind: "robot" })).toBe(CHECK_VIOLATION);
  });

  it("accepts each declared actor kind", async () => {
    expect(await insertFailureCode({ actor_kind: "user" })).toBeUndefined();
    expect(await insertFailureCode({ actor_kind: "agent" })).toBeUndefined();
    expect(await insertFailureCode({ actor_kind: "system", actor_id: null })).toBeUndefined();
  });

  it("requires an actor id for a user or agent, but not for the system", async () => {
    expect(await insertFailureCode({ actor_kind: "user", actor_id: null })).toBe(CHECK_VIOLATION);
    expect(await insertFailureCode({ actor_kind: "agent", actor_id: null })).toBe(CHECK_VIOLATION);
    expect(await insertFailureCode({ actor_kind: "system", actor_id: null })).toBeUndefined();
  });

  it("rejects a channel outside the PRD's channel model", async () => {
    expect(await insertFailureCode({ channel: "telegram" })).toBe(CHECK_VIOLATION);
  });

  it("accepts each channel in the PRD's channel model", async () => {
    for (const channel of ["app", "whatsapp", "sms"]) {
      expect(await insertFailureCode({ channel })).toBeUndefined();
    }
  });

  // A system-originated transition has no channel, and a creation event has no
  // prior state. Both are legitimately absent rather than empty strings.
  it("allows a null channel and a null before_state", async () => {
    expect(await insertFailureCode({ channel: null, before_state: null })).toBeUndefined();
  });

  it("requires an after_state", async () => {
    expect(await insertFailureCode({ after_state: null })).toBe(NOT_NULL_VIOLATION);
  });

  // PRD section 9 lists assurance_level on AuditLog; the P2.1 ticket omits it.
  // Because the table is append-only a column added later can never be
  // backfilled, so it is created now, nullable until Feature 5 defines its
  // values. No CHECK, because the PRD does not enumerate them and this ticket
  // must not invent business rules.
  it("carries a nullable assurance_level", async () => {
    expect(await insertFailureCode({ assurance_level: null })).toBeUndefined();
    expect(await insertFailureCode({ assurance_level: "step_up" })).toBeUndefined();
  });

  it("rejects free text as the assurance level", async () => {
    expect(await insertFailureCode({ assurance_level: "Maria, in person" })).toBe(CHECK_VIOLATION);
  });

  it("orders history by seq, which is gapless per insert and monotonic", async () => {
    const entity = crypto.randomUUID();
    await insertAuditRow({ entity_id: entity, after_state: JSON.stringify({ state: "invited" }) });
    await insertAuditRow({ entity_id: entity, after_state: JSON.stringify({ state: "active" }) });

    const states = await withClient(async (client) => {
      const { rows } = await client.query<{ state: string }>(
        `select after_state->>'state' as state
           from audit_log where entity_id = $1 order by seq`,
        [entity],
      );
      return rows.map((r) => r.state);
    });

    expect(states).toEqual(["invited", "active"]);
  });
});
