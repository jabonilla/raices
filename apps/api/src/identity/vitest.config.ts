import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: {
      "@raices/money": fileURLToPath(
        new URL("../../../../packages/money/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["apps/api/src/identity/**/*.test.ts", "apps/api/src/http/**/*.test.ts"],
    testTimeout: 180000,
    hookTimeout: 180000,
  },
});
