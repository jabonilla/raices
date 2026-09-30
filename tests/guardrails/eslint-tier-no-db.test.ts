import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * P2.4 requires the tier classifier to have no database access, enforced by a
 * lint rule rather than by review.
 *
 * The runtime tests in apps/api/test/tier.test.ts pass whether or not the
 * function touches a database — they simply never give it one. This is what
 * makes the purity structural: everything under apps/api/src/requests/tier/
 * is forbidden from importing a database module at all, so a future change
 * that reaches for one fails to lint instead of quietly making the classifier
 * untestable.
 *
 * It lints real fixture files on the real paths, through the repo's own
 * eslint.config.js, so deleting the rule fails here.
 */

const REPO_ROOT = process.cwd();
/** Inside the ban. */
const TIER_DIR = join(REPO_ROOT, "apps/api/src/requests/tier");
/** Outside it: the rest of the requests module may of course reach the DB. */
const REQUESTS_DIR = join(REPO_ROOT, "apps/api/src/requests");

// Distinct from the float-ban guardrail's fixture name. Both lint files in
// apps/api/src/requests/, both run in parallel workers, and a shared name
// means one test reads the other's contents.
const FIXTURE_NAME = "__tier_guardrail_fixture__.ts";

const BANNED: Record<string, string> = {
  "the kysely query builder": `import { sql } from "kysely";\nexport { sql };\n`,
  "a kysely type": `import type { Kysely } from "kysely";\nexport type K = Kysely<never>;\n`,
  "the postgres driver": `import pg from "pg";\nexport { pg };\n`,
  "the shared db module": `export * from "../../db/schema.js";\n`,
  "a sibling schema module": `export * from "../schema.js";\n`,
  "the transaction helper": `export * from "../../db/serializable.js";\n`,
  "a dynamic import of kysely": `export const load = async () => import("kysely");\n`,
};

const ALLOWED: Record<string, string> = {
  "the money package": `import { money } from "@raices/money";\nexport { money };\n`,
  "nothing at all": `export const two = 2;\n`,
};

function makeEslint(): ESLint {
  return new ESLint({ overrideConfigFile: "eslint.config.js" });
}

async function withFixture<T>(
  dir: string,
  code: string,
  fn: (filePath: string) => Promise<T>,
): Promise<T> {
  const dirExisted = existsSync(dir);
  if (!dirExisted) mkdirSync(dir, { recursive: true });
  const filePath = join(dir, FIXTURE_NAME);
  writeFileSync(filePath, code, "utf8");
  try {
    return await fn(filePath);
  } finally {
    rmSync(filePath, { force: true });
    if (!dirExisted) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}

async function errorsFor(dir: string, code: string) {
  return withFixture(dir, code, async (filePath) => {
    const results = await makeEslint().lintFiles([filePath]);
    return (results[0]?.messages ?? []).filter((m) => m.severity === 2);
  });
}

const IMPORT_RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);

describe("guardrail: the tier classifier cannot import a database", () => {
  for (const [name, code] of Object.entries(BANNED)) {
    it(`reports an error for ${name}`, async () => {
      const errors = await errorsFor(TIER_DIR, code);
      const banned = errors.filter((m) => m.ruleId !== null && IMPORT_RULES.has(m.ruleId));
      expect(
        banned.length,
        `Expected importing ${name} inside apps/api/src/requests/tier/ to be a lint error. ` +
          `Got: ${JSON.stringify(errors)}`,
      ).toBeGreaterThan(0);
    });
  }

  for (const [name, code] of Object.entries(ALLOWED)) {
    it(`allows ${name}`, async () => {
      const errors = await errorsFor(TIER_DIR, code);
      expect(errors, `Expected ${name} to lint cleanly inside the tier module.`).toEqual([]);
    });
  }

  it("does not ban database imports elsewhere in the requests module", async () => {
    // The ban is the classifier's boundary, not a rule against the module
    // that calls it. If this starts failing, the scope has been widened past
    // what the ticket asks for.
    const errors = await errorsFor(
      REQUESTS_DIR,
      `import { sql } from "kysely";\nexport { sql };\n`,
    );
    const banned = errors.filter((m) => m.ruleId !== null && IMPORT_RULES.has(m.ruleId));
    expect(banned).toEqual([]);
  });
});
