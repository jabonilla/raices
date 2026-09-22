import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * ADR-001: Postgres is used as plain Postgres. No PostgREST, no Edge
 * Functions, no Supabase client in the API. Keeping the SDK out of the
 * dependency tree is what makes that mechanical rather than a matter of
 * discipline.
 */
const BANNED_PREFIXES = ["@supabase/", "supabase"];

interface PackageJson {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

async function packageJsonPaths(dir: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await packageJsonPaths(full)));
    } else if (entry.name === "package.json") {
      found.push(full);
    }
  }

  return found;
}

it("no package.json depends on a Supabase SDK", async () => {
  const files = await packageJsonPaths(REPO_ROOT);
  expect(files.length).toBeGreaterThan(0);

  const offenders: string[] = [];

  for (const file of files) {
    const parsed = JSON.parse(await readFile(file, "utf8")) as PackageJson;
    const names = [
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.devDependencies ?? {}),
      ...Object.keys(parsed.peerDependencies ?? {}),
      ...Object.keys(parsed.optionalDependencies ?? {}),
    ];

    for (const name of names) {
      if (BANNED_PREFIXES.some((prefix) => name === prefix || name.startsWith(prefix))) {
        offenders.push(`${path.relative(REPO_ROOT, file)}: ${name}`);
      }
    }
  }

  expect(offenders).toEqual([]);
});
