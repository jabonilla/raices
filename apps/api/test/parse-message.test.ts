import { money } from "@raices/money";
import { describe, expect, it } from "vitest";

import { parseInboundMessage, type ParseResult } from "../src/messaging/parse/index.js";

/**
 * P3.3 — the inbound parser, exhaustively table-tested.
 *
 * No database, no container, no fixtures: the parser is a pure function and
 * a lint rule keeps it that way, so every phrasing below is just a string in
 * and a value out.
 *
 * The phrasings are meant to be what people actually send over WhatsApp from
 * Guatemala — missing accents, misspellings, "ocupo" for "necesito", "pal"
 * for "para el", Q before or after the number. A parser tested only against
 * textbook Spanish is a parser tested against messages nobody sends.
 *
 * The governing rule is the ticket's: when confidence is low, CONFIRM. Every
 * case below that is not unmistakable lands in `confirm`, never in a request.
 */

/** A phrasing and the amount it must yield, with no confirmation step. */
interface ClearCase {
  readonly text: string;
  readonly minor: bigint;
  readonly purpose?: string | null;
  readonly why: string;
}

const CLEAR: readonly ClearCase[] = [
  // --- the plain shapes -----------------------------------------------
  {
    text: "necesito Q200 para la renta",
    minor: 20_000n,
    purpose: "la renta",
    why: "symbol, no space",
  },
  {
    text: "Necesito 200 quetzales para la renta",
    minor: 20_000n,
    purpose: "la renta",
    why: "named currency",
  },
  {
    text: "necesito Q 200 para la renta",
    minor: 20_000n,
    purpose: "la renta",
    why: "space after Q",
  },
  { text: "200Q para la renta", minor: 20_000n, purpose: "la renta", why: "trailing Q" },
  {
    text: "necesito 200 Q para la renta",
    minor: 20_000n,
    purpose: "la renta",
    why: "spaced trailing Q",
  },
  { text: "necesito q150 para el gas", minor: 15_000n, purpose: "el gas", why: "lowercase q" },

  // --- misspellings people actually type -------------------------------
  { text: "nesecito q150 pal gas", minor: 15_000n, purpose: "el gas", why: "nesecito + pal" },
  {
    text: "nececito 400 para utiles escolares",
    minor: 40_000n,
    purpose: "utiles escolares",
    why: "nececito, no accent on utiles",
  },
  { text: "kiero Q100 pa comida", minor: 10_000n, purpose: "comida", why: "kiero, pa" },
  { text: "qiero 120 quetzales para el bus", minor: 12_000n, purpose: "el bus", why: "qiero" },
  { text: "neseito Q90 para la luz", minor: 9_000n, purpose: "la luz", why: "neseito" },

  // --- Guatemalan verbs -------------------------------------------------
  {
    text: "ocupo Q300 para medicina",
    minor: 30_000n,
    purpose: "medicina",
    why: "ocupo = necesito in GT",
  },
  { text: "me mandas Q500 porfa", minor: 50_000n, purpose: null, why: "me mandas, no purpose" },
  { text: "puedes mandarme 250 quetzales?", minor: 25_000n, purpose: null, why: "question form" },
  {
    text: "mandame 350 para el pasaje",
    minor: 35_000n,
    purpose: "el pasaje",
    why: "mandame, no accent",
  },

  // --- missing accents --------------------------------------------------
  {
    text: "necesito dos mil para la operacion",
    minor: 200_000n,
    purpose: "la operacion",
    why: "operacion, no accent",
  },
  {
    text: "necesito Q250 para el examen medico",
    minor: 25_000n,
    purpose: "el examen medico",
    why: "medico, no accent",
  },

  // --- words instead of numerals ---------------------------------------
  {
    text: "necesito doscientos para la comida",
    minor: 20_000n,
    purpose: "la comida",
    why: "doscientos",
  },
  { text: "necesito cien para el agua", minor: 10_000n, purpose: "el agua", why: "cien" },
  {
    text: "necesito ciento cincuenta para gas",
    minor: 15_000n,
    purpose: "gas",
    why: "compound: ciento cincuenta",
  },
  {
    text: "quinientos quetzales para la renta",
    minor: 50_000n,
    purpose: "la renta",
    why: "quinientos",
  },
  { text: "mil quetzales para el doctor", minor: 100_000n, purpose: "el doctor", why: "mil" },
  {
    text: "necesito trescientos cincuenta para la medicina",
    minor: 35_000n,
    purpose: "la medicina",
    why: "compound hundreds+tens",
  },
  {
    text: "necesito mil quinientos para la escuela",
    minor: 150_000n,
    purpose: "la escuela",
    why: "mil quinientos",
  },
  {
    text: "necesito veinticinco para el bus",
    minor: 2_500n,
    purpose: "el bus",
    why: "veinticinco, one word",
  },
  {
    text: "necesito treinta y cinco para el gas",
    minor: 3_500n,
    purpose: "el gas",
    why: "treinta y cinco",
  },

  // --- Guatemalan separators -------------------------------------------
  // GT follows the US convention: comma groups thousands, period is decimal.
  {
    text: "necesito Q1,500 para la escuela",
    minor: 150_000n,
    purpose: "la escuela",
    why: "comma thousands",
  },
  {
    text: "necesito 1500 para la escuela",
    minor: 150_000n,
    purpose: "la escuela",
    why: "bare thousands",
  },
  {
    text: "necesito Q45.50 para el pasaje",
    minor: 4_550n,
    purpose: "el pasaje",
    why: "period decimal",
  },
  {
    text: "necesito Q2,350.75 para la operacion",
    minor: 235_075n,
    purpose: "la operacion",
    why: "both separators",
  },

  // --- shouting, punctuation, padding ----------------------------------
  { text: "Necesito Q250 PARA LA RENTA", minor: 25_000n, purpose: "la renta", why: "caps" },
  {
    text: "  necesito   Q200   para la renta  ",
    minor: 20_000n,
    purpose: "la renta",
    why: "stray whitespace",
  },
  {
    text: "necesito Q200 para la renta!!!",
    minor: 20_000n,
    purpose: "la renta",
    why: "trailing punctuation",
  },
  {
    text: "necesito Q75 para el bus.",
    minor: 7_500n,
    purpose: "el bus",
    why: "trailing period is not a decimal",
  },
];

