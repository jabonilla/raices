import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tokens are the single source of truth (design system 2.x). A component
 * that hardcodes a color or a font size bypasses the system, so this test
 * fails on either — in any file under src/components.
 */

const COMPONENTS_DIR = join(__dirname, "..", "src", "components");

function componentFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? componentFiles(path) : [path];
  });
}

const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;
const HARDCODED_FONT_SIZE = /fontSize\s*:\s*\d/;

describe("design tokens are the single source of truth", () => {
  const files = componentFiles(COMPONENTS_DIR);

  it("has components to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const name = file.split("/").pop() ?? file;
    it(`${name}: no hardcoded colors`, () => {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(HEX_COLOR);
    });
    it(`${name}: no hardcoded font sizes`, () => {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(HARDCODED_FONT_SIZE);
    });
  }
});
