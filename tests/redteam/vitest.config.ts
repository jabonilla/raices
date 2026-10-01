import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Standalone runner until the platform owner adds this directory to root CI.
export default defineConfig({
  resolve: {
    alias: {
      "@raices/money": fileURLToPath(new URL("../../packages/money/src/index.ts", import.meta.url)),
      pino: fileURLToPath(new URL("../../apps/api/node_modules/pino", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/redteam/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
