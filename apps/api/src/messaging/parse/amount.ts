import { money, type Money } from "@raices/money";

/**
 * P3.3 — amount extraction, Guatemalan conventions.
 *
 * Pure. Takes tokens, returns what it found and what it could not decide.
 * CLAUDE.md rule 1 holds here too: every amount leaves as bigint minor
 * units, and no intermediate value is ever a float.
 */

/** GTQ has two minor digits. */
const MINOR_PER_MAJOR = 100n;

/**
 * Nothing above this is treated as a real request.
 *
 * Q100,000 is already far outside anything this product is for, and a
 * fat-fingered "Q9999999" is enormously more likely than a real one. The
 * approval gate is not a reason to let the parser invent the number — the
 * gate asks a person to approve what we tell them was asked for, so a
 * parser that mis-states the ask corrupts the thing being approved.
 */
const MAX_PLAUSIBLE_MINOR = 100_000n * MINOR_PER_MAJOR;

export type AmountSource = "symbol" | "named_currency" | "words" | "bare_numeral";

export interface FoundAmount {
  readonly money: Money;
  readonly source: AmountSource;
}

/** Why a numeral could not be read as one definite value. */
export type NumeralProblem = "ambiguous_separator" | "implausible_amount";

type Interpretation = { readonly minor: bigint } | { readonly problem: NumeralProblem };

/**
 * Read one numeral under Guatemalan convention: comma groups thousands, a
 * period is the decimal point — the US convention, not the European one.
 *
 * The cases that do not fit either reading are refused rather than guessed:
 *
 * - `1.500` is 1500 in Europe and a malformed decimal here. Guessing wrong
 *   is a factor of a thousand, and the person would be approving a number
 *   they never typed.
 * - `45,50` is a European decimal and a malformed thousands group here.
 *
 * Both return a problem, which the caller turns into a question.
 */
export function interpretNumeral(raw: string): Interpretation {
  // Plain integer.
  if (/^\d+$/.test(raw)) {
    return plausible(BigInt(raw) * MINOR_PER_MAJOR);
  }
  // Grouped thousands, optionally with a decimal: 1,500 or 2,350.75
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(raw)) {
    return plausible(fromDecimalString(raw.replaceAll(",", "")));
  }
  // Plain decimal: 45.5 or 45.50
  if (/^\d+\.\d{1,2}$/.test(raw)) {
    return plausible(fromDecimalString(raw));
  }
  // A period followed by three or more digits is not a currency decimal, and
  // a comma followed by one or two is not a thousands group. Either could be
  // the other convention; neither is readable here.
  return { problem: "ambiguous_separator" };
}

function plausible(minor: bigint): Interpretation {
  if (minor <= 0n || minor > MAX_PLAUSIBLE_MINOR) return { problem: "implausible_amount" };
  return { minor };
}

/** "45.5" → 4550n, "45.50" → 4550n, "1500" → 150000n. Exact, never a float. */
function fromDecimalString(decimal: string): bigint {
  const [whole = "0", fraction = ""] = decimal.split(".");
  const cents = (fraction + "00").slice(0, 2);
  return BigInt(whole) * MINOR_PER_MAJOR + BigInt(cents);
}

/**
 * Spanish number words, to the range this product sees.
 *
 * Deliberately a table rather than an algorithm over morphology: a table is
 * auditable, and every entry here is a word somebody actually sends.
 */
const WORD_VALUES: ReadonlyMap<string, number> = new Map([
  ["cero", 0],
  ["un", 1],
  ["uno", 1],
  ["una", 1],
  ["dos", 2],
  ["tres", 3],
  ["cuatro", 4],
  ["cinco", 5],
  ["seis", 6],
  ["siete", 7],
  ["ocho", 8],
  ["nueve", 9],
  ["diez", 10],
  ["once", 11],
  ["doce", 12],
  ["trece", 13],
  ["catorce", 14],
  ["quince", 15],
  ["dieciseis", 16],
  ["diecisiete", 17],
  ["dieciocho", 18],
  ["diecinueve", 19],
  ["veinte", 20],
  ["veintiuno", 21],
  ["veintidos", 22],
  ["veintitres", 23],
  ["veinticuatro", 24],
  ["veinticinco", 25],
  ["veintiseis", 26],
  ["veintisiete", 27],
  ["veintiocho", 28],
  ["veintinueve", 29],
  ["treinta", 30],
  ["cuarenta", 40],
  ["cincuenta", 50],
  ["sesenta", 60],
  ["setenta", 70],
  ["ochenta", 80],
  ["noventa", 90],
  ["cien", 100],
  ["ciento", 100],
  ["doscientos", 200],
  ["doscientas", 200],
  ["trescientos", 300],
  ["trescientas", 300],
  ["cuatrocientos", 400],
  ["cuatrocientas", 400],
  ["quinientos", 500],
  ["quinientas", 500],
  ["seiscientos", 600],
  ["seiscientas", 600],
  ["setecientos", 700],
  ["setecientas", 700],
  ["ochocientos", 800],
  ["ochocientas", 800],
  ["novecientos", 900],
  ["novecientas", 900],
  ["mil", 1000],
]);

export function isNumberWord(token: string): boolean {
  return WORD_VALUES.has(token);
}

/**
 * Fold one run of number words into a value.
 *
 * "ciento cincuenta" is 150 and "dos mil" is 2000, so the run has to be
 * folded as a whole rather than counted as separate amounts — otherwise the
 * most ordinary way to say a number in Spanish reads as two competing ones.
 */
export function foldNumberWords(run: readonly string[]): number | null {
  let total = 0;
  let current = 0;
  let sawValue = false;

  for (const token of run) {
    if (token === "y") continue;
    const value = WORD_VALUES.get(token);
    if (value === undefined) return null;
    sawValue = true;

    if (value === 1000) {
      current = (current === 0 ? 1 : current) * 1000;
      total += current;
      current = 0;
    } else {
      current += value;
    }
  }

  return sawValue ? total + current : null;
}

export function amountFromMajor(major: number, source: AmountSource): FoundAmount | NumeralProblem {
  const interpretation = plausible(BigInt(major) * MINOR_PER_MAJOR);
  if ("problem" in interpretation) return interpretation.problem;
  return { money: money(interpretation.minor, "GTQ"), source };
}

export function amountFromMinor(minor: bigint, source: AmountSource): FoundAmount {
  return { money: money(minor, "GTQ"), source };
}
