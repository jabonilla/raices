import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

// Regression test for the float ban guardrail (CLAUDE.md rule 1).
// If the no-restricted-syntax selectors in eslint.config.js stop firing
// (e.g. an ESLint upgrade changes selector semantics, or someone deletes
// the rule), CI stays green while the protection is gone. This test loads
// the repo's REAL eslint.config.js and lints real fixture files placed
// inside packages/money/src/ and apps/api/src/ledger/ — the paths the
// config's `files` pattern actually covers. It fails if the rule stops
// firing on those paths.

const FIXTURES: Record<string, string> = {
  "Number() call": `const amount = Number("123.45");\nexport { amount };\n`,
  "new Number()": `const amount = new Number("123.45");\nexport { amount };\n`,
  "parseFloat() call": `const amount = parseFloat("123.45");\nexport { amount };\n`,
  "Number.parseFloat()": `const amount = Number.parseFloat("123.45");\nexport { amount };\n`,
};

const REPO_ROOT = process.cwd();
// Paths the float ban config covers (must match eslint.config.js `files`).
const MONEY_DIR = join(REPO_ROOT, "packages/money/src");
const LEDGER_DIR = join(REPO_ROOT, "apps/api/src/ledger");
// Path outside the float ban scope — the rule must NOT fire here.
const OUTSIDE_DIR = join(REPO_ROOT, "apps/api/src");

const FIXTURE_NAME = "__guardrail_fixture__.ts";

function makeEslint(): ESLint {
  return new ESLint({
    // Load the repo's real config, not a copy of the rules.
    overrideConfigFile: "eslint.config.js",
  });
}

async function lintFixtureFile(filePath: string) {
  const eslint = makeEslint();
  const results = await eslint.lintFiles([filePath]);
  return results[0]?.messages ?? [];
}

async function withFixture(
  dir: string,
  code: string,
  fn: (filePath: string) => Promise<void>,
): Promise<void> {
  // Create the directory if it doesn't exist (e.g. apps/api/src/ledger/
  // may not exist yet). Track whether we created it so we can clean up.
  const dirExisted = existsSync(dir);
  if (!dirExisted) {
    mkdirSync(dir, { recursive: true });
  }
  const filePath = join(dir, FIXTURE_NAME);
  writeFileSync(filePath, code, "utf8");
  try {
    await fn(filePath);
  } finally {
    rmSync(filePath, { force: true });
    // Remove the directory if we created it and it's now empty.
    if (!dirExisted) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}

describe("guardrail: float ban in money paths", () => {
  for (const [dirName, dir] of [
    ["packages/money/src", MONEY_DIR],
    ["apps/api/src/ledger", LEDGER_DIR],
  ] as const) {
    for (const [name, code] of Object.entries(FIXTURES)) {
      it(`reports an error for ${name} in ${dirName}`, async () => {
        await withFixture(dir, code, async (filePath) => {
          const messages = await lintFixtureFile(filePath);
          const floatBanErrors = messages.filter(
            (m) => m.ruleId === "no-restricted-syntax" && m.severity === 2,
          );
          expect(
            floatBanErrors.length,
            `Expected the float ban to fire on ${name} in ${dirName}. ` +
              `Got: ${JSON.stringify(messages)}`,
          ).toBeGreaterThan(0);
        });
      });
    }

    it(`does not flag bigint money math in ${dirName}`, async () => {
      const code = `const amount = 12345n;\nexport { amount };\n`;
      await withFixture(dir, code, async (filePath) => {
        const messages = await lintFixtureFile(filePath);
        const floatBanErrors = messages.filter(
          (m) => m.ruleId === "no-restricted-syntax" && m.severity === 2,
        );
        expect(floatBanErrors).toEqual([]);
      });
    });
  }

  it("does not apply the float ban outside money/ledger paths", async () => {
    // The float ban is scoped to packages/money and apps/api/src/ledger.
    // A fixture with float math outside both must NOT trigger it.
    const code = `const amount = Number("123.45");\nexport { amount };\n`;
    await withFixture(OUTSIDE_DIR, code, async (filePath) => {
      const messages = await lintFixtureFile(filePath);
      const floatBanErrors = messages.filter(
        (m) => m.ruleId === "no-restricted-syntax" && m.severity === 2,
      );
      expect(floatBanErrors).toEqual([]);
    });
  });
});
