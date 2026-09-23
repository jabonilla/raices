/**
 * Safety guard for local database tooling (migrate, seed).
 *
 * These scripts must never run against a production database. The guard
 * parses the database name out of the connection string and refuses anything
 * whose name does not end in `_test` or `_dev` — before any connection is
 * opened, so a typo in DATABASE_URL fails fast instead of migrating the
 * wrong database.
 *
 * The test suite has its own stricter guard (tests/pg.ts) that requires
 * `_test` exactly; tests must never share a database with dev fixtures.
 */

const SAFE_SUFFIXES = ["_test", "_dev"] as const;

export class UnsafeDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeDatabaseError";
  }
}

/** Extract the database name from a Postgres connection string. */
export function databaseNameFromUrl(connectionString: string): string {
  // URL parsing handles postgres://user:pass@host:port/db?opts=... as well
  // as keyword/value strings via the fallback below.
  try {
    const url = new URL(connectionString);
    const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (name !== "") return name;
  } catch {
    // Not a URL — fall through to keyword/value parsing.
  }
  const match = /(?:^|\s)dbname=([^\s]+)/.exec(connectionString);
  if (match?.[1] !== undefined) return match[1];
  throw new UnsafeDatabaseError(`could not determine a database name from the connection string`);
}

/**
 * Throw unless the connection string points at a database whose name ends
 * in `_test` or `_dev`.
 */
export function assertSafeDatabase(connectionString: string): void {
  const name = databaseNameFromUrl(connectionString);
  if (!SAFE_SUFFIXES.some((suffix) => name.endsWith(suffix))) {
    throw new UnsafeDatabaseError(
      `refusing to run against database "${name}": ` +
        `database names must end in ${SAFE_SUFFIXES.join(" or ")}`,
    );
  }
}