/** A phrasing that must produce a confirmation rather than a request. */
interface ConfirmCase {
  readonly text: string;
  readonly reason: string;
  readonly why: string;
}

const AMBIGUOUS: readonly ConfirmCase[] = [
  {
    text: "necesito 200 o 300 para la renta",
    reason: "multiple_amounts",
    why: "two amounts offered",
  },
  {
    text: "necesito 200 y 50 mas para la renta",
    reason: "multiple_amounts",
    why: "sum the user did not state",
  },
  { text: "necesito entre 200 y 300", reason: "range", why: "explicit range" },
  { text: "necesito de 200 a 300 quetzales", reason: "range", why: "range with de/a" },
  { text: "necesito como 200 para la renta", reason: "approximate", why: "como = about" },
  { text: "necesito unos 200 para la renta", reason: "approximate", why: "unos = around" },
  { text: "necesito mas o menos 300", reason: "approximate", why: "mas o menos" },
  { text: "necesito como doscientos", reason: "approximate", why: "approximate + word number" },
  { text: "necesito aproximadamente Q400", reason: "approximate", why: "aproximadamente" },
  // 1.500 is 1500 under the European convention and malformed under the
  // Guatemalan one. Three digits after a period is not a currency decimal,
  // so this is exactly the case where assuming costs somebody 1,498.50.
  { text: "necesito 1.500 para la renta", reason: "ambiguous_separator", why: "period + 3 digits" },
  {
    text: "necesito Q2.350 para la operacion",
    reason: "ambiguous_separator",
    why: "period + 3 digits with symbol",
  },
  // Comma with two digits is a European decimal, not a GT thousands group.
  { text: "necesito 45,50 para el pasaje", reason: "ambiguous_separator", why: "comma + 2 digits" },
  {
    text: "necesito 200 dolares para la renta",
    reason: "ambiguous_currency",
    why: "not quetzales",
  },
  { text: "necesito $200 para la renta", reason: "ambiguous_currency", why: "dollar sign" },
  {
    text: "necesito dinero para la renta",
    reason: "no_amount",
    why: "intent clear, amount missing",
  },
  { text: "necesito ayuda para la renta", reason: "no_amount", why: "ayuda, no number" },
  {
    text: "me puedes mandar algo para la comida",
    reason: "no_amount",
    why: "algo is not an amount",
  },
];

