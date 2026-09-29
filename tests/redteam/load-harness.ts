import { performance } from "node:perf_hooks";
import { money } from "@raices/money";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { Database } from "../../apps/api/src/db/schema.js";
import {
  SerializationRetryExhausted,
  withSerializableTx,
} from "../../apps/api/src/db/serializable.js";
import { post } from "../../apps/api/src/ledger/post.js";
import { trialBalance } from "../../apps/api/src/ledger/balance.js";
import { startTestPostgres } from "../pg.js";

// CLI harness. Temporary schema/data only; never takes a production DB URL.
function positive(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error("Expected positive integer harness option");
  return parsed;
}
const operations = positive(process.env["LOAD_OPERATIONS"], 300);
const workers = positive(process.env["LOAD_WORKERS"], 32);
const budgetMs = positive(process.env["LOAD_BUDGET_MS"], 2000);
const holdMs = positive(process.env["LOAD_HOLD_MS"], 5);
const server = await startTestPostgres();
const pool = new pg.Pool({ connectionString: server.connectionString, max: workers });
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

try {
  const clearing = await db
    .insertInto("ledger_account")
    .values({ code: "load.clearing", type: "liability", currency: "USD" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const senders: string[] = [];
  for (let index = 0; index < workers; index += 1) {
    const sender = await db
      .insertInto("ledger_account")
      .values({ code: `load.sender.${index.toString()}`, type: "asset", currency: "USD" })
      .returning("id")
      .executeTakeFirstOrThrow();
    senders.push(sender.id);
  }
  // Synthetic mutable domain row, NOT a balance cache. This deliberately
  // measures contention absent from pure append-only ledger postings.
  await sql`create table redteam_hot_state (id integer primary key, version bigint not null)`.execute(
    db,
  );
  await sql`insert into redteam_hot_state values (1,0)`.execute(db);
  const reports: Record<string, unknown>[] = [];
  for (const scenario of ["shared-clearing", "duplicate-replay", "hot-domain-row"] as const) {
    const samples: { elapsedMs: number; attempts: number; ok: boolean; kind: string }[] = [];
    let next = 0;
    const started = performance.now();
    await Promise.all(
      Array.from({ length: workers }, async (_, worker) => {
        for (;;) {
          const index = next++;
          if (index >= operations) return;
          let attempts = 0;
          const begin = performance.now();
          const options = {
            budgetMs,
            onAttempt: (event: { attempt: number }) => {
              attempts = event.attempt;
            },
          };
          try {
            if (scenario === "hot-domain-row") {
              await withSerializableTx(
                db,
                async (trx) => {
                  await sql`select version from redteam_hot_state where id=1`.execute(trx);
                  await sql`select pg_sleep(${holdMs / 1000})`.execute(trx);
                  await sql`update redteam_hot_state set version=version+1 where id=1`.execute(trx);
                },
                options,
              );
            } else {
              const accountId = senders[scenario === "duplicate-replay" ? 0 : worker];
              if (accountId === undefined) throw new Error("Missing synthetic sender");
              await post(
                db,
                {
                  idempotencyKey: `${scenario}.${scenario === "duplicate-replay" ? Math.floor(index / workers).toString() : index.toString()}`,
                  description: "synthetic load",
                  occurredAt: new Date("2026-09-29T00:00:00Z"),
                  entries: [
                    {
                      accountId,
                      direction: "debit",
                      amount: money(101n, "USD"),
                      entryType: "load",
                    },
                    {
                      accountId: clearing.id,
                      direction: "credit",
                      amount: money(101n, "USD"),
                      entryType: "load",
                    },
                  ],
                },
                options,
              );
            }
            samples.push({
              elapsedMs: performance.now() - begin,
              attempts,
              ok: true,
              kind: "committed",
            });
          } catch (error) {
            samples.push({
              elapsedMs: performance.now() - begin,
              attempts,
              ok: false,
              kind: error instanceof SerializationRetryExhausted ? "retry_exhausted" : "unexpected",
            });
            if (!(error instanceof SerializationRetryExhausted)) throw error;
          }
        }
      }),
    );
    const attemptDistribution: Record<string, number> = {};
    for (const sample of samples)
      attemptDistribution[sample.attempts.toString()] =
        (attemptDistribution[sample.attempts.toString()] ?? 0) + 1;
    const failed = samples.filter((sample) => !sample.ok).length;
    reports.push({
      scenario,
      operations,
      workers,
      budgetMs,
      holdMs: scenario === "hot-domain-row" ? holdMs : 0,
      wallMs: performance.now() - started,
      failed,
      failureRate: failed / operations,
      p50Ms: percentile(
        samples.map((sample) => sample.elapsedMs),
        0.5,
      ),
      p99Ms: percentile(
        samples.map((sample) => sample.elapsedMs),
        0.99,
      ),
      successP99Ms: percentile(
        samples.filter((sample) => sample.ok).map((sample) => sample.elapsedMs),
        0.99,
      ),
      maxMs: Math.max(...samples.map((sample) => sample.elapsedMs)),
      attemptDistribution,
    });
  }
  const trial = await trialBalance(db);
  if (trial.totals.some((total) => total.net.amount !== 0n))
    throw new Error("Load left unbalanced books");
  const result = await sql<{
    version: string;
  }>`select version from redteam_hot_state where id=1`.execute(db);
  const hot = reports.find((report) => report["scenario"] === "hot-domain-row");
  if (BigInt(result.rows[0]?.version ?? "-1") !== BigInt(operations - Number(hot?.["failed"] ?? 0)))
    throw new Error("Successful hot writes do not match state");
  process.stdout.write(
    JSON.stringify(
      {
        node: process.version,
        seed: "deterministic operations; production random full-jitter retries",
        reports,
        invariants: { balanced: true, noLostHotWrites: true },
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await db.destroy();
  await server.stop();
}
