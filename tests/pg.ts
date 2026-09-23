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
 * Start Postgres 16, run `db/migrations` against it, and hand back a Kysely
 * instance.
 *
 * Normally this starts a throwaway container. If TEST_DATABASE_URL is set it
 * uses that database instead, which is the only way to run these tests where a
 * Docker daemon is unavailable. CI leaves it unset, so CI always exercises the
 * container path.
 *
 * A database supplied that way must be a Postgres 16 whose name ends in
 * `_test`; anything else is refused before a single migration runs.
 */
export async function startTestPostgres(): Promise<TestPostgres> {
  const existing = process.env["TEST_DATABASE_URL"];

  let container: StartedPostgreSqlContainer | undefined;
  let connectionString: string;

  if (existing !== undefined && existing !== "") {
    connectionString = existing;
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
    // Only an externally supplied database has to prove itself. The container
    // above was created here, and its default database is not named "*_test".
    if (container === undefined) {
      await assertUsableTestDatabaseVia(pool);
    }
    await applyMigrations(pool);
  } catch (error) {
    await pool.end();
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