const AFFIRMATIVE: readonly string[] = [
  "sí",
  "si",
  "Sí",
  "SI",
  "sii",
  "sip",
  "si, correcto",
  "Sí, está bien",
  "esta bien",
  "dale",
  "ok",
  "okay",
  "listo",
  "claro",
  "correcto",
  "de acuerdo",
];

const NEGATIVE: readonly string[] = [
  "no",
  "No",
  "nel",
  "no, mejor no",
  "mejor no",
  "no gracias",
  "cancelar",
  "cancela",
  "incorrecto",
];

function amountOf(result: ParseResult): bigint | undefined {
  return result.kind === "request" ? result.money.amount : undefined;
}

describe("parser: unmistakable requests", () => {
  it.each(CLEAR)("$text → Q$minor ($why)", ({ text, minor, purpose }) => {
    const result = parseInboundMessage(text);
    expect(result.kind).toBe("request");
    if (result.kind !== "request") return;
    expect(result.money).toEqual(money(minor, "GTQ"));
    if (purpose !== undefined) expect(result.purpose).toBe(purpose);
  });

  it("covers at least 30 phrasings between the clear and ambiguous tables", () => {
    // The ticket asks for 30 real phrasings. Asserting the count keeps a
    // future trim from quietly shrinking the table below what was agreed.
    expect(CLEAR.length + AMBIGUOUS.length).toBeGreaterThanOrEqual(30);
  });
});

describe("parser: low confidence confirms, never assumes", () => {
  it.each(AMBIGUOUS)("$text → confirm/$reason ($why)", ({ text, reason }) => {
    const result = parseInboundMessage(text);
    expect(result.kind).toBe("confirm");
    if (result.kind !== "confirm") return;
    expect(result.reason).toBe(reason);
  });

  it("never returns a request for anything in the ambiguous table", () => {
    // The sharp version of the rule. A single phrasing slipping from
    // `confirm` to `request` is money moving on a guess, so this asserts the
    // whole table at once rather than relying on each row above.
    for (const { text } of AMBIGUOUS) {
      expect(amountOf(parseInboundMessage(text))).toBeUndefined();
    }
  });

  it("offers the candidates it found when there is more than one", () => {
    const result = parseInboundMessage("necesito 200 o 300 para la renta");
    expect(result.kind).toBe("confirm");
    if (result.kind !== "confirm") return;
    // The reply has to be able to say "¿200 o 300?" — which it cannot do if
    // the parser throws away what it saw.
    expect(result.candidates.map((c) => c.amount)).toEqual([20_000n, 30_000n]);
  });

  it("keeps the purpose even when the amount needs confirming", () => {
    const result = parseInboundMessage("necesito como 200 para la renta");
    expect(result.kind).toBe("confirm");
    if (result.kind !== "confirm") return;
    expect(result.purpose).toBe("la renta");
  });
});

