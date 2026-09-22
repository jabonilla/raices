import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const moneySrc = fileURLToPath(new URL("./packages/money/src/index.ts", import.meta.url));

export default defineConfig({
  test: {
    // packages/money is scaffolded empty here; P1.1 fills it in.
    passWithNoTests: true,
    projects: [
      {
        resolve: { alias: { "@raices/money": moneySrc } },
        test: {
          name: "api",
          root: "./apps/api",
          environment: "node",
          include: ["test/**/*.test.ts"],
          // Starting a Postgres 16 container (and pulling it the first time)
          // is well over Vitest's 5s default.
          testTimeout: 180_000,
          hookTimeout: 180_000,
        },
      },
      {
        resolve: { alias: { "@raices/money": moneySrc } },
        test: {
          name: "money",
          root: "./packages/money",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
    ],
  },
});
