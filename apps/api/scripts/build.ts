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
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};

// External: every third-party dependency. Workspace packages (@raices/*)
// are bundled from source.
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith("@raices/"));

await build({
  entryPoints: [join(root, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external,
  outfile: join(root, "dist/index.mjs"),
  logLevel: "warning",
});
