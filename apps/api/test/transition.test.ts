import fc from "fast-check";
import { sql, type Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  UndeclaredTransitionError,
  defineStateMachine,
  transition,
  type AuditDatabase,
} from "../src/audit/index.js";
import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * P2.1 acceptance criteria 2 to 4. Every assertion runs against a real
 * Postgres 16: the guarantee under test is that a state change and its audit
 * row commit together or not at all, which is a property of the database
 * transaction and cannot be observed against a mock.
 *
 * The state table here is local to this test. P2.1 adds no state machines of
 * its own — it adds the mechanism the four Phase 2 machines will use — so the
 * mechanism is proven against a table that stands in for them.
 */

const AUDIT_ROW_MISSING = "AU002";

interface PostgresError extends Error {
  readonly code?: string;
}

function errorCode(error: unknown): string | undefined {
  return (error as PostgresError | undefined)?.code;
}

type WidgetState = "invited" | "active" | "paused" | "terminated";

interface WidgetTable {
  id: string;
  status: WidgetState;
}

interface TestDb extends AuditDatabase {
  widget: WidgetTable;
}

/** Deliberately not a complete graph: `terminated` is terminal, and there is
 *  no direct `invited -> terminated` edge, so undeclared edges exist to test. */
const widgetMachine = defineStateMachine<WidgetState>({
  entityType: "widget",
  transitions: {
    invited: ["active", "paused"],
    active: ["paused", "terminated"],
    paused: ["active", "terminated"],
    terminated: [],
  },
});

let pgx: TestPostgres;
let db: Kysely<TestDb>;

