import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

import type { Database } from "./schema.js";

export { type Database } from "./schema.js";
export {
  MAX_ATTEMPTS,
  SerializationRetryExhausted,
  isRetryableSerializationError,
  withSerializableTx,
  type WithSerializableTxOptions,
} from "./serializable.js";

/**
 * Money amounts are bigint minor units (CLAUDE.md rule 1). node-postgres parses
 * int8 into a JS number by default, which silently loses precision past 2^53.
 * Hand int8 back as a string and let the caller build a BigInt from it.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => value);

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}

export function createDb(pool: pg.Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env["DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is not set. Copy .env.example and fill it in.");
  }
  return url;
}

/** The process-wide Kysely instance, built from DATABASE_URL on first use. */
let cached: { pool: pg.Pool; db: Kysely<Database> } | undefined;

export function getDb(): Kysely<Database> {
  cached ??= (() => {
    const pool = createPool(requireDatabaseUrl());
    return { pool, db: createDb(pool) };
  })();
  return cached.db;
}

export async function closeDb(): Promise<void> {
  if (cached === undefined) return;
  const { db } = cached;
  cached = undefined;
  // Kysely.destroy() ends the underlying pool.
  await db.destroy();
}
