/**
 * P3.3 — text normalisation for the inbound parser.
 *
 * Everything here is deterministic and reversible in principle: lowercase,
 * strip combining accents, split into word tokens. No AI, no fuzzy distance,
 * no dictionary beyond the explicit lists in the modules that use this.
 *
 * Accent stripping is not a nicety. People type from phone keyboards with
 * autocorrect off and the accent key two taps away, so "sí", "si" and "SI"
 * all arrive, and "operación" arrives as "operacion" far more often than
 * not. A parser that only matches the accented form would simply fail on
 * most real traffic.
 */

/** Lowercase and remove combining marks: "Sí" and "SI" both become "si". */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Split into word tokens, keeping digits and their separators together.
 *
 * `[.,]` stays inside a token only when digits sit on both sides, so
 * "Q45.50" survives as one token while the full stop in "el bus." does not
 * become part of "bus". Getting that wrong turns a price into a sentence
 * boundary, or a sentence boundary into a decimal.
 */
export function tokenize(normalized: string): readonly string[] {
  // "Q200" and "200Q" are one word to a naive tokenizer, which then matches
  // neither the currency marker nor the number. Split letter/digit
  // boundaries first; "1,500" has digits on both sides of its separator and
  // is untouched.
  const spaced = normalized.replace(/(\p{L})(\d)/gu, "$1 $2").replace(/(\d)(\p{L})/gu, "$1 $2");
  const matches = spaced.match(/\$?\d+(?:[.,]\d+)*|\p{L}+|\$/gu);
  return matches ?? [];
}

/** Collapse whitespace and drop trailing sentence punctuation. */
export function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[\s.,;:!¡?¿]+$/u, "")
    .trim();
}
