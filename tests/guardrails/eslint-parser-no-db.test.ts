import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * P3.3 requires the inbound parser to have no database access, enforced by a
 * lint rule rather than by review — the same arrangement as the P2.4 tier
 * classifier.
 *
 * apps/api/test/parse-message.test.ts passes whether or not the parser
 * touches a database: it simply never gives it one. This is what makes the
 * purity structural. A parser that could reach a database could start
 * deciding what somebody asked for from their history rather than from what
 * they typed, and the approval gate downstream would then be approving a
 * reading nobody can reproduce from the message.
 *
 * It lints real fixture files on the real paths, through the repo's own
 * eslint.config.js, so deleting the rule fails here.
 */

const REPO_ROOT = process.cwd();
/** Inside the ban. */
const PARSE_DIR = join(REPO_ROOT, "apps/api/src/messaging/parse");
/** Outside it: the messaging module that calls the parser does reach the DB. */
const MESSAGING_DIR = join(REPO_ROOT, "apps/api/src/messaging");

/** Distinct from every other guardrail fixture: these run in parallel workers. */
const FIXTURE_NAME = "__parser_guardrail_fixture__.ts";

const BANNED: Record<string, string> = {
  "the kysely query builder": `import { sql } from "kysely";\nexport { sql };\n`,
  "a kysely type": `import type { Kysely } from "kysely";\nexport type K = Kysely<never>;\n`,
  "the postgres driver": `import pg from "pg";\nexport { pg };\n`,
  "the shared db module": `export * from "../../db/schema.js";\n`,
  "the transaction helper": `export * from "../../db/serializable.js";\n`,
  "the conversation module": `export * from "../../conversation/index.js";\n`,
  "the requests module": `export * from "../../requests/index.js";\n`,
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

describe("guardrail: the inbound parser cannot import a database", () => {
  for (const [name, code] of Object.entries(BANNED)) {
    it(`reports an error for ${name}`, async () => {
      const errors = await errorsFor(PARSE_DIR, code);
      const banned = errors.filter((m) => m.ruleId !== null && IMPORT_RULES.has(m.ruleId));
      expect(
        banned.length,
        `Expected importing ${name} inside apps/api/src/messaging/parse/ to be a lint error. ` +
          `Got: ${JSON.stringify(errors)}`,
      ).toBeGreaterThan(0);
    });
  }

  for (const [name, code] of Object.entries(ALLOWED)) {
    it(`allows ${name}`, async () => {
      const errors = await errorsFor(PARSE_DIR, code);
      expect(errors, `Expected ${name} to lint cleanly inside the parser.`).toEqual([]);
    });
  }

  it("does not ban database imports in the messaging module around it", async () => {
    // The ban is the parser's boundary, not a rule against the code that
    // calls it — that code has to write a request. If this starts failing,
    // the scope has been widened past what the ticket asks for.
    const errors = await errorsFor(
      MESSAGING_DIR,
      `import { sql } from "kysely";\nexport { sql };\n`,
    );
    const banned = errors.filter((m) => m.ruleId !== null && IMPORT_RULES.has(m.ruleId));
    expect(banned).toEqual([]);
  });
});
