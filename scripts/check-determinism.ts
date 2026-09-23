#!/usr/bin/env node
/**
 * Flake detection (K2.12): runs the full test suite twice in this job and
 * fails if any test's result differs between the two runs — a test that
 * passes once and fails once is a flake, and CI must not bless it.
 *
 * Usage: node scripts/check-determinism.mjs
 * Exits 0 when both runs agree, 1 otherwise (differences are printed).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RUN_1 = join(tmpdir(), "raices-determinism-1.json");
const RUN_2 = join(tmpdir(), "raices-determinism-2.json");

/** The slice of Vitest's JSON reporter output this script reads. */
interface VitestJsonReport {
  readonly testResults?: readonly {
    readonly name: string;
    readonly assertionResults?: readonly {
      readonly fullName: string;
      readonly status: string;
    }[];
  }[];
}

function runSuite(outFile: string, label: string): void {
  console.log(`--- determinism: ${label} ---`);
  try {
    execFileSync("pnpm", ["vitest", "run", "--reporter=json", `--outputFile=${outFile}`], {
      stdio: "inherit",
    });
  } catch {
    // A failing suite is make verify's problem; ours is whether the two
    // runs agree. Keep going so the comparison still reports.
    console.log(`--- determinism: ${label} exited non-zero, still comparing ---`);
  }
}

/** file > test fullName -> status */
function summarize(path: string): Map<string, string> {
  const data = JSON.parse(readFileSync(path, "utf8")) as VitestJsonReport;
  const map = new Map<string, string>();
  for (const file of data.testResults ?? []) {
    for (const test of file.assertionResults ?? []) {
      map.set(`${file.name} > ${test.fullName}`, test.status);
    }
  }
  return map;
}

runSuite(RUN_1, "run 1 of 2");
runSuite(RUN_2, "run 2 of 2");

const first = summarize(RUN_1);
const second = summarize(RUN_2);
let differences = 0;

for (const [key, status1] of first) {
  const status2 = second.get(key);
  if (status2 === undefined) {
    console.error(`ONLY IN RUN 1: ${key} (${status1})`);
    differences += 1;
  } else if (status1 !== status2) {
    console.error(`FLAKY: ${key}: run 1 = ${status1}, run 2 = ${status2}`);
    differences += 1;
  }
}
for (const key of second.keys()) {
  if (!first.has(key)) {
    console.error(`ONLY IN RUN 2: ${key} (${second.get(key) ?? "unknown"})`);
    differences += 1;
  }
}

rmSync(RUN_1, { force: true });
rmSync(RUN_2, { force: true });

if (differences > 0) {
  console.error(
    `determinism check FAILED: ${String(differences)} difference(s) between the two runs`,
  );
  process.exit(1);
}
console.log(`determinism check passed: ${String(first.size)} tests identical across both runs`);
