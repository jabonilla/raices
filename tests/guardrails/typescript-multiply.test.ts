import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { join } from "node:path";

// Regression test for the multiply-without-rounding guardrail.
// packages/money requires an explicit rounding mode; omitting it must be
// a TypeScript compile error (enforced by @ts-expect-error in
// packages/money/test/multiply.test.ts). This test creates a fixture that
// calls multiply() without a rounding mode and asserts tsc still reports
// an error. If TypeScript stops erroring (e.g. a default rounding mode is
// added), this test fails.

const REPO_ROOT = process.cwd();
const MONEY_INDEX = join(REPO_ROOT, "packages/money/src/index.js");

const FIXTURE = `
import { multiply, money } from "${MONEY_INDEX}";
const usd = (amount: bigint) => money(amount, "USD");
// Missing rounding mode — must not compile.
const result = multiply(usd(100n), { num: 1n, den: 2n });
console.log(result);
`;

describe("guardrail: multiply requires explicit rounding mode", () => {
  it("tsc reports an error when rounding mode is omitted", () => {
    const fileName = "guardrail-fixture.ts";
    const host = ts.createCompilerHost({
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
    });

    const originalGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, ...rest) => {
      if (name === fileName) {
        return ts.createSourceFile(name, FIXTURE, languageVersion, true);
      }
      return originalGetSourceFile(name, languageVersion, ...rest);
    };
    host.fileExists = (name) => name === fileName || ts.sys.fileExists(name);
    host.readFile = (name) => (name === fileName ? FIXTURE : ts.sys.readFile(name));

    const program = ts.createProgram(
      [fileName],
      {
        strict: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        noEmit: true,
        skipLibCheck: true,
      },
      host,
    );

    const diagnostics = ts.getPreEmitDiagnostics(program);
    const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);

    // The error must be specifically about the missing rounding mode argument,
    // not just any error (e.g. an import failure would also produce errors
    // but wouldn't prove the guardrail is working).
    const roundingModeErrors = errors.filter((d) => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
      return message.includes("Expected 3 arguments, but got 2") || message.includes("rounding");
    });

    expect(
      roundingModeErrors.length,
      `Expected tsc to error specifically on the missing rounding mode. ` +
        `Got ${String(errors.length)} errors: ${errors
          .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
          .join("; ")}`,
    ).toBeGreaterThan(0);
  });
});
