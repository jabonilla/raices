/**
 * Production build for @raices/api (K2.29, K2.45).
 *
 * Bundles the API, its workspace dependencies (@raices/*), AND its
 * third-party dependencies into single ESM files with esbuild. The runtime
 * image ships no node_modules at all — just node, the two bundles, and the
 * SQL migrations — so there is nothing to drift between the bundle's
 * imports and the image's installed set (K2.45: the final stage's
 * `pnpm install --prod` resolved the root project's dep set, not
 * @raices/api's, and the container died on `Cannot find package 'fastify'`).
 *
 * Why not tsc: the workspace packages ship TypeScript source
 * (`main: ./src/index.ts`), so a tsc build would need path rewriting;
 * bundling the workspace code avoids that.
 *
 * Two entrypoints:
 *   src/index.ts     -> dist/index.mjs    (the API server)
 *   scripts/migrate.ts -> dist/migrate.mjs (pre-deploy migration runner)
 * migrate.mjs gets the same treatment: the moment it imports something
 * that is not pg, an externalized build would break the same way.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(root, "..", "..");

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // No `external`: every dependency is bundled in, so the runtime image
  // needs no node_modules. (K2.45 — the old externalized build relied on
  // the image installing the same dep set, and it didn't.)
  //
  // The banner below is the standard esbuild answer to CJS modules that
  // call require() in a way bundling cannot statically resolve (avvio does
  // require("node:events")). esbuild rewrites those to its __require shim,
  // which throws in pure ESM unless a real `require` exists in scope — the
  // banner provides one via createRequire, so builtin requires keep working.
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);',
  },
  logLevel: "warning",
} as const;

await build({
  ...shared,
  entryPoints: [join(root, "src/index.ts")],
  outfile: join(root, "dist/index.mjs"),
});

// Migration runner: bundled from the repo-root scripts/ so the image can
// run migrations without tsx. Its imports (pg, db-guard) are bundled in too.
await build({
  ...shared,
  entryPoints: [join(repoRoot, "scripts/migrate.ts")],
  outfile: join(root, "dist/migrate.mjs"),
});
