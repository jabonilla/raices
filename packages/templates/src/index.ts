export {
  CATALOG,
  getTemplate,
  isCopyPending,
  templateBody,
  templatesPendingCopy,
} from "./catalog.js";
export {
  MissingTemplateVariableError,
  TemplateCatalogError,
  UnexpectedTemplateVariableError,
  UnknownTemplateError,
  UnknownTemplateLocaleError,
} from "./errors.js";
export { renderTemplate } from "./render.js";
export {
  TEMPLATE_IDS,
  slotsOf,
  type MetaTemplateCategory,
  type TemplateDefinition,
  type TemplateId,
  type TemplateLocale,
  type TemplateVariables,
} from "./types.js";
