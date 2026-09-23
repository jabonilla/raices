import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

import { applyMigrations } from "../scripts/migrate.js";

const POSTGRES_IMAGE = "postgres:16-alpine";

/** Lowest and highest `server_version_num` in the Postgres 16 series. */
const MIN_SERVER_VERSION_NUM = 160000;
const MAX_SERVER_VERSION_NUM = 169999;

/** Only a database whose name ends in this may be migrated by the test suite. */
const REQUIRED_DATABASE_SUFFIX = "_test";

/**
 * Thrown when TEST_DATABASE_URL points somewhere the test suite must not touch.
 */
export class UnsafeTestDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTestDatabaseError";
  }
}

export interface TestDatabaseInfo {
  /** Postgres `server_version_num`, e.g. 160013 for 16.13. */
  readonly serverVersionNum: number;
  /** Result of `current_database()`. */
  readonly databaseName: string;
}

/**
 * Refuse any database that is not a Postgres 16 whose name ends in `_test`.
 *
 * `startTestPostgres` runs migrations, and a migration against someone's real
 * database is unrecoverable. A throwaway container is trusted because it is
 * created here and discarded; a connection string handed in from the outside
 * is not, so it has to prove what it is pointing at first.
 */
export function assertUsableTestDatabase(info: TestDatabaseInfo): void {
  const { serverVersionNum, databaseName } = info;

  if (serverVersionNum < MIN_SERVER_VERSION_NUM || serverVersionNum > MAX_SERVER_VERSION_NUM) {
    throw new UnsafeTestDatabaseError(
      `TEST_DATABASE_URL points at database "${databaseName}" running server_version_num ` +
        `${String(serverVersionNum)}, which is not in the Postgres 16 series ` +
        `(${String(MIN_SERVER_VERSION_NUM)}-${String(MAX_SERVER_VERSION_NUM)}). Refusing to run migrations against it.`,
    );
  }

  if (!databaseName.endsWith(REQUIRED_DATABASE_SUFFIX)) {
    throw new UnsafeTestDatabaseError(
      `TEST_DATABASE_URL points at database "${databaseName}", whose name does not end in ` +
        `"${REQUIRED_DATABASE_SUFFIX}". Refusing to run migrations against it. Point it at a ` +
        `throwaway database created for tests, or unset TEST_DATABASE_URL to use a container.`,
    );
  }
}

async function assertUsableTestDatabaseVia(pool: pg.Pool): Promise<void> {
  const result = await pool.query<{ server_version_num: string; database_name: string }>(
    "select current_setting('server_version_num') as server_version_num, " +
      "current_database() as database_name",
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new UnsafeTestDatabaseError(
      "Could not determine the server version or database name for TEST_DATABASE_URL.",
    );
  }

  assertUsableTestDatabase({
    serverVersionNum: Number.parseInt(row.server_version_num, 10),
    databaseName: row.database_name,
  });
}

/**
 * Build a unique, safe name for a per-run database on the supplied server.
 *
 * The name still ends in `_test`, so the guard above holds for it too, and it
 * is assembled here from a sanitised base plus random hex rather than from
 * anything a caller supplies, which is what makes it safe to interpolate into
 * the `create database` below (identifiers cannot be parameterised).
 */
function perRunDatabaseName(base: string): string {
  const stem = base.replace(/[^a-z0-9_]/gi, "_").slice(0, 32);
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  return `${stem}_${suffix}_test`;
}

/** The same connection string, pointed at a different database on that server. */
function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

export interface TestPostgres {
  /** Connection string for the running Postgres. */
  readonly connectionString: string;
  /** A Kysely instance against that Postgres, with migrations already applied. */
  readonly db: Kysely<unknown>;
  /**
   * An additional Kysely instance typed to a caller-supplied schema, for tests
   * that create their own tables. Closed by `stop()` along with everything else.
   */
  kysely<DB>(): Kysely<DB>;
  /** Close every Kysely instance and stop the container, if one was started. */
  stop(): Promise<void>;
}

