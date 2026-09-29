import { describe, expect, it } from "vitest";

import { API_ERROR_CODES } from "../../api/src/errors.js";
import i18n from "../src/i18n";
import { apiErrorCopyKeys } from "../src/apiErrors";
import en from "../src/i18n/en.json";
import es from "../src/i18n/es.json";

type ErrorCopy = { readonly title: string; readonly body: string };

function catalog(locale: typeof es): Record<string, ErrorCopy> {
  return locale.apiErrors;
}

describe("error catalog (K2.26)", () => {
  it("every API error code has es+en title+body copy", () => {
    const missing: string[] = [];
    for (const locale of ["es", "en"] as const) {
      const dict = catalog(locale === "es" ? es : en);
      for (const code of API_ERROR_CODES) {
        const entry = dict[code];
        if (typeof entry?.title !== "string" || entry.title.length === 0) {
          missing.push(`${locale}:apiErrors.${code}.title`);
        }
        if (typeof entry?.body !== "string" || entry.body.length === 0) {
          missing.push(`${locale}:apiErrors.${code}.body`);
        }
      }
    }
    // A new code added to the API envelope without copy fails here, not at
    // runtime in the user's face.
    expect(missing).toEqual([]);
  });

  it("the catalog covers exactly the API's code list, no more no less", () => {
    for (const locale of ["es", "en"] as const) {
      const keys = Object.keys(catalog(locale === "es" ? es : en)).sort();
      expect(keys).toEqual([...API_ERROR_CODES].sort());
    }
  });

  it("no message shows the word 'error' alone or a raw code", () => {
    for (const locale of ["es", "en"] as const) {
      const entries = Object.values(catalog(locale === "es" ? es : en));
      for (const entry of entries) {
        for (const text of [entry.title, entry.body]) {
          expect(text).not.toMatch(/\berror\b/i);
        }
      }
      // Only the message text — the JSON keys are the codes by design.
      const allText = entries.map((e) => `${e.title} ${e.body}`).join(" ");
      for (const code of API_ERROR_CODES) {
        expect(allText).not.toContain(code);
      }
    }
  });

  it("every code's keys resolve through i18n in both locales", async () => {
    for (const locale of ["es-US", "en-US"] as const) {
      await i18n.changeLanguage(locale);
      for (const code of API_ERROR_CODES) {
        const { titleKey, bodyKey } = apiErrorCopyKeys(code);
        // i18next returns the key itself when untranslated — that would be
        // the raw code path in the user's face.
        expect(i18n.t(titleKey)).not.toBe(titleKey);
        expect(i18n.t(bodyKey)).not.toBe(bodyKey);
      }
    }
    await i18n.changeLanguage("es-US");
  });
});
