import type { Money } from "@raices/money";

import {
  amountFromMajor,
  amountFromMinor,
  foldNumberWords,
  interpretNumeral,
  isNumberWord,
  type AmountSource,
  type FoundAmount,
} from "./amount.js";
import { normalize, tidy, tokenize } from "./normalize.js";

/**
 * P3.3 — the inbound message parser.
 *
 * A pure function, the same rule as the P2.4 tier classifier: no database,
 * no network, no clock. A lint rule in eslint.config.js refuses a database
 * import anywhere under this directory, so the whole thing stays
 * exhaustively table-testable without a container.
 *
 * **No AI.** Deterministic tables and explicit patterns only. The assistant
 * layer is Phase 4 and will never have write access; nothing here may become
 * a place where a model decides what somebody asked for.
 *
 * ## The rule this is built around
 *
 * When confidence is low, CONFIRM — never assume. The parser's output is
 * either an unmistakable reading or a question, and there is no third option
 * where it proceeds on a best guess. That is not caution for its own sake:
 * the approval gate downstream asks a person to approve *what we tell them
 * was asked for*, so a parser that mis-reads the ask corrupts the very thing
 * being approved. A wrong confirmation costs one extra message; a wrong
 * assumption costs somebody money they never agreed to send.
 */

export type Ambiguity =
  /** Two or more different amounts in one message. */
  | "multiple_amounts"
  /** "entre 200 y 300", "de 200 a 300". */
  | "range"
  /** "como 200", "unos 200", "mas o menos 300". */
  | "approximate"
  /** A separator that reads differently under GT and European convention. */
  | "ambiguous_separator"
  /** Dollars, or any currency that is not quetzales. */
  | "ambiguous_currency"
  /** Zero, or far outside what this product is for. */
  | "implausible_amount"
  /** The person is asking for money but named no amount. */
  | "no_amount";

export type ParseResult =
  | { readonly kind: "request"; readonly money: Money; readonly purpose: string | null }
  | {
      readonly kind: "confirm";
      readonly reason: Ambiguity;
      /** What was found, when anything definite was. Empty when nothing was. */
      readonly candidates: readonly Money[];
      readonly purpose: string | null;
    }
  | { readonly kind: "affirmative" }
  | { readonly kind: "negative" }
  | { readonly kind: "unparseable" };

/** Ways people say they need money, including the spellings they use. */
const REQUEST_WORDS: ReadonlySet<string> = new Set([
  "necesito",
  "necesita",
  "necesitamos",
  "necesitaria",
  // Misspellings seen in real traffic. Listed, not guessed at: a fuzzy
  // matcher would also accept words nobody sent.
  "nesecito",
  "nececito",
  "neseito",
  "nesesito",
  "necsito",
  "neccesito",
  // "ocupar" is "to need" in Guatemala, not "to occupy".
  "ocupo",
  "ocupamos",
  "ocupa",
  "quiero",
  "quisiera",
  "kiero",
  "qiero",
  "kisiera",
  "mandame",
  "mandas",
  "mandar",
  "manda",
  "mande",
  "mandes",
  "mandarme",
  "enviame",
  "envia",
  "enviar",
  "enviarme",
  "envias",
  "prestame",
  "presta",
  "prestas",
  "regalame",
  "ayudame",
  "apoyame",
]);

const AFFIRMATIVE_WORDS: ReadonlySet<string> = new Set([
  "si",
  "sii",
  "siii",
  "sip",
  "sipi",
  "sisi",
  "ok",
  "oka",
  "okay",
  "okey",
  "oki",
  "dale",
  "listo",
  "claro",
  "correcto",
  "exacto",
  "confirmo",
  "afirmativo",
  // Guatemalan "va" as agreement.
  "va",
  "vale",
  "bueno",
]);

const NEGATIVE_WORDS: ReadonlySet<string> = new Set([
  "no",
  "nel",
  "nop",
  "nope",
  "nada",
  "cancelar",
  "cancela",
  "cancelo",
  "cancelen",
  "incorrecto",
  "negativo",
  "equivocado",
]);

const AFFIRMATIVE_PHRASES: readonly string[] = [
  "esta bien",
  "de acuerdo",
  "asi es",
  "esta correcto",
];
const NEGATIVE_PHRASES: readonly string[] = ["mejor no", "asi no", "no es"];

