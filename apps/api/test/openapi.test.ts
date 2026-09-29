/**
 * Runtime/document contract test for the OpenAPI document.
 *
 * The document (src/openapi.ts) is generated from the Zod schemas in
 * src/ledger/post.ts. This test proves the generation is faithful: for a
 * battery of JSON values — valid and invalid — AJV validation against the
 * document's schemas agrees with Zod validation of the same values. If
 * someone changes a Zod schema, the document updates automatically; if the
 * generation ever misrepresents a schema, this test fails.
 *
 * The schemas validate JS values (bigint, Date) while the document
 * describes JSON. The test therefore converts each JSON case to the JS
 * value Zod sees: decimal strings become bigints, date-time strings become
 * Dates. That mapping is the documented wire contract.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";

import { buildApp } from "../src/app.js";
import { buildOpenApiDocument } from "../src/openapi.js";
import { CurrencySchema, EntrySchema, MoneySchema, PostRequestSchema } from "../src/ledger/post.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

interface JsonCase {
  readonly name: string;
  /** The value as it appears on the wire (JSON). */
  readonly json: unknown;
  readonly valid: boolean;
}

const UUID_A = "123e4567-e89b-12d3-a456-426614174000";
const UUID_B = "123e4567-e89b-12d3-a456-426614174001";
const WHEN = "2026-09-23T12:00:00.000Z";

function debitEntry(overrides: Record<string, unknown> = {}) {
  return {
    accountId: UUID_A,
    direction: "debit",
    amount: { amount: "100", currency: "USD" },
    entryType: "transfer",
    ...overrides,
  };
}

function creditEntry(overrides: Record<string, unknown> = {}) {
  return {
    accountId: UUID_B,
    direction: "credit",
    amount: { amount: "100", currency: "USD" },
    entryType: "transfer",
    ...overrides,
  };
}

function postRequest(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: "key-1",
    description: "remittance",
    occurredAt: WHEN,
    entries: [debitEntry(), creditEntry()],
    ...overrides,
  };
}

const postRequestCases: JsonCase[] = [
  { name: "valid request", json: postRequest(), valid: true },
  { name: "missing description", json: postRequest({ description: undefined }), valid: false },
  { name: "empty idempotencyKey", json: postRequest({ idempotencyKey: "" }), valid: false },
  { name: "one entry is not enough", json: postRequest({ entries: [debitEntry()] }), valid: false },
  { name: "no entries", json: postRequest({ entries: [] }), valid: false },
  {
    name: "unknown currency",
    json: postRequest({
      entries: [debitEntry({ amount: { amount: "100", currency: "XXX" } }), creditEntry()],
    }),
    valid: false,
  },
  {
    name: "GTQ is accepted",
    json: postRequest({
      entries: [
        debitEntry({ amount: { amount: "100", currency: "GTQ" } }),
        creditEntry({ amount: { amount: "100", currency: "GTQ" } }),
      ],
    }),
    valid: true,
  },
  {
    name: "negative amount",
    json: postRequest({
      entries: [debitEntry({ amount: { amount: "-5", currency: "USD" } }), creditEntry()],
    }),
    valid: false,
  },
  {
    name: "fractional amount string",
    json: postRequest({
      entries: [debitEntry({ amount: { amount: "10.5", currency: "USD" } }), creditEntry()],
    }),
    valid: false,
  },
  {
    name: "non-uuid account",
    json: postRequest({ entries: [debitEntry({ accountId: "not-a-uuid" }), creditEntry()] }),
    valid: false,
  },
  {
    name: "bad direction",
    json: postRequest({ entries: [debitEntry({ direction: "sideways" }), creditEntry()] }),
    valid: false,
  },
  {
    name: "empty entryType",
    json: postRequest({ entries: [debitEntry({ entryType: "" }), creditEntry()] }),
    valid: false,
  },
  { name: "bad occurredAt", json: postRequest({ occurredAt: "not-a-date" }), valid: false },
];

