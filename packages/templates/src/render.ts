import { getTemplate, templateBody } from "./catalog.js";
import {
  MissingTemplateVariableError,
  UnexpectedTemplateVariableError,
  UnknownTemplateError,
  UnknownTemplateLocaleError,
} from "./errors.js";
import type { TemplateId, TemplateLocale, TemplateVariables } from "./types.js";

const LOCALES: readonly TemplateLocale[] = ["es", "en"];
const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * Render a template to its final plain-text body.
 *
 * Compile time: `variables` must supply exactly the template's declared
 * slots — a missing or extra key is a type error.
 *
 * Runtime (for callers TypeScript cannot see, e.g. dynamic payloads): an
 * unknown template id, an unknown locale, a missing/empty/non-string
 * variable, or an undeclared variable all throw.
 *
 * Amounts pass through verbatim: the renderer never formats money
 * (issue #12). Supply the display string from the caller.
 */
export function renderTemplate<Id extends TemplateId>(
  id: Id,
  locale: TemplateLocale,
  variables: TemplateVariables[Id],
): string {
  const template = getTemplate(id);
  if (template === undefined) {
    throw new UnknownTemplateError(id);
  }
  if (!LOCALES.includes(locale)) {
    throw new UnknownTemplateLocaleError(locale);
  }

  const provided = variables as Record<string, unknown>;
  for (const slot of template.slots) {
    const value: unknown = provided[slot];
    if (typeof value !== "string" || value.length === 0) {
      throw new MissingTemplateVariableError(template.id, slot);
    }
  }
  for (const key of Object.keys(provided)) {
    if (!template.slots.includes(key)) {
      throw new UnexpectedTemplateVariableError(template.id, key);
    }
  }

  return templateBody(template.id, locale).replace(
    PLACEHOLDER,
    (_match, name: string) => provided[name] as string,
  );
}