/** Per-run databases this module creates, by name. */
const PER_RUN_DATABASE_PATTERN = "_[0-9a-f]{12}_test$";

/** How long a per-run database must be idle before the sweep reclaims it. */
const STALE_AFTER_MS = 30 * 60 * 1000;

/** SQLSTATE 55006 object_in_use: something is still connected to the database. */
const OBJECT_IN_USE = "55006";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drop a database, waiting briefly for stragglers to disconnect.
 *
 * Deliberately not `with (force)`. Forcing sends SIGTERM to whatever is still
 * connected, and a pooled client killed while idle surfaces as an unhandled
 * error in the test run rather than a clean teardown. A pool occasionally has
 * not finished closing by the time its owning test file resolves, so we wait
 * it out instead; anything still held afterwards is left for the sweep at the
 * next run's startup, which is a delay rather than a leak.
 */
async function dropDatabase(pool: pg.Pool, database: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await pool.query(`drop database if exists "${database}"`);
      return true;
    } catch (error) {
      const code: unknown = (error as { code?: unknown }).code;
      if (code !== OBJECT_IN_USE) throw error;
      await sleep(50);
    }
  }
  return false;
}

/**
 * Reclaim per-run databases abandoned by an earlier run.
 *
 * Only databases with nothing connected are considered, and of those only the
 * ones old enough that no test file could still be using them: a database
 * created moments ago belongs to a sibling running in parallel right now. The
 * timestamp recorded on it at creation is what separates the two.
 */
async function sweepStalePerRunDatabases(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ datname: string; created_at: string | null }>(
    `select d.datname, shobj_description(d.oid, 'pg_database') as created_at
       from pg_database d
      where d.datname ~ $1
        and not exists (select 1 from pg_stat_activity a where a.datname = d.datname)`,
    [PER_RUN_DATABASE_PATTERN],
  );

  const cutoff = Date.now() - STALE_AFTER_MS;

  for (const row of rows) {
    const createdAt = row.created_at === null ? Number.NaN : Date.parse(row.created_at);
    // An unreadable or missing timestamp means the database predates this
    // convention, so it is stale by definition.
    if (Number.isFinite(createdAt) && createdAt > cutoff) continue;
    try {
      await dropDatabase(pool, row.datname);
    } catch {
      // Best effort: failing here would fail a test run over leftovers that
      // are not this run's problem.
    }
  }
}

/** Drop a per-run database and close the connection that created it. */
async function dropPerRunDatabase(
  admin: { pool: pg.Pool; database: string } | undefined,
): Promise<void> {
  if (admin === undefined) return;
  try {
    await dropDatabase(admin.pool, admin.database);
  } finally {
    await admin.pool.end();
  }
}

/**
 * Start Postgres 16, run `db/migrations` against it, and hand back a Kysely
 * instance.
 *
 * Normally this starts a throwaway container. If TEST_DATABASE_URL is set it
 * uses that server instead, which is the only way to run these tests where a
 * Docker daemon is unavailable. CI leaves it unset, so CI always exercises the
 * container path.
 *
 * A database supplied that way must be a Postgres 16 whose name ends in
 * `_test`; anything else is refused before a single migration runs.
 *
 * Either way, every call gets a database of its own: the container path by
 * definition, and the TEST_DATABASE_URL path because we create a throwaway
 * database on that server and drop it in `stop()`. Vitest runs test files in
 * parallel, so sharing one database across them makes any assertion about
 * global state — a row count, "these are all the accounts" — depend on which
 * other files happen to be running. That failed locally while CI stayed green,
 * because CI gives each file its own container. Now both paths agree.
 */
