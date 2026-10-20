import { format, type Money } from "@raices/money";

import type { Ambiguity } from "./parse/index.js";

/**
 * P3.3 — what we say back, in Spanish.
 *
 * These are session replies, sent inside the 24-hour window in answer to
 * something the person just sent. They are deliberately not Meta templates:
 * `packages/templates` holds the business-initiated templates that need
 * approval, and a reply to an inbound message needs none.
 *
 * Two rules from the ticket shape every string here:
 *
 * - Ambiguous or unparseable input gets a human-readable reply, never an
 *   error code and never silence. There is no branch below that returns
 *   nothing.
 * - A confirmation states the amount, the recipient and the purpose, and
 *   asks for an explicit yes. Somebody is being asked to agree to a sum of
 *   money; the sum has to be in front of them when they do.
 *
 * Copy status: this is working Spanish, written to be clear rather than
 * final. Issue #46 owns approved product copy and should review it.
 *
 * PII: a counterparty's display name may appear in these strings because
 * they go to the person who already knows it. It is on the K2.5 redaction
 * deny-list, so these strings must never be logged.
 */

/** The amount as a Guatemalan reader expects it, symbol included. */
function amount(value: Money): string {
  return format(value, "es-GT");
}

export interface ConfirmationCopy {
  readonly money: Money;
  readonly purpose: string | null;
  /** What the sender is called, when we know. Never inferred from a number. */
  readonly senderName: string | null;
}

/**
 * The confirmation that can become a request if answered yes.
 *
 * States all three things the ticket requires, and asks for a word, not a
 * tap: "SI" is the explicit yes.
 */
export function confirmationReply(copy: ConfirmationCopy): string {
  const to = copy.senderName === null ? "tu contacto" : copy.senderName;
  const forWhat = copy.purpose === null ? "" : ` para ${copy.purpose}`;
  return (
    `Para confirmar: ¿le pedimos ${amount(copy.money)}${forWhat} a ${to}? ` +
    `Responde SI para enviar la solicitud, o NO para cancelar.`
  );
}

/**
 * The reply when we will not guess.
 *
 * Each one names what was unclear and shows the shape of an answer we can
 * read. Telling somebody only that we did not understand leaves them to
 * guess at our grammar; showing an example is the difference between a
 * dead end and a next message.
 */
export function clarificationReply(reason: Ambiguity, candidates: readonly Money[]): string {
  const example = "Por ejemplo: *necesito Q200 para la renta*.";

  switch (reason) {
    case "multiple_amounts": {
      const listed = candidates.map(amount).join(" o ");
      return `Vi más de un monto (${listed}). ¿Cuál necesitas? ${example}`;
    }
    case "range":
      return `Me diste un rango. ¿Qué monto exacto necesitas? ${example}`;
    case "approximate":
      return `¿Me confirmas el monto exacto? ${example}`;
    case "ambiguous_separator":
      // The one where guessing is worst: 1.500 is Q1,500 or Q1.50 depending
      // on which convention the person has in mind.
      return (
        `No estoy seguro de ese número. Escríbelo sin puntos de miles, por ejemplo ` +
        `*Q1500* o *Q1500.50*. ${example}`
      );
    case "ambiguous_currency":
      return `Por ahora solo manejamos quetzales. ¿Cuánto necesitas en quetzales? ${example}`;
    case "implausible_amount":
      return `Ese monto no me cuadra. ¿Me lo confirmas? ${example}`;
    case "no_amount":
      return `Claro. ¿Cuánto necesitas? ${example}`;
  }
}

/** Nothing we could act on — still an answer, never silence. */
export function unparseableReply(): string {
  return (
    `No logré entender el mensaje. Si necesitas pedir dinero, escríbeme el monto y para qué. ` +
    `Por ejemplo: *necesito Q200 para la renta*.`
  );
}

/** The pending context went stale before the yes arrived. */
export function expiredReply(): string {
  return (
    `Pasó un rato desde que te pregunté, así que cancelé esa solicitud para no equivocarme. ` +
    `Si todavía la necesitas, escríbeme el monto otra vez.`
  );
}

/** They said no. */
export function declinedReply(): string {
  return `Listo, no envié nada. Si necesitas otra cosa, aquí estoy.`;
}

/** A yes with nothing pending behind it. */
export function nothingPendingReply(): string {
  return (
    `No tengo ninguna solicitud pendiente de confirmar. Si necesitas pedir algo, ` +
    `escríbeme el monto y para qué.`
  );
}

/** The request went through and is waiting on the sender. */
export function requestCreatedReply(money: Money, senderName: string | null): string {
  const to = senderName === null ? "tu contacto" : senderName;
  return `Le envié la solicitud de ${amount(money)} a ${to}. Te aviso en cuanto responda.`;
}
