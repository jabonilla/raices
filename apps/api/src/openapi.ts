/**
 * OpenAPI 3.1 document for the Raíces API, generated at runtime from the
 * Zod schemas — never hand-written.
 *
 * The schema components come from the exact Zod schemas that validate
 * ledger writes (apps/api/src/ledger/post.ts), which are exported for this
 * purpose. Because the document is built from those schemas on every call,
 * the published contract cannot drift from what the API validates: change
 * the Zod schema and the document changes with it, or the contract test
 * (apps/api/test/openapi.test.ts) fails.
 *
 * Two facts this module relies on:
 * - `CurrencySchema` declares its JSON representation via Zod 4 native
 *   `.meta()` at its definition site, so no OpenAPI tooling leaks into
 *   ledger code. Validation behavior is untouched.
 * - Component names come from `.meta({ id })` applied here. This avoids
 *   `extendZodWithOpenApi`, whose `ZodType.prototype` patching breaks when
 *   the schemas' zod copy differs from this module's — zod ships dual
 *   ESM/CJS builds with separate prototypes, and the bundler/test runner
 *   may load a different copy per importer.
 *
 * JSON mapping for Zod types with no JSON equivalent:
 * - `bigint` amounts are decimal strings on the wire (`^\d+$`).
 * - `Date` values are RFC 3339 date-time strings.
 */
import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";

import { CurrencySchema, EntrySchema, MoneySchema, PostRequestSchema } from "./ledger/post.js";

const generator = new OpenApiGeneratorV3([
  { type: "schema", schema: CurrencySchema.meta({ id: "Currency" }) },
  { type: "schema", schema: MoneySchema.meta({ id: "Money" }) },
  { type: "schema", schema: EntrySchema.meta({ id: "Entry" }) },
  { type: "schema", schema: PostRequestSchema.meta({ id: "PostRequest" }) },
]);

/**
 * Build the OpenAPI document. Built fresh on every call from the Zod
 * schemas, so callers always get the current contract.
 */
export function buildOpenApiDocument() {
  const { components } = generator.generateComponents();
  return {
    openapi: "3.1.0",
    info: {
      title: "Raíces API",
      version: "0.0.0",
      description: [
        "Cross-border payments: US sender, Guatemala recipient.",
        "",
        "The schema components below are generated at runtime from the Zod",
        "schemas that validate ledger writes (apps/api/src/ledger/post.ts).",
        "They are published ahead of the ledger HTTP endpoints so the",
        "contract is visible while those endpoints are still unbuilt.",
        "",
        "JSON mapping: bigint amounts are decimal strings on the wire,",
        "Date values are RFC 3339 date-time strings.",
      ].join("\n"),
    },
    // The route paths are documented inline: /health and /ready have no
    // Zod schemas, so there is nothing to generate them from. Only the
    // components above are generated.
    paths: {
      "/health": {
        get: {
          summary: "Liveness probe",
          description: "Returns 200 when the process is up. No dependencies checked.",
          responses: {
            "200": {
              description: "The process is up.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean", const: true } },
                    required: ["ok"],
                  },
                },
              },
            },
          },
        },
      },
      "/ready": {
        get: {
          summary: "Readiness probe",
          description: "Returns 200 when Postgres is reachable, 503 otherwise.",
          responses: {
            "200": {
              description: "The API can reach the database.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean", const: true } },
                    required: ["ok"],
                  },
                },
              },
            },
            "503": {
              description: "The database is unreachable.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean", const: false } },
                    required: ["ok"],
                  },
                },
              },
            },
          },
        },
      },
      "/openapi.json": {
        get: {
          summary: "This document",
          description: "The OpenAPI document, generated at runtime from the Zod schemas.",
          responses: {
            "200": {
              description: "The OpenAPI 3.1 document.",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
      },
    },
    components,
  };
}
