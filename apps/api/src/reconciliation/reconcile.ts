import { createHash } from "node:crypto";

import { sql, type Kysely, type Transaction } from "kysely";

import type { DiscrepancyKind, ReconciliationDatabase } from "./schema.js";

/**
 * Compare what we intended to settle with a provider against what the
 * provider says happened.
 *
 * Our ledger is authoritative for intent; the provider is authoritative for
 * settlement. This function reconciles the two and records where they
 * disagree. It never resolves a disagreement: no ledger row is read or
 * written here, and the type it takes cannot express a ledger write.
 */

export interface ReconcileRequest {
  readonly provider: string;
  readonly statementId: string;
}

export interface Discrepancy {
  readonly id: string;
  readonly kind: DiscrepancyKind;
  readonly expectedId: string | null;
  readonly statementLineId: string | null;
  readonly details: unknown;
}

export interface ReconcileResult {
  readonly runId: string;
  readonly provider: string;
  readonly statementId: string;
  readonly inputHash: string;
  readonly discrepancies: readonly Discrepancy[];
  /** True when this call returned an earlier run and wrote nothing. */
  readonly replayed: boolean;
}

interface ExpectationRow {
  id: string;
  seq: string;
  provider_ref: string;
  amount_minor: string;
  currency: string;
  expected_state: string;
  expected_by: Date;
}

interface LineRow {
  id: string;
  seq: string;
  line_ref: string;
  provider_ref: string;
  amount_minor: string;
  currency: string;
  state: string;
  settled_at: Date | null;
}

interface PendingDiscrepancy {
  readonly kind: DiscrepancyKind;
  readonly expectedId: string | null;
  readonly statementLineId: string | null;
  readonly details: Record<string, unknown>;
}

/**
 * The expectations currently in force for a provider.
 *
 * `expected_settlement` is append-only, so a revision is a new row pointing
 * at the one it replaces. Superseded rows are excluded: reporting one as
 * `missing` because a newer row took its place would be a finding about our
 * own bookkeeping, not about the provider.
 */
async function currentExpectations(
  db: Kysely<ReconciliationDatabase>,
  provider: string,
): Promise<ExpectationRow[]> {
  const result = await sql<ExpectationRow>`
    select e.id,
           e.seq::text            as seq,
           e.provider_ref,
           e.amount_minor::text   as amount_minor,
           e.currency,
           e.expected_state,
           e.expected_by
    from expected_settlement e
    where e.provider = ${provider}
      and not exists (
        select 1 from expected_settlement newer where newer.supersedes_id = e.id
      )
    order by e.seq
  `.execute(db);
  return result.rows;
}

async function statementLines(
  db: Kysely<ReconciliationDatabase>,
  provider: string,
  statementId: string,
): Promise<LineRow[]> {
  const result = await sql<LineRow>`
    select id,
           seq::text          as seq,
           line_ref,
           provider_ref,
           amount_minor::text as amount_minor,
           currency,
           state,
           settled_at
    from provider_statement_line
    where provider = ${provider} and statement_id = ${statementId}
    order by seq
  `.execute(db);
  return result.rows;
}

/**
 * A stable fingerprint of everything the comparison looked at.
 *
 * Both sides are included, not just the statement: adding an expectation
 * changes what a re-run would conclude, so it has to change the hash, or the
 * second run would hand back stale findings.
 */
function inputHashOf(
  provider: string,
  statementId: string,
  expectations: readonly ExpectationRow[],
  lines: readonly LineRow[],
): string {
  const canonical = JSON.stringify({
    expectations: expectations.map((e) => ({
      amount: e.amount_minor,
      currency: e.currency.trim(),
      expectedBy: e.expected_by.toISOString(),
      expectedState: e.expected_state,
      id: e.id,
      providerRef: e.provider_ref,
    })),
    lines: lines.map((l) => ({
      amount: l.amount_minor,
      currency: l.currency.trim(),
      id: l.id,
      lineRef: l.line_ref,
      providerRef: l.provider_ref,
      settledAt: l.settled_at?.toISOString() ?? null,
      state: l.state,
    })),
    provider,
    statementId,
  });

  return createHash("sha256").update(canonical).digest("hex");
}

