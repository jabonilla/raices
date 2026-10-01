/**
 * Production build for @raices/api (K2.29).
 *
 * Bundles the API and its workspace dependencies (@raices/*) into a single
 * ESM file with esbuild. Third-party dependencies stay external — they ship
 * in the image's node_modules via `pnpm install --prod`.
 *
 * Why not bundle everything: Fastify (via avvio) uses dynamic require()
 * calls that esbuild cannot statically bundle. Why not tsc: the workspace
 * packages ship TypeScript source (`main: ./src/index.ts`), so a tsc build
 * would need path rewriting; bundling the workspace code avoids that.
 *
 * Also bundles the migration runner (K2.43) as a second entrypoint:
 * scripts/migrate.ts -> dist/migrate.mjs. The Docker image ships both so
 * migrations can run as a pre-deploy command (tsx is not in the image).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(root, "..", "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};

// External: every third-party dependency. Workspace packages (@raices/*)
// are bundled from source.
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith("@raices/"));

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external,
  logLevel: "warning",
} as const;

await build({
  ...shared,
  entryPoints: [join(root, "src/index.ts")],
  outfile: join(root, "dist/index.mjs"),
});

// Migration runner: bundled from the repo-root scripts/ so the image can
// run migrations without tsx. pg stays external (in image node_modules);
// db-guard is bundled (relative import).
await build({
  ...shared,
  entryPoints: [join(repoRoot, "scripts/migrate.ts")],
  outfile: join(root, "dist/migrate.mjs"),
});
