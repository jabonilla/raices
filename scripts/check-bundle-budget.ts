#!/usr/bin/env node
/**
 * Bundle-size budget (K2.22): exports the Android production JS bundle and
 * fails if it exceeds BUDGET_BYTES.
 *
 * The target user is often on an older Android with limited storage and
 * metered data, so bundle size is a product constraint, not vanity. This
 * check catches dependency bloat and accidental heavy imports before they
 * ship: a PR that pushes the bundle over budget fails CI until the growth is
 * trimmed or the budget is deliberately raised (with the reason in the PR).
 *
 * What is measured: the minified production JS bundle for Android produced
 * by `expo export --platform android --no-bytecode`. `--no-bytecode` skips
 * Hermes bytecode compilation: expo's hermesc lookup is broken for
 * react-native 0.81 (it throws resolving the `hermes-compiler` package before
 * trying the prebuilt binary react-native ships), and the minified JS is a
 * stable, version-independent proxy for shipped size. Source maps are
 * excluded; they do not ship to devices.
 *
 * Usage: pnpm check:bundle-budget
 * Exits 0 when the bundle is within budget, 1 otherwise.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MOBILE_DIR = join(REPO_ROOT, "apps", "mobile");

/**
 * Maximum allowed size of the Android production JS bundle, in bytes.
 *
 * Measured 2026-09-28: 1,928,525 bytes (1.84 MiB). Budget = measured + ~30%
 * headroom, rounded to a memorable number. The headroom absorbs normal growth
 * (new screens, small dependencies); an accidental heavyweight dependency
 * (hundreds of KB) consumes most of it and trips the check.
 *
 * To re-measure: run `pnpm check:bundle-budget` — it prints the measured
 * size. To raise the budget, update this constant and the measured figure
 * above, and say why in the PR. Never bump it silently to make CI pass.
 */
const BUDGET_BYTES = 2_500_000;

/** Resolve the expo CLI through the mobile workspace's own dependencies. */
function expoCliPath(): string {
  const mobileRequire = createRequire(join(MOBILE_DIR, "package.json"));
  const expoPackageJson = mobileRequire.resolve("expo/package.json");
  return join(dirname(expoPackageJson), "bin", "cli");
}

/** Sum the shipped JS bundles (never source maps) for Android. */
function androidJsBundleBytes(exportDir: string): number {
  const jsDir = join(exportDir, "_expo", "static", "js", "android");
  let total = 0;
  for (const name of readdirSync(jsDir)) {
    if (name.endsWith(".js") && !name.endsWith(".js.map")) {
      total += statSync(join(jsDir, name)).size;
    }
  }
  return total;
}

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString("en-US")} bytes (${(bytes / 1_048_576).toFixed(2)} MiB)`;
}

function main(): void {
  const outDir = mkdtempSync(join(tmpdir(), "raices-bundle-budget-"));
  try {
    console.log("--- bundle-budget: exporting Android production bundle ---");
    execFileSync(
      process.execPath,
      [expoCliPath(), "export", "--platform", "android", "--no-bytecode", "--output-dir", outDir],
      { cwd: MOBILE_DIR, stdio: "inherit" },
    );
    const measured = androidJsBundleBytes(outDir);
    console.log(`--- bundle-budget: measured ${formatBytes(measured)} ---`);
    console.log(`--- bundle-budget: budget   ${formatBytes(BUDGET_BYTES)} ---`);
    if (measured > BUDGET_BYTES) {
      console.error(
        `bundle-budget: FAIL — bundle exceeds budget by ${formatBytes(measured - BUDGET_BYTES)}. ` +
          "Trim the growth or deliberately raise BUDGET_BYTES in scripts/check-bundle-budget.ts (and say why in the PR).",
      );
      process.exit(1);
    }
    console.log("--- bundle-budget: PASS ---");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

main();