const APPROXIMATE_WORDS: ReadonlySet<string> = new Set([
  "como",
  "unos",
  "unas",
  "aproximadamente",
  "aprox",
  "cerca",
  "casi",
  "algo",
]);

const QUETZAL_WORDS: ReadonlySet<string> = new Set([
  "q",
  "quetzal",
  "quetzales",
  "qtz",
  "quetzalez",
]);

const FOREIGN_CURRENCY_WORDS: ReadonlySet<string> = new Set([
  "dolar",
  "dolares",
  "usd",
  "dollar",
  "dollars",
  "euro",
  "euros",
  "lempiras",
  "pesos",
]);

const MONTHS: ReadonlySet<string> = new Set([
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "setiembre",
  "octubre",
  "noviembre",
  "diciembre",
]);

/** Politeness that is not a purpose. */
const PURPOSE_TAIL_NOISE =
  /\s*\b(porfa|porfis|por favor|pls|please|gracias|grax|plis)\b[\s.,!?]*$/u;

/** A bare number this long is a phone number or an account, not an amount. */
const MAX_BARE_DIGITS = 6;

interface Scan {
  readonly amounts: readonly FoundAmount[];
  readonly separatorProblem: boolean;
  readonly implausible: boolean;
  readonly sawRange: boolean;
}

function hasPhrase(normalized: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => normalized.includes(phrase));
}

/** `mas o menos` as three adjacent tokens. */
function hasMasOMenos(tokens: readonly string[]): boolean {
  return tokens.some((t, i) => t === "mas" && tokens[i + 1] === "o" && tokens[i + 2] === "menos");
}

function digitsOnly(token: string): string {
  return token.replace(/\D/g, "");
}

/**
 * Walk the tokens once, collecting every amount and every reason an amount
 * could not be read.
 *
 * Number words are folded as a run — "ciento cincuenta" is one amount, not
 * two — because the most ordinary way to say a number in Spanish would
 * otherwise look like somebody naming two competing figures.
 */
function scanAmounts(tokens: readonly string[], allowBare: boolean): Scan {
  const amounts: FoundAmount[] = [];
  let separatorProblem = false;
  let implausible = false;
  let sawRange = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined) continue;

    // --- number words, folded as one run ------------------------------
    if (isNumberWord(token)) {
      const run: string[] = [];
      let j = i;
      while (j < tokens.length) {
        const next = tokens[j];
        if (next === undefined) break;
        if (isNumberWord(next)) {
          run.push(next);
          j += 1;
          continue;
        }
        // "treinta y cinco": keep going only when a number word follows.
        const after = tokens[j + 1];
        if (next === "y" && after !== undefined && isNumberWord(after)) {
          run.push(next);
          j += 1;
          continue;
        }
        break;
      }
      const value = foldNumberWords(run);
      i = j - 1;
      if (value === null) continue;
      const found = amountFromMajor(value, "words");
      if (typeof found === "string") {
        if (found === "implausible_amount") implausible = true;
        else separatorProblem = true;
      } else {
        amounts.push(found);
      }
      continue;
    }

    // --- numerals ------------------------------------------------------
    if (!/^\$?\d/.test(token)) continue;

    const before = tokens[i - 1];
    const after = tokens[i + 1];

    // "el 15 de marzo" is a date, not an amount.
    if (after === "de" && tokens[i + 2] !== undefined && MONTHS.has(tokens[i + 2] ?? "")) continue;

    const hadDollarSign = token.startsWith("$");
    const raw = token.replace(/^\$/, "");

    const markedBefore = before !== undefined && (QUETZAL_WORDS.has(before) || before === "$");
    const markedAfter = after !== undefined && QUETZAL_WORDS.has(after);
    const foreignAfter = after !== undefined && FOREIGN_CURRENCY_WORDS.has(after);
    const marked = markedBefore || markedAfter || hadDollarSign || foreignAfter;

    // A long bare number with nothing marking it as money is a phone number.
    if (!marked && digitsOnly(raw).length > MAX_BARE_DIGITS) continue;
    if (!marked && !allowBare) continue;

    // "200 a 300" is a range, not two independent asks.
    if (after === "a" && tokens[i + 2] !== undefined && /^\$?\d/.test(tokens[i + 2] ?? "")) {
      sawRange = true;
    }

    const interpretation = interpretNumeral(raw);
    if ("problem" in interpretation) {
      if (interpretation.problem === "implausible_amount") implausible = true;
      else separatorProblem = true;
      continue;
    }

    const source: AmountSource =
      markedBefore || hadDollarSign ? "symbol" : markedAfter ? "named_currency" : "bare_numeral";
    amounts.push(amountFromMinor(interpretation.minor, source));
  }

  return { amounts, separatorProblem, implausible, sawRange };
}

