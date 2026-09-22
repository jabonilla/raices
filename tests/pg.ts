import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

import { applyMigrations } from "../scripts/migrate.js";

const POSTGRES_IMAGE = "postgres:16-alpine";

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
  await applyMigrations(pool);

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
    },
  };
}
