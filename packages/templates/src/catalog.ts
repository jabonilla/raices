import { TemplateCatalogError } from "./errors.js";
import en from "./locales/en.json";
import es from "./locales/es.json";
import {
  TEMPLATE_IDS,
  slotsOf,
  type MetaTemplateCategory,
  type TemplateDefinition,
  type TemplateId,
  type TemplateLocale,
} from "./types.js";

/**
 * The message template catalog (K2.20).
 *
 * Six outbound templates for the MVP flows. Categories are Meta's, required
 * at template-submission time:
 * - UTILITY for transactional updates tied to a user's activity.
 * - MARKETING for the invitation: it goes to someone who is not a user yet.
 *
 * Copy status: the UX copy sheet (`docs/claude_raices-ux-mvp-v0-copy-sheet.md`)
 * has no wording for any WhatsApp template, so every body is a TODO(copy)
 * sentinel (issue #46 owns the final copy). The sentinel lists the template's
 * slots so the shape stays valid and the renderer stays testable.
 * `templatesPendingCopy()` reports which templates still need real copy.
 */
const CATEGORIES: Record<TemplateId, MetaTemplateCategory> = {
  request_received: "UTILITY",
  request_approved: "UTILITY",
  request_declined: "UTILITY",
  money_sent: "UTILITY",
  money_arrived: "UTILITY",
  invitation: "MARKETING",
};

const COPIES: Record<TemplateLocale, Record<string, string>> = { es, en };

const TODO_COPY_MARKER = "TODO(copy)";

function buildCatalog(): readonly TemplateDefinition[] {
  const seen = new Set<string>();
  return TEMPLATE_IDS.map((id) => {
    if (seen.has(id)) {
      throw new TemplateCatalogError(`duplicate template id ${JSON.stringify(id)}`);
    }
    seen.add(id);
    return { id, category: CATEGORIES[id], slots: slotsOf(id) } satisfies TemplateDefinition;
  });
}

function extractSlots(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) {
    const name = match[1];
    if (name !== undefined && !found.includes(name)) {
      found.push(name);
    }
  }
  return found;
}

/**
 * Fail fast at import time: every `{{slot}}` in every locale body must be a
 * slot the template declares, and every template must have a body per locale.
 * A broken catalog must surface in tests, never at send time.
 */
function validateCatalog(catalog: readonly TemplateDefinition[]): void {
  for (const template of catalog) {
    for (const locale of Object.keys(COPIES) as TemplateLocale[]) {
      const body = COPIES[locale][template.id];
      if (body === undefined) {
        throw new TemplateCatalogError(
          `template ${JSON.stringify(template.id)} has no ${locale} copy`,
        );
      }
      for (const slot of extractSlots(body)) {
        if (!template.slots.includes(slot)) {
          throw new TemplateCatalogError(
            `template ${JSON.stringify(template.id)} (${locale}) references ` +
              `undeclared slot ${JSON.stringify(slot)}`,
          );
        }
      }
    }
  }
}

export const CATALOG: readonly TemplateDefinition[] = buildCatalog();
validateCatalog(CATALOG);

/** Look up a template definition by id. Returns undefined for unknown ids. */
export function getTemplate(id: string): TemplateDefinition | undefined {
  return CATALOG.find((template) => template.id === id);
}

/** The raw body for a template in a locale. Internal; prefer `renderTemplate`. */
export function templateBody(id: TemplateId, locale: TemplateLocale): string {
  const body = COPIES[locale][id];
  if (body === undefined) {
    throw new TemplateCatalogError(`template ${JSON.stringify(id)} has no ${locale} copy`);
  }
  return body;
}

/** True while the template's copy is still the TODO(copy) sentinel. */
export function isCopyPending(id: TemplateId, locale: TemplateLocale): boolean {
  return templateBody(id, locale).includes(TODO_COPY_MARKER);
}

/**
 * Template ids whose copy is still TODO in at least one locale. Gate Meta
 * submission on this being empty: never submit a sentinel to Meta.
 */
export function templatesPendingCopy(): readonly TemplateId[] {
  return TEMPLATE_IDS.filter((id) => isCopyPending(id, "es") || isCopyPending(id, "en"));
}