/** Everything after "para"/"pa"/"pal", tidied. "pal gas" means "el gas". */
function extractPurpose(normalized: string): string | null {
  const match = /\b(para|pa|pal)\b\s+(.+)$/u.exec(normalized);
  if (match === null) return null;
  const marker = match[1];
  const rest = (match[2] ?? "").replace(PURPOSE_TAIL_NOISE, "");
  const body = tidy(marker === "pal" ? `el ${rest}` : rest);
  return body === "" ? null : body;
}

function distinct(amounts: readonly FoundAmount[]): readonly Money[] {
  const seen = new Set<string>();
  const out: Money[] = [];
  for (const { money: m } of amounts) {
    const key = `${m.amount.toString()}:${m.currency}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/**
 * Read one inbound message.
 *
 * The order of the checks below is the policy, not an implementation
 * detail. A refusal is read before an agreement, and every reason to be
 * unsure is read before any reason to act.
 */
export function parseInboundMessage(text: string): ParseResult {
  const normalized = normalize(text);
  if (normalized === "") return { kind: "unparseable" };

  const tokens = tokenize(normalized);
  if (tokens.length === 0) return { kind: "unparseable" };

  const tokenSet = new Set(tokens);
  const purpose = extractPurpose(normalized);

  const requestIntent =
    tokens.some((t) => REQUEST_WORDS.has(t)) || tokenSet.has("dinero") || tokenSet.has("ayuda");

  const scan = scanAmounts(tokens, requestIntent || purpose !== null);
  const candidates = distinct(scan.amounts);

  const foreignCurrency =
    tokens.some((t) => FOREIGN_CURRENCY_WORDS.has(t)) || tokens.some((t) => t.startsWith("$"));
  const approximate = tokens.some((t) => APPROXIMATE_WORDS.has(t)) || hasMasOMenos(tokens);
  const range = scan.sawRange || (tokenSet.has("entre") && candidates.length > 1);

  // Every reason to be unsure, in the order they override one another. A
  // foreign currency outranks the rest because the number may be right while
  // the money is not.
  if (foreignCurrency) return confirm("ambiguous_currency", candidates, purpose);
  if (approximate && (candidates.length > 0 || scan.separatorProblem)) {
    return confirm("approximate", candidates, purpose);
  }
  if (range) return confirm("range", candidates, purpose);
  if (candidates.length > 1) return confirm("multiple_amounts", candidates, purpose);
  if (scan.separatorProblem) return confirm("ambiguous_separator", [], purpose);
  if (scan.implausible) return confirm("implausible_amount", [], purpose);

  const only = candidates[0];
  if (only !== undefined) return { kind: "request", money: only, purpose };

  // No amount. A refusal is read before an agreement: if somebody has said
  // no, that is the answer, whatever else the message contains.
  if (tokens.some((t) => NEGATIVE_WORDS.has(t)) || hasPhrase(normalized, NEGATIVE_PHRASES)) {
    return { kind: "negative" };
  }
  if (tokens.some((t) => AFFIRMATIVE_WORDS.has(t)) || hasPhrase(normalized, AFFIRMATIVE_PHRASES)) {
    return { kind: "affirmative" };
  }

  // Asking for money without naming a sum is a question we can ask, not an
  // error to report.
  if (requestIntent) return confirm("no_amount", [], purpose);

  return { kind: "unparseable" };
}

function confirm(
  reason: Ambiguity,
  candidates: readonly Money[],
  purpose: string | null,
): ParseResult {
  return { kind: "confirm", reason, candidates, purpose };
}
