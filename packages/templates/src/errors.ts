import type { TemplateId } from "./types.js";

/** Thrown when a template id has no catalog entry. */
export class UnknownTemplateError extends Error {
  readonly templateId: string;

  constructor(templateId: string) {
    super(`Unknown message template: ${JSON.stringify(templateId)}`);
    this.name = "UnknownTemplateError";
    this.templateId = templateId;
  }
}

/** Thrown when a locale has no copy for the catalog. */
export class UnknownTemplateLocaleError extends Error {
  readonly locale: string;

  constructor(locale: string) {
    super(`Unknown template locale: ${JSON.stringify(locale)}`);
    this.name = "UnknownTemplateLocaleError";
    this.locale = locale;
  }
}

/** Thrown at render time when a declared slot is missing, empty, or not a string. */
export class MissingTemplateVariableError extends Error {
  readonly templateId: TemplateId;
  readonly variable: string;

  constructor(templateId: TemplateId, variable: string) {
    super(
      `Template ${JSON.stringify(templateId)} is missing variable ${JSON.stringify(variable)}: ` +
        `every declared slot must be a non-empty string`,
    );
    this.name = "MissingTemplateVariableError";
    this.templateId = templateId;
    this.variable = variable;
  }
}

/** Thrown at render time when a variable is supplied that the template does not declare. */
export class UnexpectedTemplateVariableError extends Error {
  readonly templateId: TemplateId;
  readonly variable: string;

  constructor(templateId: TemplateId, variable: string) {
    super(
      `Template ${JSON.stringify(templateId)} does not declare variable ${JSON.stringify(variable)}`,
    );
    this.name = "UnexpectedTemplateVariableError";
    this.templateId = templateId;
    this.variable = variable;
  }
}

/**
 * Thrown at import time when the catalog is internally inconsistent: a
 * locale body references a `{{slot}}` the template does not declare, or a
 * template id is duplicated. A broken catalog must fail fast, not at send time.
 */
export class TemplateCatalogError extends Error {
  constructor(message: string) {
    super(`Inconsistent template catalog: ${message}`);
    this.name = "TemplateCatalogError";
  }
}
