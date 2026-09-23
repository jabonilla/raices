import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

// Regression test for the mobile accessibility baseline (K2.7).
// If the mobile-a11y/require-accessibility-label rule or the
// allowFontScaling ban in eslint.config.js stops firing (rule deleted,
// plugin unwired, selector broken by an ESLint upgrade), CI stays green
// while the protection is gone. This test loads the repo's REAL
// eslint.config.js and lints real fixture files placed inside
// apps/mobile/ — the path the config's `files` pattern covers.

const REPO_ROOT = process.cwd();
const MOBILE_DIR = join(REPO_ROOT, "apps/mobile/app");
const FIXTURE_NAME = "__guardrail_a11y_fixture__.tsx";

const NO_LABEL_FIXTURE = `import { Pressable, Text } from "react-native";
export function Bad() {
  return (
    <Pressable onPress={() => {}}>
      <Text>Tap me</Text>
    </Pressable>
  );
}
`;

const WITH_LABEL_FIXTURE = `import { Pressable, Text } from "react-native";
export function Good() {
  return (
    <Pressable accessibilityLabel="Tap me" accessibilityRole="button" onPress={() => {}}>
      <Text>Tap me</Text>
    </Pressable>
  );
}
`;

const NO_FONT_SCALING_FIXTURE = `import { Text } from "react-native";
export function Bad() {
  return <Text allowFontScaling={false}>Fixed size</Text>;
}
`;

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

async function withFixture(code: string, fn: (filePath: string) => Promise<void>): Promise<void> {
  const dirExisted = existsSync(MOBILE_DIR);
  if (!dirExisted) {
    mkdirSync(MOBILE_DIR, { recursive: true });
  }
  const filePath = join(MOBILE_DIR, FIXTURE_NAME);
  writeFileSync(filePath, code, "utf8");
  try {
    await fn(filePath);
  } finally {
    rmSync(filePath, { force: true });
    if (!dirExisted) {
      try {
        rmSync(MOBILE_DIR, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}

function ruleErrors(messages: { ruleId?: string | null; severity?: number }[], ruleId: string) {
  return messages.filter((m) => m.ruleId === ruleId && m.severity === 2);
}

describe("guardrail: mobile accessibility baseline", () => {
  it("reports mobile-a11y/require-accessibility-label for a Pressable without a label", async () => {
    await withFixture(NO_LABEL_FIXTURE, async (filePath) => {
      const messages = await lintFixtureFile(filePath);
      const errors = ruleErrors(messages, "mobile-a11y/require-accessibility-label");
      expect(
        errors.length,
        `Expected the accessibility-label rule to fire. Got: ${JSON.stringify(messages)}`,
      ).toBeGreaterThan(0);
    });
  });

  it("does not flag a Pressable with an accessibility label", async () => {
    await withFixture(WITH_LABEL_FIXTURE, async (filePath) => {
      const messages = await lintFixtureFile(filePath);
      const errors = ruleErrors(messages, "mobile-a11y/require-accessibility-label");
      expect(errors).toEqual([]);
    });
  });

  it("reports no-restricted-syntax for allowFontScaling", async () => {
    await withFixture(NO_FONT_SCALING_FIXTURE, async (filePath) => {
      const messages = await lintFixtureFile(filePath);
      const errors = ruleErrors(messages, "no-restricted-syntax");
      expect(
        errors.length,
        `Expected the allowFontScaling ban to fire. Got: ${JSON.stringify(messages)}`,
      ).toBeGreaterThan(0);
    });
  });
});