/** A fresh widget in `invited`, created without going through transition(). */
async function aWidget(state: WidgetState = "invited"): Promise<string> {
  const row = await db
    .insertInto("widget")
    .values({ id: crypto.randomUUID(), status: state })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function statusOf(id: string): Promise<WidgetState | undefined> {
  const row = await db
    .selectFrom("widget")
    .select("status")
    .where("id", "=", id)
    .executeTakeFirst();
  return row?.status;
}

async function auditRowsFor(entityId: string): Promise<{ before: string | null; after: string }[]> {
  const rows = await db
    .selectFrom("audit_log")
    .select([
      sql<string | null>`before_state->>'state'`.as("before"),
      sql<string>`after_state->>'state'`.as("after"),
    ])
    .where("entity_id", "=", entityId)
    .orderBy("seq")
    .execute();
  return rows;
}

/** Move a widget, writing the state change and its audit row together. */
async function move(
  id: string,
  from: WidgetState,
  to: WidgetState,
  options: { actorId?: string } = {},
): Promise<void> {
  await transition(
    db,
    widgetMachine,
    {
      entityId: id,
      from,
      to,
      action: `widget.${to}`,
      actor: { kind: "user", id: options.actorId ?? crypto.randomUUID() },
      channel: "whatsapp",
    },
    async (trx) => {
      await trx.updateTable("widget").set({ status: to }).where("id", "=", id).execute();
    },
  );
}

beforeAll(async () => {
  pgx = await startTestPostgres();
  db = pgx.kysely<TestDb>();

  await sql`
    create table widget (
      id     uuid primary key,
      status text not null
    )
  `.execute(db);

  // One line is all a Phase 2 state table needs to opt in. From here on the
  // database itself refuses a status change that has no audit row.
  await sql`select audit_enforce_transitions('widget', 'status', 'widget')`.execute(db);
}, 120_000);

afterAll(async () => {
  await pgx.stop();
});

describe("an undeclared transition", () => {
  it("throws UndeclaredTransitionError", async () => {
    const id = await aWidget("invited");
    await expect(move(id, "invited", "terminated")).rejects.toThrow(UndeclaredTransitionError);
  });

  it("names the edge it refused", async () => {
    const id = await aWidget("invited");
    await expect(move(id, "invited", "terminated")).rejects.toThrow(
      /widget.*invited.*terminated/is,
    );
  });

  it("refuses to leave a terminal state", async () => {
    const id = await aWidget("terminated");
    await expect(move(id, "terminated", "active")).rejects.toThrow(UndeclaredTransitionError);
  });

  it("refuses a self-transition that is not declared", async () => {
    const id = await aWidget("active");
    await expect(move(id, "active", "active")).rejects.toThrow(UndeclaredTransitionError);
  });

  // Acceptance criterion 2: "throws and writes nothing". Both halves.
  it("writes neither the state change nor an audit row", async () => {
    const id = await aWidget("invited");

    await expect(move(id, "invited", "terminated")).rejects.toThrow(UndeclaredTransitionError);

    expect(await statusOf(id)).toBe("invited");
    expect(await auditRowsFor(id)).toEqual([]);
  });
});

describe("a declared transition", () => {
  it("applies the state change and records exactly one audit row", async () => {
    const id = await aWidget("invited");
    await move(id, "invited", "active");

    expect(await statusOf(id)).toBe("active");
    expect(await auditRowsFor(id)).toEqual([{ before: "invited", after: "active" }]);
  });

  it("records the actor, action and channel", async () => {
    const id = await aWidget("invited");
    const actorId = crypto.randomUUID();
    await move(id, "invited", "active", { actorId });

    const row = await db
      .selectFrom("audit_log")
      .select(["actor_id", "actor_kind", "action", "entity_type", "channel"])
      .where("entity_id", "=", id)
      .executeTakeFirstOrThrow();

    expect(row).toEqual({
      actor_id: actorId,
      actor_kind: "user",
      action: "widget.active",
      entity_type: "widget",
      channel: "whatsapp",
    });
  });

  it("records a chain of transitions in order", async () => {
    const id = await aWidget("invited");
    await move(id, "invited", "active");
    await move(id, "active", "paused");
    await move(id, "paused", "terminated");

    expect(await auditRowsFor(id)).toEqual([
      { before: "invited", after: "active" },
      { before: "active", after: "paused" },
      { before: "paused", after: "terminated" },
    ]);
  });
});

/**
 * Acceptance criterion 3. The audit insert is sabotaged at the database — a
 * trigger that raises on any insert into audit_log — so the real transition()
 * path runs against a real failure rather than an injected fake.
 */
describe("atomicity: the state change cannot commit without its audit row", () => {
  afterEach(async () => {
    await sql`drop trigger if exists sabotage_audit_insert on audit_log`.execute(db);
  });

  async function sabotageAuditInsert(): Promise<void> {
    await sql`
      create or replace function sabotage_audit_insert() returns trigger
      language plpgsql as $$
      begin
        raise exception 'sabotaged audit insert' using errcode = 'ZZ001';
      end
      $$
    `.execute(db);
    await sql`
      create trigger sabotage_audit_insert
        before insert on audit_log
        for each row execute function sabotage_audit_insert()
    `.execute(db);
  }

  it("rolls the state change back when the audit insert fails", async () => {
    const id = await aWidget("invited");
    await sabotageAuditInsert();

    // Read the row back inside the doomed transaction. Without this the test
    // would pass just as happily if transition() wrote the audit row first and
    // never reached the state change at all — there would be nothing to roll
    // back, and "still invited" would prove nothing.
    let seenInsideTransaction: WidgetState | undefined;

    await expect(
      transition(
        db,
        widgetMachine,
        {
          entityId: id,
          from: "invited",
          to: "active",
          action: "widget.active",
          actor: { kind: "user", id: crypto.randomUUID() },
        },
        async (trx) => {
          await trx.updateTable("widget").set({ status: "active" }).where("id", "=", id).execute();
          const row = await trx
            .selectFrom("widget")
            .select("status")
            .where("id", "=", id)
            .executeTakeFirst();
          seenInsideTransaction = row?.status;
        },
      ),
    ).rejects.toThrow(/sabotaged audit insert/);

    // The state change really happened, and was really undone.
    expect(seenInsideTransaction).toBe("active");
    expect(await statusOf(id)).toBe("invited");
    expect(await auditRowsFor(id)).toEqual([]);
  });

  it("leaves an earlier committed transition intact", async () => {
    const id = await aWidget("invited");
    await move(id, "invited", "active");
    await sabotageAuditInsert();

    await expect(move(id, "active", "paused")).rejects.toThrow(/sabotaged audit insert/);

    expect(await statusOf(id)).toBe("active");
    expect(await auditRowsFor(id)).toEqual([{ before: "invited", after: "active" }]);
  });
});

/**
 * The other half of "impossible, not merely discouraged": transition() being
 * atomic only helps code that calls transition(). The database refuses a state
 * change that arrives any other way.
 */
describe("a state change that bypasses transition()", () => {
  it("is refused when no audit row accompanies it", async () => {
    const id = await aWidget("invited");

    const code = await db
      .transaction()
      .execute(async (trx) => {
        await trx.updateTable("widget").set({ status: "active" }).where("id", "=", id).execute();
        return undefined;
      })
      .then(() => undefined)
      .catch((error: unknown) => errorCode(error));

    expect(code).toBe(AUDIT_ROW_MISSING);
    expect(await statusOf(id)).toBe("invited");
  });

  it("is refused when the audit row is for a different state", async () => {
    const id = await aWidget("invited");

    const code = await db
      .transaction()
      .execute(async (trx) => {
        await trx.updateTable("widget").set({ status: "active" }).where("id", "=", id).execute();
        await trx
          .insertInto("audit_log")
          .values({
            actor_id: crypto.randomUUID(),
            actor_kind: "user",
            action: "widget.paused",
            entity_type: "widget",
            entity_id: id,
            before_state: JSON.stringify({ state: "invited" }),
            after_state: JSON.stringify({ state: "paused" }),
          })
          .execute();
      })
      .then(() => undefined)
      .catch((error: unknown) => errorCode(error));

    expect(code).toBe(AUDIT_ROW_MISSING);
    expect(await statusOf(id)).toBe("invited");
  });

  // An audit row from an earlier, committed transaction must not satisfy the
  // check for a later bare UPDATE, or the guard would be trivially defeated by
  // replaying an old state.
  it("is refused when the only matching audit row is from an earlier transaction", async () => {
    const id = await aWidget("invited");
    await move(id, "invited", "active");
    await move(id, "active", "paused");

    const code = await db
      .transaction()
      .execute(async (trx) => {
        await trx.updateTable("widget").set({ status: "active" }).where("id", "=", id).execute();
      })
      .then(() => undefined)
      .catch((error: unknown) => errorCode(error));

    expect(code).toBe(AUDIT_ROW_MISSING);
    expect(await statusOf(id)).toBe("paused");
  });

  // An UPDATE that does not touch the state column is not a transition, and
  // must not be forced to carry an audit row.
  it("allows an update that does not change the state", async () => {
    const id = await aWidget("invited");

    await expect(
      db.updateTable("widget").set({ status: "invited" }).where("id", "=", id).execute(),
    ).resolves.toBeDefined();
  });
});

/**
 * Acceptance criterion 4: for any random legal transition sequence, audit_log
 * row count equals the number of transitions.
 */
describe("property: one audit row per transition", () => {
  /** A legal path through the machine, as a list of edges. */
  const legalPath = fc.array(fc.nat(), { minLength: 0, maxLength: 12 }).map((choices) => {
    const edges: { from: WidgetState; to: WidgetState }[] = [];
    let current: WidgetState = "invited";
    for (const choice of choices) {
      const options: readonly WidgetState[] = widgetMachine.transitions[current];
      if (options.length === 0) break;
      const next: WidgetState | undefined = options[choice % options.length];
      if (next === undefined) break;
      edges.push({ from: current, to: next });
      current = next;
    }
    return edges;
  });

  it("holds for any legal sequence", async () => {
    await fc.assert(
      fc.asyncProperty(legalPath, async (edges) => {
        const id = await aWidget("invited");

        for (const edge of edges) {
          await move(id, edge.from, edge.to);
        }

        const rows = await auditRowsFor(id);
        expect(rows).toHaveLength(edges.length);
        expect(rows).toEqual(edges.map((e) => ({ before: e.from, after: e.to })));
        expect(await statusOf(id)).toBe(edges.at(-1)?.to ?? "invited");
      }),
      { numRuns: 25 },
    );
  });

  it("counts transitions across many entities, not just one", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(legalPath, { minLength: 1, maxLength: 4 }), async (paths) => {
        const ids = await Promise.all(paths.map(() => aWidget("invited")));

        let expected = 0;
        for (const [index, edges] of paths.entries()) {
          const id = ids[index];
          if (id === undefined) continue;
          for (const edge of edges) {
            await move(id, edge.from, edge.to);
          }
          expected += edges.length;
        }

        const counted = (
          await Promise.all(ids.map(async (id) => (await auditRowsFor(id)).length))
        ).reduce((a, b) => a + b, 0);

        expect(counted).toBe(expected);
      }),
      { numRuns: 10 },
    );
  });
});
