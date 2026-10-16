import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { androidJsBundleBytes } from "./check-bundle-budget.js";

/** Build a synthetic expo export layout with the given files in the Android js dir. */
function syntheticExport(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "bundle-budget-test-"));
  const jsDir = join(dir, "_expo", "static", "js", "android");
  mkdirSync(jsDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(jsDir, name), content);
  }
  return dir;
}

function withExport(files: Record<string, string>, fn: (dir: string) => void): void {
  const dir = syntheticExport(files);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("androidJsBundleBytes (CI-6)", () => {
  it("sums .js bundles and ignores source maps", () => {
    withExport({ "index-abc.js": "x".repeat(100), "index-abc.js.map": "y".repeat(9999) }, (dir) => {
      expect(androidJsBundleBytes(dir)).toBe(100);
    });
  });

  it("fails closed when the export directory contains no .js bundles", () => {
    // CI-6: an empty export must not read as zero bytes (within budget).
    withExport({}, (dir) => {
      expect(() => androidJsBundleBytes(dir)).toThrow(/no \.js bundles found/);
    });
  });

  it("fails closed when only source maps are present", () => {
    withExport({ "index-abc.js.map": "y".repeat(10) }, (dir) => {
      expect(() => androidJsBundleBytes(dir)).toThrow(/no \.js bundles found/);
    });
  });
});