function groupByProviderRef<T extends { provider_ref: string }>(
  rows: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const existing = grouped.get(row.provider_ref);
    if (existing === undefined) {
      grouped.set(row.provider_ref, [row]);
    } else {
      existing.push(row);
    }
  }
  return grouped;
}

/**
 * Compare one matched pair.
 *
 * Every applicable kind is reported, not just the first. A late settlement
 * that is also short by a minor unit is two separate facts, and suppressing
 * one because the other fired first would hide it.
 */
function comparePair(expectation: ExpectationRow, line: LineRow): PendingDiscrepancy[] {
  const found: PendingDiscrepancy[] = [];
  const expectedCurrency = expectation.currency.trim();
  const lineCurrency = line.currency.trim();

  // Amounts are compared as bigint. A Number() here could make two different
  // amounts look equal past 2^53.
  if (
    BigInt(expectation.amount_minor) !== BigInt(line.amount_minor) ||
    expectedCurrency !== lineCurrency
  ) {
    found.push({
      kind: "amount_mismatch",
      expectedId: expectation.id,
      statementLineId: line.id,
      details: {
        expectedAmountMinor: expectation.amount_minor,
        expectedCurrency,
        actualAmountMinor: line.amount_minor,
        actualCurrency: lineCurrency,
      },
    });
  }

  if (expectation.expected_state !== line.state) {
    found.push({
      kind: "state_mismatch",
      expectedId: expectation.id,
      statementLineId: line.id,
      details: { expectedState: expectation.expected_state, actualState: line.state },
    });
  }

  // Only a settlement that actually happened can be late. A line with no
  // settled_at has not settled at all, which is a state question.
  if (line.settled_at !== null && line.settled_at.getTime() > expectation.expected_by.getTime()) {
    found.push({
      kind: "timing",
      expectedId: expectation.id,
      statementLineId: line.id,
      details: {
        expectedBy: expectation.expected_by.toISOString(),
        settledAt: line.settled_at.toISOString(),
        lateByMs: line.settled_at.getTime() - expectation.expected_by.getTime(),
      },
    });
  }

  return found;
}

/**
 * Pair expectations with lines on `provider_ref`.
 *
 * Normally there is one of each. When a ref appears more than once on a
 * side, the two lists are zipped in seq order and whatever is left over
 * becomes `missing` or `unexpected`, so nothing is silently dropped.
 */
function compare(
  expectations: readonly ExpectationRow[],
  lines: readonly LineRow[],
): PendingDiscrepancy[] {
  const byRefExpected = groupByProviderRef(expectations);
  const byRefLines = groupByProviderRef(lines);
  const refs = new Set([...byRefExpected.keys(), ...byRefLines.keys()]);

  const found: PendingDiscrepancy[] = [];

  for (const ref of [...refs].sort()) {
    const expectedForRef = byRefExpected.get(ref) ?? [];
    const linesForRef = byRefLines.get(ref) ?? [];
    const paired = Math.min(expectedForRef.length, linesForRef.length);

    for (let i = 0; i < paired; i += 1) {
      const expectation = expectedForRef[i];
      const line = linesForRef[i];
      if (expectation === undefined || line === undefined) continue;
      found.push(...comparePair(expectation, line));
    }

    for (const expectation of expectedForRef.slice(paired)) {
      found.push({
        kind: "missing",
        expectedId: expectation.id,
        statementLineId: null,
        details: {
          providerRef: expectation.provider_ref,
          expectedAmountMinor: expectation.amount_minor,
          expectedCurrency: expectation.currency.trim(),
        },
      });
    }

    for (const line of linesForRef.slice(paired)) {
      found.push({
        kind: "unexpected",
        expectedId: null,
        statementLineId: line.id,
        details: {
          providerRef: line.provider_ref,
          lineRef: line.line_ref,
          amountMinor: line.amount_minor,
          currency: line.currency.trim(),
        },
      });
    }
  }

  return found;
}

