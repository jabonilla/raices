import { join } from "node:path";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * PRD invariant 3: a declined request never becomes a transaction.
 *
 * apps/api/test/requests.test.ts counts ledger rows across a submit-and-
 * decline cycle, which catches a posting that happens. This catches one that
 * *could* happen: `RequestDatabase` deliberately omits the ledger tables, so
 * no code in the requests module can post at all, declined or otherwise. If
 * someone widens that type to the full `Database`, the row-count test still
 * passes and the protection is gone silently — unless this fails.
 */

const REPO_ROOT = process.cwd();
const REQUEST_SCHEMA = join(REPO_ROOT, "apps/api/src/requests/schema.js");

interface Probe {
  readonly name: string;
  readonly code: string;
}

const PROBES: readonly Probe[] = [
  {
    name: "insertInto a ledger transaction",
    code: `await db.insertInto("ledger_transaction").values({}).execute();`,
  },
  {
    name: "insertInto a ledger entry",
    code: `await db.insertInto("ledger_entry").values({}).execute();`,
  },
  {
    name: "selectFrom a ledger table",
    code: `await db.selectFrom("ledger_transaction").selectAll().execute();`,
  },
  {
    name: "deleteFrom a ledger table",
    code: `await db.deleteFrom("ledger_account").execute();`,
  },
];

/** Controls: the tables the requests module legitimately needs. */
const ALLOWED: readonly Probe[] = [
  { name: "selectFrom request", code: `await db.selectFrom("request").select("id").execute();` },
  { name: "selectFrom category", code: `await db.selectFrom("category").select("id").execute();` },
  {
    name: "insertInto audit_log",
    code: `await db.selectFrom("audit_log").select("id").execute();`,
  },
];

function source(body: string): string {
  return `
    import type { Kysely } from "kysely";
    import type { RequestDatabase } from "${REQUEST_SCHEMA}";
    export async function probe(db: Kysely<RequestDatabase>) {
      ${body}
    }
  `;
}

function diagnosticsFor(code: string): readonly ts.Diagnostic[] {
  const fileName = join(REPO_ROOT, "apps/api/src/requests/__guardrail_probe__.ts");
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

describe("guardrail: the requests module cannot reach the ledger", () => {
  for (const probe of PROBES) {
    it(`does not compile: ${probe.name}`, () => {
      expect(
        diagnosticsFor(source(probe.code)).length,
        `Expected ${probe.name} to be a type error against RequestDatabase. ` +
          `If this passes, the type has been widened to include ledger tables.`,
      ).toBeGreaterThan(0);
    });
  }

  for (const probe of ALLOWED) {
    it(`still compiles: ${probe.name}`, () => {
      expect(
        diagnosticsFor(source(probe.code)).map((d) =>
          ts.flattenDiagnosticMessageText(d.messageText, " "),
        ),
        "The tables the requests module needs must remain reachable.",
      ).toEqual([]);
    });
  }
});