export async function startTestPostgres(): Promise<TestPostgres> {
  const existing = process.env["TEST_DATABASE_URL"];

  let container: StartedPostgreSqlContainer | undefined;
  let connectionString: string;
  // Set only on the TEST_DATABASE_URL path: the server we created the per-run
  // database on, and therefore the one that has to drop it again.
  let admin: { pool: pg.Pool; database: string } | undefined;

  if (existing !== undefined && existing !== "") {
    // Check the supplied database before creating anything on its server: an
    // unsafe TEST_DATABASE_URL must be refused, not merely worked around.
    const adminPool = new pg.Pool({ connectionString: existing });
    let database: string;
    try {
      await assertUsableTestDatabaseVia(adminPool);
      await sweepStalePerRunDatabases(adminPool);
      const { rows } = await adminPool.query<{ name: string }>("select current_database() as name");
      database = perRunDatabaseName(rows[0]?.name ?? "raices");
      await adminPool.query(`create database "${database}"`);
      // Stamped so a later sweep can tell this apart from a database that a
      // test file running in parallel created seconds ago and is still using.
      await adminPool.query(`comment on database "${database}" is '${new Date().toISOString()}'`);
    } catch (error) {
      await adminPool.end();
      throw error;
    }
    admin = { pool: adminPool, database };
    connectionString = withDatabase(existing, database);
  } else {
    try {
      container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    } catch (error) {
      throw new Error(
        "Could not start a Postgres container. These tests need either a running " +
          "Docker daemon or TEST_DATABASE_URL pointing at a Postgres 16 you control.",
        { cause: error },
      );
    }
    connectionString = container.getConnectionUri();
  }

  const pool = new pg.Pool({ connectionString });

  try {
    // An externally supplied database proved itself above, before its server
    // was touched; the container was created here and needs no such proof.
    await applyMigrations(pool);
  } catch (error) {
    await pool.end();
    await dropPerRunDatabase(admin);
    throw error;
  }

  // Keep the closers rather than the instances: each is a different Kysely<DB>
  // and they do not share a common type parameter.
  const closers: (() => Promise<void>)[] = [];

  const makeKysely = <DB>(): Kysely<DB> => {
    const instance = new Kysely<DB>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
    });
    closers.push(() => instance.destroy());
    return instance;
  };

  const db = makeKysely<unknown>();

  return {
    connectionString,
    db,
    kysely: makeKysely,
    async stop(): Promise<void> {
      for (const close of closers) {
        await close();
      }
      await pool.end();
      if (container !== undefined) {
        // pg.Pool.end() resolves once pg-pool's bookkeeping is drained, not
        // once the TCP sockets are actually closed. If the container stops in
        // that window, Postgres sends FATAL 57P01 to the half-closed
        // connections, pg emits unhandled 'error' events, and Vitest fails
        // the run even though every test passed. Wait for the server itself
        // to report no remaining backends before stopping the container.
        // This covers pools created directly by test files too, which the
        // harness never sees.
        await waitForBackendsToDrain(connectionString);
        await container.stop();
      }
      await dropPerRunDatabase(admin);
    },
  };
}

/**
 * Block until the database reports no connected backends besides our own
 * probe, or throw after a timeout.
 *
 * A raw pg.Client is used deliberately: unlike pg.Pool.end(), Client.end()
 * resolves on the connection 'end' event, i.e. once the socket is really
 * closed, so after this returns there is genuinely nothing left for
 * container.stop() to kill mid-close.
 */
async function waitForBackendsToDrain(connectionString: string): Promise<void> {
  const probe = new pg.Client({ connectionString });
  // The probe is harness infrastructure, not test code: a 57P01 arriving
  // while the container stops is expected, so it must not become an
  // unhandled error. Test pools keep their strictness — no handler is
  // attached to them.
  probe.on("error", () => {});
  await probe.connect();
  try {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const { rows } = await probe.query<{ count: string }>(
        "select count(*)::text as count from pg_stat_activity " +
          "where datname = current_database() and pid <> pg_backend_pid()",
      );
      if (rows[0]?.count === "0") {
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          "Timed out waiting for test database connections to drain " +
            "before stopping the container",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    await probe.end();
  }
}
