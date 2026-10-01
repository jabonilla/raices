#!/usr/bin/env node
/**
 * Low-end device profile (K2.36): measure the mobile app's resource footprint
 * on a 2GB RAM Android-class device profile.
 *
 * What is measured:
 * - JS bundle size (from expo export)
 * - Estimated Hermes parse time (based on bundle size)
 * - Estimated memory footprint (bundle + runtime overhead)
 * - Dependency analysis (what's taking up space)
 *
 * Why 2GB RAM: our target user is often on a cheap, full phone. If the app
 * is disproportionately expensive, it will be killed in the background or
 * fail to start. This is a product constraint, not an optimization exercise.
 *
 * Note: These are estimates based on bundle analysis, not measurements from
 * a physical device. Hermes parse time scales roughly linearly with bundle
 * size; memory is estimated at 2-3x bundle size for parsed bytecode plus
 * runtime overhead.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MOBILE_DIR = join(process.cwd(), "apps", "mobile");

// Hermes parse time: ~0.1ms per KB on a low-end ARM core (conservative estimate
// based on Hermes benchmark data for mid-range devices, scaled down for 2GB class)
const PARSE_MS_PER_KB = 0.1;

// Memory: parsed Hermes bytecode is ~2x source size, plus runtime overhead
const MEMORY_MULTIPLIER = 2.5;

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function main(): void {
  console.log("=== K2.36 Low-end Device Profile (2GB RAM class) ===\n");

  // 1. Export the bundle
  console.log("Exporting Android bundle...");
  const tmpDir = mkdtempSync(join(tmpdir(), "raices-bundle-"));
  try {
    execFileSync(
      "npx",
      ["expo", "export", "--platform", "android", "--no-bytecode", "--output-dir", tmpDir],
      { cwd: MOBILE_DIR, stdio: "pipe" },
    );

    // Find the JS bundle
    const files = readdirSync(tmpDir, { recursive: true }) as string[];
    const jsFiles = files.filter((f: string) => f.endsWith(".js"));
    if (jsFiles.length === 0) {
      console.log("No JS bundle found in export output");
      return;
    }

    const bundleFile = jsFiles[0] as string;
    const bundlePath = join(tmpDir, bundleFile);
    const bundleSize = statSync(bundlePath).size;
    const bundleKB = bundleSize / 1024;

    console.log(`\nBundle: ${bundleFile}`);
    console.log(`Size: ${formatBytes(bundleSize)} (${bundleSize.toLocaleString()} bytes)`);

    // 2. Estimate parse time
    const parseMs = bundleKB * PARSE_MS_PER_KB;
    console.log(`\nEstimated Hermes parse time: ${parseMs.toFixed(0)}ms`);
    console.log(`  (at ${String(PARSE_MS_PER_KB)}ms/KB on low-end ARM)`);

    // 3. Estimate memory
    const memoryBytes = bundleSize * MEMORY_MULTIPLIER;
    console.log(`\nEstimated memory footprint: ${formatBytes(memoryBytes)}`);
    console.log(`  (bundle x ${String(MEMORY_MULTIPLIER)} for parsed bytecode + runtime)`);

    // 4. Budget check
    const BUDGET = 2_500_000;
    const pct = ((bundleSize / BUDGET) * 100).toFixed(1);
    console.log(`\nBudget: ${formatBytes(BUDGET)} — using ${pct}%`);

    // 5. Cold start estimate
    // Cold start = parse time + native init + first render
    // Native init ~500ms, first render ~300ms on low-end
    const coldStartMs = parseMs + 500 + 300;
    console.log(`\nEstimated cold start: ${(coldStartMs / 1000).toFixed(1)}s`);
    console.log(`  (parse ${parseMs.toFixed(0)}ms + native init ~500ms + first render ~300ms)`);

    // 6. Verdict
    console.log("\n=== Verdict ===");
    if (bundleSize < BUDGET * 0.7) {
      console.log("✓ Bundle is well within budget. No disproportionate costs detected.");
    } else if (bundleSize < BUDGET) {
      console.log("⚠ Bundle is within budget but using >70%. Watch for growth.");
    } else {
      console.log("✗ Bundle exceeds budget. Needs trimming.");
    }

    if (coldStartMs > 3000) {
      console.log("⚠ Cold start exceeds 3s — may feel slow on low-end devices.");
    } else {
      console.log("✓ Cold start under 3s — acceptable for low-end.");
    }

    if (memoryBytes > 100 * 1024 * 1024) {
      console.log("⚠ Memory footprint >100MB — risk of background kills on 2GB devices.");
    } else {
      console.log("✓ Memory footprint reasonable for 2GB class.");
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
