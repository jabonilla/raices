import { join } from "node:path";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * CLAUDE.md rule 4: intent state and settlement state are separate fields and
 * neither is derived from the other.
 *
 * apps/api/test/transactions-schema.test.ts checks the database side — no
 * third column, no generated column, no view folding the two together. This
 * checks the type side, which catches the earlier mistake: code that treats a
 * value of one as a value of the other. The two unions are disjoint, so
 * assigning across them does not compile, and `TransactionTable` has no
 * combined field to reach for instead.
 *
 * Without this, someone can widen either union to include the other's members
 * and the database tests still pass, because nothing would have written a
 * bad value yet.
 */

const REPO_ROOT = process.cwd();
const SCHEMA = join(REPO_ROOT, "apps/api/src/transactions/schema.js");

interface Probe {
  readonly name: string;
  readonly code: string;
}

const MUST_NOT_COMPILE: readonly Probe[] = [
  {
    name: "a settlement state used as an intent state",
    code: `
      import type { IntentState, SettlementState } from "${SCHEMA}";
      export function probe(s: SettlementState): IntentState { return s; }
    `,
  },
  {
    name: "an intent state used as a settlement state",
    code: `
      import type { IntentState, SettlementState } from "${SCHEMA}";
      export function probe(i: IntentState): SettlementState { return i; }
    `,
  },
  {
    name: '"settled" as an intent state',
    code: `
      import type { IntentState } from "${SCHEMA}";
      export const probe: IntentState = "settled";
    `,
  },
  {
    name: '"committed" as a settlement state',
    code: `
      import type { SettlementState } from "${SCHEMA}";
      export const probe: SettlementState = "committed";
    `,
  },
  {
    name: "a combined status field on the row type",
    code: `
      import type { TransactionTable } from "${SCHEMA}";
      export type Probe = TransactionTable["status"];
    `,
  },
  {
    name: "a combined state field on the row type",
    code: `
      import type { TransactionTable } from "${SCHEMA}";
      export type Probe = TransactionTable["state"];
    `,
  },
];

const MUST_COMPILE: readonly Probe[] = [
  {
    name: "both fields read separately",
    code: `
      import type { IntentState, SettlementState, TransactionTable } from "${SCHEMA}";
      export function probe(row: { intent_state: IntentState; settlement_state: SettlementState }) {
        return [row.intent_state, row.settlement_state] as const;
      }
      export type Row = TransactionTable;
    `,
  },
];

function diagnosticsFor(code: string): readonly ts.Diagnostic[] {
  const fileName = join(REPO_ROOT, "apps/api/src/transactions/__guardrail_probe__.ts");
  const host = ts.createCompilerHost({}, true);
  const original = host.getSourceFile.bind(host);

  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    if (name === fileName) {
      return ts.createSourceFile(name, code, languageVersion, true, ts.ScriptKind.TS);
    }
    return original(name, languageVersion, onError, shouldCreate);
  };
  host.fileExists = (name) => (name === fileName ? true : ts.sys.fileExists(name));
  host.readFile = (name) => (name === fileName ? code : ts.sys.readFile(name));

  const program = ts.createProgram({
    rootNames: [fileName],
    options: {
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
    },
    host,
  });

  return ts.getPreEmitDiagnostics(program).filter((d) => d.file?.fileName === fileName);
}

describe("guardrail: intent and settlement states cannot be conflated", () => {
  for (const probe of MUST_NOT_COMPILE) {
    it(`does not compile: ${probe.name}`, () => {
      expect(
        diagnosticsFor(probe.code).length,
        `Expected ${probe.name} to be a type error. If this passes, the two state ` +
          `types have been merged or a combined field has been added.`,
      ).toBeGreaterThan(0);
    });
  }

  for (const probe of MUST_COMPILE) {
    it(`still compiles: ${probe.name}`, () => {
      expect(
        diagnosticsFor(probe.code).map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")),
        "Reading the two fields separately must remain possible.",
      ).toEqual([]);
    });
  }
});
