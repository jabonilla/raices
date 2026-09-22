import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../db/migrations", import.meta.url));

export interface AppliedMigration {
  readonly name: string;
  readonly alreadyApplied: boolean;
}

const CREATE_SCHEMA_MIGRATIONS = `
  create table if not exists schema_migrations (
    name        text        primary key,
    checksum    text        not null,
    applied_at  timestamptz not null default now()
  )
`;

function checksumOf(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

async function migrationFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en"));
}

/**
 * Apply every `db/migrations/*.sql` not yet recorded, in filename order, each
 * in its own transaction alongside its `schema_migrations` row.
 *
 * Migrations are forward-only and are never edited after merge (CLAUDE.md), so
 * a recorded migration whose file no longer hashes the same is an error rather
 * than something to re-run.
 */
export async function applyMigrations(
  pool: pg.Pool,
  dir: string = MIGRATIONS_DIR,
): Promise<AppliedMigration[]> {
  await pool.query(CREATE_SCHEMA_MIGRATIONS);

  const recorded = await pool.query<{ name: string; checksum: string }>(
    "select name, checksum from schema_migrations",
  );
  const checksums = new Map(recorded.rows.map((row) => [row.name, row.checksum]));

  const results: AppliedMigration[] = [];

  for (const name of await migrationFiles(dir)) {
    const sql = await readFile(path.join(dir, name), "utf8");
    const checksum = checksumOf(sql);
    const previous = checksums.get(name);

    if (previous !== undefined) {
      if (previous !== checksum) {
        throw new Error(
          `Migration ${name} was already applied but its contents changed. ` +
            `Migrations are forward-only: add a new migration instead of editing this one.`,
        );
      }
      results.push({ name, alreadyApplied: true });
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name, checksum) values ($1, $2)", [
        name,
        checksum,
      ]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw new Error(`Migration ${name} failed`, { cause: error });
    } finally {
      client.release();
    }

    results.push({ name, alreadyApplied: false });
  }

  return results;
}

async function main(): Promise<void> {
  const connectionString = process.env["DATABASE_URL"];
  if (connectionString === undefined || connectionString === "") {
    throw new Error("DATABASE_URL is not set. Copy .env.example and fill it in.");
  }

  const pool = new pg.Pool({ connectionString });
  try {
    const applied = await applyMigrations(pool);
    const fresh = applied.filter((entry) => !entry.alreadyApplied);
    for (const entry of fresh) {
      console.log(`applied ${entry.name}`);
    }
    console.log(
      fresh.length === 0
        ? `no new migrations (${String(applied.length)} already applied)`
        : `applied ${String(fresh.length)} migration(s)`,
    );
  } finally {
    await pool.end();
  }
}

// Only run when invoked directly, so tests can import applyMigrations.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
