/**
 * Seed a local dev database with fixture data.
 *
 * Creates two accounts (a USD settlement account and a USD recipient
 * account) and posts one balanced transfer between them, so a fresh
 * `docker compose up` database has something to look at.
 *
 * Idempotent: fixed UUIDs and codes mean re-running the seed changes
 * nothing. It inserts rows directly; production writes go through
 * `post()` in apps/api/src/ledger/post.ts, which is the only code that may
 * append to the ledger.
 */
import pg from "pg";

import { applyMigrations } from "./migrate.js";
import { assertSafeDatabase } from "./db-guard.js";

const SETTLEMENT_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const RECIPIENT_ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const TRANSFER_TXN_ID = "33333333-3333-4333-8333-333333333333";
const DEBIT_ENTRY_ID = "44444444-4444-4444-8444-444444444444";
const CREDIT_ENTRY_ID = "55555555-5555-4555-8555-555555555555";

/** $25.00 in minor units. */
const TRANSFER_AMOUNT_MINOR = 2500;

/**
 * Insert the fixture rows. Exported so tests can run it against a real
 * database; `main()` below is the CLI entry point that wires up the pool.
 * Idempotent: every row has a fixed ID, so re-running inserts nothing new.
 */
export async function seedFixtures(pool: pg.Pool): Promise<void> {
  await applyMigrations(pool);

  await pool.query(
    `insert into ledger_account (id, code, type, currency)
       values
         ($1, 'settlement:usd', 'asset', 'USD'),
         ($2, 'recipient:maria', 'liability', 'USD')
       on conflict (id) do nothing`,
    [SETTLEMENT_ACCOUNT_ID, RECIPIENT_ACCOUNT_ID],
  );

  await pool.query(
    `insert into ledger_transaction
         (id, idempotency_key, request_hash, description, occurred_at)
       values
         ($1, 'seed-transfer-1', 'seed', 'Maria remittance (seed fixture)', now())
       on conflict (id) do nothing`,
    [TRANSFER_TXN_ID],
  );

  // Debits must equal credits within each currency (database trigger), so
  // both legs are USD. Entry IDs are fixed so re-running the seed inserts
  // nothing new.
  await pool.query(
    `insert into ledger_entry
         (id, transaction_id, account_id, direction, amount_minor, currency, entry_type)
       values
         ($1, $3, $4, 'debit', $6, 'USD', 'transfer'),
         ($2, $3, $5, 'credit', $6, 'USD', 'transfer')
       on conflict (id) do nothing`,
    [
      DEBIT_ENTRY_ID,
      CREDIT_ENTRY_ID,
      TRANSFER_TXN_ID,
      SETTLEMENT_ACCOUNT_ID,
      RECIPIENT_ACCOUNT_ID,
      TRANSFER_AMOUNT_MINOR,
    ],
  );

  const { rows } = await pool.query<{ count: string }>(
    "select count(*) as count from ledger_entry",
  );
  console.log(`seeded dev fixtures (${rows[0]?.count ?? "?"} ledger entries total)`);
}

async function main(): Promise<void> {
  const connectionString = process.env["DATABASE_URL"];
  if (connectionString === undefined || connectionString === "") {
    throw new Error("DATABASE_URL is not set. See docs/local-dev.md.");
  }
  // Same guard as migrate: only _test or _dev databases.
  assertSafeDatabase(connectionString);

  const pool = new pg.Pool({ connectionString });
  try {
    await seedFixtures(pool);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
