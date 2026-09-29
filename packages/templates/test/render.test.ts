import { describe, expect, it } from "vitest";

import {
  MissingTemplateVariableError,
  TEMPLATE_IDS,
  UnexpectedTemplateVariableError,
  UnknownTemplateError,
  UnknownTemplateLocaleError,
  renderTemplate,
  slotsOf,
  type TemplateId,
  type TemplateLocale,
  type TemplateVariables,
} from "../src/index.js";

/** Build a valid variables object for any template from its declared slots. */
function variablesFor<Id extends TemplateId>(id: Id): TemplateVariables[Id] {
  return Object.fromEntries(
    slotsOf(id).map((slot) => [slot, `⟨${slot}⟩`]),
  ) as TemplateVariables[Id];
}

describe("renderTemplate", () => {
  it("renders every template in both locales with no placeholders left", () => {
    for (const id of TEMPLATE_IDS) {
      for (const locale of ["es", "en"] as const) {
        const rendered = renderTemplate(id, locale, variablesFor(id));
        for (const slot of slotsOf(id)) {
          expect(rendered).toContain(`⟨${slot}⟩`);
        }
        expect(rendered).not.toMatch(/\{\{/);
      }
    }
  });

  it("keeps Spanish and English bodies distinct per template", () => {
    for (const id of TEMPLATE_IDS) {
      const es = renderTemplate(id, "es", variablesFor(id));
      const en = renderTemplate(id, "en", variablesFor(id));
      expect(es).not.toBe(en);
    }
  });

  it("passes amount strings through verbatim and never formats money (issue #12)", () => {
    // A decimal string past 2^53: any float coercion or Intl formatting would
    // corrupt it. The renderer must interpolate it exactly as supplied.
    const hostile = "90071992547409.93";
    const rendered = renderTemplate("money_sent", "es", {
      senderName: "Carlos",
      amount: hostile,
    });
    expect(rendered).toContain(hostile);
  });

  it("throws MissingTemplateVariableError for a missing variable", () => {
    const incomplete = { senderName: "Carlos" } as unknown as TemplateVariables["money_sent"];
    expect(() => renderTemplate("money_sent", "es", incomplete)).toThrow(
      MissingTemplateVariableError,
    );
  });

  it("throws MissingTemplateVariableError for an empty variable", () => {
    expect(() => renderTemplate("money_sent", "es", { senderName: "Carlos", amount: "" })).toThrow(
      MissingTemplateVariableError,
    );
  });

  it("throws MissingTemplateVariableError for a non-string variable", () => {
    const wrongType = {
      senderName: "Carlos",
      amount: 95,
    } as unknown as TemplateVariables["money_sent"];
    expect(() => renderTemplate("money_sent", "es", wrongType)).toThrow(
      MissingTemplateVariableError,
    );
  });

  it("throws UnexpectedTemplateVariableError for an extra variable", () => {
    const extra = {
      senderName: "Carlos",
      amount: "$95.00",
      channel: "whatsapp",
    } as unknown as TemplateVariables["money_sent"];
    expect(() => renderTemplate("money_sent", "es", extra)).toThrow(
      UnexpectedTemplateVariableError,
    );
  });

  it("throws UnknownTemplateError for an unknown template id", () => {
    expect(() =>
      renderTemplate("no_such_template" as unknown as TemplateId, "es", {} as never),
    ).toThrow(UnknownTemplateError);
  });

  it("throws UnknownTemplateLocaleError for an unknown locale", () => {
    expect(() =>
      renderTemplate("money_sent", "fr" as unknown as TemplateLocale, variablesFor("money_sent")),
    ).toThrow(UnknownTemplateLocaleError);
  });

  it("rejects a missing variable at compile time", () => {
    // @ts-expect-error: amount is a required slot of money_sent
    expect(() => renderTemplate("money_sent", "es", { senderName: "Carlos" })).toThrow(
      MissingTemplateVariableError,
    );
  });

  it("rejects an extra variable at compile time", () => {
    expect(() =>
      renderTemplate("money_sent", "es", {
        senderName: "Carlos",
        amount: "$95.00",
        // @ts-expect-error: channel is not a declared slot of money_sent
        channel: "whatsapp",
      }),
    ).toThrow(UnexpectedTemplateVariableError);
  });

  it("rejects variables for the wrong template at compile time", () => {
    expect(() =>
      // @ts-expect-error: invitation declares inviterName, not senderName/amount
      renderTemplate("invitation", "es", { senderName: "Carlos", amount: "$95.00" }),
    ).toThrow(MissingTemplateVariableError);
  });
});
