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

/**
 * Drop a per-run database and close the connection that created it.
 *
 * `with (force)` because a pool that failed to close cleanly would otherwise
 * keep the database alive and leak it onto the developer's server.
 */
async function dropPerRunDatabase(
  admin: { pool: pg.Pool; database: string } | undefined,
): Promise<void> {
  if (admin === undefined) return;
  try {
    await admin.pool.query(`drop database if exists "${admin.database}" with (force)`);
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
      const { rows } = await adminPool.query<{ name: string }>("select current_database() as name");
      database = perRunDatabaseName(rows[0]?.name ?? "raices");
      await adminPool.query(`create database "${database}"`);
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
        await container.stop();
      }
      await dropPerRunDatabase(admin);
    },
  };
}