async function existingRun(
  db: Kysely<ReconciliationDatabase>,
  inputHash: string,
): Promise<{ id: string } | undefined> {
  return db
    .selectFrom("reconciliation_run")
    .select("id")
    .where("input_hash", "=", inputHash)
    .executeTakeFirst();
}

async function discrepanciesFor(
  db: Kysely<ReconciliationDatabase> | Transaction<ReconciliationDatabase>,
  runId: string,
): Promise<Discrepancy[]> {
  const rows = await db
    .selectFrom("reconciliation_discrepancy")
    .select(["id", "kind", "expected_id", "statement_line_id", "details"])
    .where("run_id", "=", runId)
    .orderBy("seq")
    .execute();

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    expectedId: row.expected_id,
    statementLineId: row.statement_line_id,
    details: row.details,
  }));
}

/**
 * Reconcile one provider statement and record what disagrees.
 *
 * Re-running over unchanged inputs returns the original run and writes
 * nothing, so findings are not duplicated by a retry.
 */
export async function reconcile(
  db: Kysely<ReconciliationDatabase>,
  request: ReconcileRequest,
): Promise<ReconcileResult> {
  const { provider, statementId } = request;

  const expectations = await currentExpectations(db, provider);
  const lines = await statementLines(db, provider, statementId);
  const inputHash = inputHashOf(provider, statementId, expectations, lines);

  // A fast path, not the mechanism. Correctness does not depend on it:
  // removing it changes no behaviour, because the insert below is
  // ON CONFLICT DO NOTHING and a loser reads the winner's run back the same
  // way. Measured: a mutation that skips this check passes the whole suite.
  // It is here so the common case — re-running an unchanged statement —
  // does not open a transaction to discover that.
  const already = await existingRun(db, inputHash);
  if (already !== undefined) {
    return {
      runId: already.id,
      provider,
      statementId,
      inputHash,
      discrepancies: await discrepanciesFor(db, already.id),
      replayed: true,
    };
  }

  const findings = compare(expectations, lines);

  const runId = await db.transaction().execute(async (trx) => {
    const run = await trx
      .insertInto("reconciliation_run")
      .values({ provider, statement_id: statementId, input_hash: inputHash })
      .onConflict((oc) => oc.column("input_hash").doNothing())
      .returning("id")
      .executeTakeFirst();

    if (run === undefined) {
      // Another caller reconciled the same inputs first. Their findings are
      // the findings; adding a second set would double-count.
      return undefined;
    }

    if (findings.length > 0) {
      await trx
        .insertInto("reconciliation_discrepancy")
        .values(
          findings.map((finding) => ({
            run_id: run.id,
            kind: finding.kind,
            expected_id: finding.expectedId,
            statement_line_id: finding.statementLineId,
            details: JSON.stringify(finding.details),
          })),
        )
        .execute();
    }

    await trx
      .updateTable("reconciliation_run")
      .set({ finished_at: new Date() })
      .where("id", "=", run.id)
      .execute();

    return run.id;
  });

  if (runId === undefined) {
    const winner = await existingRun(db, inputHash);
    if (winner === undefined) {
      throw new Error(`Reconciliation run for ${inputHash} vanished after a write conflict`);
    }
    return {
      runId: winner.id,
      provider,
      statementId,
      inputHash,
      discrepancies: await discrepanciesFor(db, winner.id),
      replayed: true,
    };
  }

  return {
    runId,
    provider,
    statementId,
    inputHash,
    discrepancies: await discrepanciesFor(db, runId),
    replayed: false,
  };
}