describe("parser: yes and no", () => {
  it.each(AFFIRMATIVE)("%s → affirmative", (text) => {
    expect(parseInboundMessage(text).kind).toBe("affirmative");
  });

  it.each(NEGATIVE)("%s → negative", (text) => {
    expect(parseInboundMessage(text).kind).toBe("negative");
  });

  it("does not read a negated sentence as agreement", () => {
    // "si" appears inside "quizas" and similar; a substring match would turn
    // a refusal into consent.
    expect(parseInboundMessage("no, no me mandes nada").kind).toBe("negative");
    expect(parseInboundMessage("quizas").kind).not.toBe("affirmative");
    expect(parseInboundMessage("siempre").kind).not.toBe("affirmative");
  });

  it("reads a refusal that also contains an agreeing word as a refusal", () => {
    // "no, dale mejor despues" is a decline that happens to contain "dale".
    // Whichever check runs first wins, so the order is policy: a refusal is
    // read before an agreement, because the cost of reading one as the
    // other is money moving on a no.
    expect(parseInboundMessage("no, dale mejor despues").kind).toBe("negative");
    expect(parseInboundMessage("ok pero no").kind).toBe("negative");
  });

  it("treats an affirmative carrying a new amount as a request, not a bare yes", () => {
    // "sí, Q300" is not an answer to the previous question — it names a new
    // number. Reading it as a plain yes would confirm the OLD amount.
    const result = parseInboundMessage("si, Q300 para la renta");
    expect(result.kind).toBe("request");
    expect(amountOf(result)).toBe(30_000n);
  });
});

describe("parser: nothing it can use", () => {
  it.each(["hola", "buenos dias", "jajaja", "👍", "", "   ", "?"])("%s → unparseable", (text) => {
    expect(parseInboundMessage(text).kind).toBe("unparseable");
  });
});

describe("parser: amounts that are not amounts", () => {
  it("does not read a phone number as an amount", () => {
    const result = parseInboundMessage("mi numero es 55512345");
    expect(amountOf(result)).toBeUndefined();
  });

  it("does not read a date as an amount", () => {
    const result = parseInboundMessage("nos vemos el 15 de marzo");
    expect(amountOf(result)).toBeUndefined();
  });

  it("refuses an amount of zero", () => {
    expect(parseInboundMessage("necesito Q0 para la renta").kind).not.toBe("request");
  });

  it("strips accents from the purpose, not just from the keywords", () => {
    // The tokenizer drops combining marks on its own, so every keyword test
    // above passes whether or not normalize() strips them. The purpose is
    // read from the normalized string rather than from tokens, so this is
    // the one place the strip actually does work — and "operación" is how
    // people with an accent key type it.
    const result = parseInboundMessage("necesito Q200 para la operación");
    expect(result.kind).toBe("request");
    if (result.kind !== "request") return;
    expect(result.purpose).toBe("la operacion");
  });

  it("reads a phone number as no amount, not as an implausible one", () => {
    // Both readings refuse to create a request, so a test that only checked
    // "not a request" would pass either way. The distinction is what the
    // person is told: "ese monto no me cuadra" is a baffling answer to
    // somebody who sent a phone number.
    const result = parseInboundMessage("necesito que me llames al 55512345 para la renta");
    expect(result.kind).toBe("confirm");
    if (result.kind !== "confirm") return;
    expect(result.reason).toBe("no_amount");
  });

  it("ignores a date sitting beside a real amount", () => {
    // Without the date rule "15" is a second amount, and a perfectly clear
    // request turns into a needless question.
    const result = parseInboundMessage("necesito Q200 para la renta el 15 de marzo");
    expect(result.kind).toBe("request");
    expect(amountOf(result)).toBe(20_000n);
  });

  it("refuses an implausibly large amount rather than creating it", () => {
    // A typo'd Q9999999 is far likelier than a real one, and the approval
    // gate is not a reason to let a parser invent it.
    expect(parseInboundMessage("necesito Q9999999 para la renta").kind).toBe("confirm");
  });
});
