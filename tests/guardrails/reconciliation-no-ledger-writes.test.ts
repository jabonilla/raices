import { join } from "node:path";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Regression test for the P1.5 rule that reconciliation never writes to the
 * ledger.
 *
 * The runtime test in apps/api/test/reconciliation.test.ts counts ledger rows
 * before and after a run, which catches a write that happens. This catches a
 * write that *could* happen: `ReconciliationDatabase` deliberately omits the
 * ledger tables, so a ledger write does not type-check. If someone widens
 * that type to the full `Database`, the row-count test still passes and the
 * protection is gone silently — unless this fails.
 */

const REPO_ROOT = process.cwd();
const RECON_SCHEMA = join(REPO_ROOT, "apps/api/src/reconciliation/schema.js");

interface Probe {
  readonly name: string;
  readonly code: string;
}

const PROBES: Probe[] = [
  {
    name: "insertInto a ledger table",
    code: `
      import type { Kysely } from "kysely";
      import type { ReconciliationDatabase } from "${RECON_SCHEMA}";
      export async function probe(db: Kysely<ReconciliationDatabase>) {
        await db.insertInto("ledger_entry").values({}).execute();
      }
    `,
  },
  {
    name: "selectFrom a ledger table",
    code: `
      import type { Kysely } from "kysely";
      import type { ReconciliationDatabase } from "${RECON_SCHEMA}";
      export async function probe(db: Kysely<ReconciliationDatabase>) {
        await db.selectFrom("ledger_transaction").selectAll().execute();
      }
    `,
  },
  {
    name: "deleteFrom a ledger table",
    code: `
      import type { Kysely } from "kysely";
      import type { ReconciliationDatabase } from "${RECON_SCHEMA}";
      export async function probe(db: Kysely<ReconciliationDatabase>) {
        await db.deleteFrom("ledger_account").execute();
      }
    `,
  },
];

/** A control: the reconciliation tables themselves must still compile. */
const ALLOWED: Probe = {
  name: "insertInto a reconciliation table",
  code: `
    import type { Kysely } from "kysely";
    import type { ReconciliationDatabase } from "${RECON_SCHEMA}";
    export async function probe(db: Kysely<ReconciliationDatabase>) {
      await db.selectFrom("reconciliation_run").select("id").execute();
    }
  `,
};

function diagnosticsFor(code: string): readonly ts.Diagnostic[] {
  const fileName = join(REPO_ROOT, "apps/api/src/reconciliation/__guardrail_probe__.ts");
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

describe("guardrail: reconciliation cannot reach the ledger", () => {
  for (const probe of PROBES) {
    it(`does not compile: ${probe.name}`, () => {
      const diagnostics = diagnosticsFor(probe.code);
      expect(
        diagnostics.length,
        `Expected ${probe.name} to be a type error against ReconciliationDatabase. ` +
          `If this passes, the type has been widened to include ledger tables.`,
      ).toBeGreaterThan(0);
    });
  }

  it(`still compiles: ${ALLOWED.name}`, () => {
    const diagnostics = diagnosticsFor(ALLOWED.code);
    expect(
      diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")),
      "The reconciliation tables themselves must remain reachable.",
    ).toEqual([]);
  });
});
