import { isCurrency, money, type Currency, type Money } from "@raices/money";
import { sql, type Kysely } from "kysely";

import type { Database, LedgerAccountType } from "../db/schema.js";

/**
 * Balances are derived, never stored (P1.4). Every call sums the entries; a
 * cache is a separate ticket, to be opened once a measured query is slow.
 */

export class AccountNotFoundError extends Error {
  readonly accountId: string;

  constructor(accountId: string) {
    super(`No ledger account with id ${JSON.stringify(accountId)}`);
    this.name = "AccountNotFoundError";
    this.accountId = accountId;
  }
}

export class UnsupportedAccountCurrencyError extends Error {
  constructor(accountId: string, currency: string) {
    super(
      `Ledger account ${JSON.stringify(accountId)} holds currency ${JSON.stringify(currency)}, ` +
        `which packages/money does not support.`,
    );
    this.name = "UnsupportedAccountCurrencyError";
  }
}

/**
 * Accounts whose balance grows with debits. The other three — liability,
 * equity and revenue — grow with credits.
 *
 * This is the only place the sign convention lives. Getting it backwards
 * flips every line of a balance sheet, so it is a table rather than a
 * condition scattered through the queries.
 */
const DEBIT_NORMAL: ReadonlySet<LedgerAccountType> = new Set<LedgerAccountType>([
  "asset",
  "expense",
]);

export function isDebitNormal(type: LedgerAccountType): boolean {
  return DEBIT_NORMAL.has(type);
}

export interface BalanceOptions {
  /**
   * Derive the balance as of this entry `seq`, inclusive. Ordering is by
   * `seq` and never by `created_at` (CLAUDE.md).
   */
  readonly asOfSeq?: bigint;
}

export interface TrialBalanceRow {
  readonly accountId: string;
  readonly code: string;
  readonly type: LedgerAccountType;
  /** Signed on the account's normal side. */
  readonly balance: Money;
}

export interface TrialBalanceTotal {
  readonly currency: Currency;
  /**
   * Debits minus credits across every account in this currency, which double
   * entry requires to be zero. Note this is NOT the sum of the rows above:
   * those are normal-side signed, and summing them would not net to zero even
   * on a healthy ledger.
   */
  readonly net: Money;
}

export interface TrialBalanceResult {
  readonly rows: readonly TrialBalanceRow[];
  readonly totals: readonly TrialBalanceTotal[];
}

/** `sum()` over bigint returns numeric, so it is read back as an exact string. */
function toBigInt(value: string | null): bigint {
  return BigInt(value ?? "0");
}

function assertCurrency(accountId: string, currency: string): Currency {
  // char(3) comes back padded in principle; the P1.2 check constraint keeps
  // it to the supported set, but this is a boundary so it is verified.
  const trimmed = currency.trim();
  if (!isCurrency(trimmed)) {
    throw new UnsupportedAccountCurrencyError(accountId, currency);
  }
  return trimmed;
}

/** Apply the account's normal side to a raw debit-minus-credit total. */
function onNormalSide(type: LedgerAccountType, debitMinusCredit: bigint): bigint {
  return isDebitNormal(type) ? debitMinusCredit : -debitMinusCredit;
}

/**
 * The derived balance of one account, signed on its normal side.
 *
 * A debit-normal account (asset, expense) reports a net debit as positive; a
 * credit-normal account (liability, equity, revenue) reports a net credit as
 * positive. The returned Money carries the account's own currency.
 */
export async function balance(
  db: Kysely<Database>,
  accountId: string,
  options: BalanceOptions = {},
): Promise<Money> {
  const account = await db
    .selectFrom("ledger_account")
    .select(["type", "currency"])
    .where("id", "=", accountId)
    .executeTakeFirst();

  if (account === undefined) {
    throw new AccountNotFoundError(accountId);
  }

  const currency = assertCurrency(accountId, account.currency);
  const asOfSeq = options.asOfSeq ?? null;

  const result = await sql<{ net: string | null }>`
    select sum(
      case when direction = 'debit' then amount_minor else -amount_minor end
    )::text as net
    from ledger_entry
    where account_id = ${accountId}
      and (${asOfSeq}::bigint is null or seq <= ${asOfSeq}::bigint)
  `.execute(db);

  const debitMinusCredit = toBigInt(result.rows[0]?.net ?? null);
  return money(onNormalSide(account.type, debitMinusCredit), currency);
}

/**
 * Every account's derived balance, plus the per-currency net that double
 * entry requires to be zero.
 *
 * Accounts with no entries are listed with a zero balance, so the trial
 * balance is a complete picture of the chart of accounts rather than only
 * the accounts that happen to have been used.
 */
export async function trialBalance(
  db: Kysely<Database>,
  options: BalanceOptions = {},
): Promise<TrialBalanceResult> {
  const asOfSeq = options.asOfSeq ?? null;

  const result = await sql<{
    id: string;
    code: string;
    type: LedgerAccountType;
    currency: string;
    net: string | null;
  }>`
    select a.id,
           a.code,
           a.type,
           a.currency,
           sum(
             case when e.direction = 'debit' then e.amount_minor else -e.amount_minor end
           )::text as net
    from ledger_account a
    left join ledger_entry e
      on e.account_id = a.id
     and (${asOfSeq}::bigint is null or e.seq <= ${asOfSeq}::bigint)
    group by a.id, a.code, a.type, a.currency
    order by a.code
  `.execute(db);

  const rows: TrialBalanceRow[] = [];
  const netByCurrency = new Map<Currency, bigint>();

  for (const row of result.rows) {
    const currency = assertCurrency(row.id, row.currency);
    const debitMinusCredit = toBigInt(row.net);

    rows.push({
      accountId: row.id,
      code: row.code,
      type: row.type,
      balance: money(onNormalSide(row.type, debitMinusCredit), currency),
    });

    // Totals stay on the raw debit-minus-credit axis, which is the one that
    // nets to zero.
    netByCurrency.set(currency, (netByCurrency.get(currency) ?? 0n) + debitMinusCredit);
  }

  const totals: TrialBalanceTotal[] = [...netByCurrency.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, net]) => ({ currency, net: money(net, currency) }));

  return { rows, totals };
}