const moneyCases: JsonCase[] = [
  { name: "valid money", json: { amount: "100", currency: "USD" }, valid: true },
  { name: "zero amount", json: { amount: "0", currency: "USD" }, valid: false },
  { name: "unknown currency", json: { amount: "100", currency: "XXX" }, valid: false },
];

const entryCases: JsonCase[] = [
  { name: "valid entry", json: debitEntry(), valid: true },
  { name: "bad direction", json: debitEntry({ direction: "up" }), valid: false },
];

const currencyCases: JsonCase[] = [
  { name: "USD", json: "USD", valid: true },
  { name: "GTQ", json: "GTQ", valid: true },
  { name: "XXX", json: "XXX", valid: false },
  { name: "lowercase usd", json: "usd", valid: false },
];

/** Convert a JSON-case value to the JS value the Zod schema validates. */
function jsonToJs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonToJs);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (key === "amount" && typeof val === "string") {
        // Money.amount: decimal string on the wire, bigint in JS.
        // BigInt() throws on non-numeric strings; that is a validation
        // failure, which is what the case expects.
        try {
          out[key] = BigInt(val);
        } catch {
          out[key] = val;
        }
      } else if (key === "occurredAt" && typeof val === "string") {
        out[key] = new Date(val);
      } else {
        out[key] = jsonToJs(val);
      }
    }
    return out;
  }
  return value;
}

describe("openapi document", () => {
  it("is a valid OpenAPI 3.1 document with the generated components", () => {
    const doc = buildOpenApiDocument() as unknown as Record<string, unknown>;

    expect(doc["openapi"]).toBe("3.1.0");
    expect(doc["info"]).toMatchObject({ title: "Raíces API" });

    const paths = doc["paths"] as Record<string, unknown>;
    expect(Object.keys(paths).sort()).toEqual(["/health", "/openapi.json", "/ready"]);

    const schemas = (doc["components"] as { schemas: Record<string, unknown> })["schemas"];
    expect(Object.keys(schemas).sort()).toEqual(["Currency", "Entry", "Money", "PostRequest"]);
  });

  it("is served at /openapi.json", async () => {
    const response = await app.inject({ method: "GET", url: "/openapi.json" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    const body = response.json<Record<string, unknown>>();
    expect(body["openapi"]).toBe("3.1.0");
    expect(body).toEqual(buildOpenApiDocument());
  });
});

describe("document/zod contract", () => {
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);

  const doc = buildOpenApiDocument() as unknown as {
    components: { schemas: Record<string, object> };
  };
  const schemas = doc.components.schemas;

  // Register every component under its document path so $refs resolve.
  for (const [name, schema] of Object.entries(schemas)) {
    ajv.addSchema({ ...schema, $id: `#/components/schemas/${name}` });
  }

  function checkContract(
    componentName: "Currency" | "Money" | "Entry" | "PostRequest",
    zodSchema: { safeParse(v: unknown): { success: boolean } },
    cases: JsonCase[],
  ) {
    const validate = ajv.compile({
      $ref: `#/components/schemas/${componentName}`,
    } as object);
    for (const c of cases) {
      const docResult = validate(c.json);
      const zodResult = zodSchema.safeParse(jsonToJs(c.json)).success;
      expect(
        { case: c.name, document: docResult, zod: zodResult },
        `contract mismatch on ${componentName} case "${c.name}"`,
      ).toEqual({ case: c.name, document: c.valid, zod: c.valid });
    }
  }

  it("Currency: document agrees with Zod", () => {
    checkContract("Currency", CurrencySchema, currencyCases);
  });

  it("Money: document agrees with Zod", () => {
    checkContract("Money", MoneySchema, moneyCases);
  });

  it("Entry: document agrees with Zod", () => {
    checkContract("Entry", EntrySchema, entryCases);
  });

  it("PostRequest: document agrees with Zod", () => {
    checkContract("PostRequest", PostRequestSchema, postRequestCases);
  });
});
