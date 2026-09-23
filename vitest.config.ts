import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const moneySrc = fileURLToPath(new URL("./packages/money/src/index.ts", import.meta.url));

export default defineConfig({
  test: {
    // packages/money is scaffolded empty here; P1.1 fills it in.
    passWithNoTests: true,
    server: {
      deps: {
        // Vitest externalizes node_modules for SSR by default. Inline these
        // so RNTL and its renderer load in the test worker instead of being
        // imported natively from outside the Vite pipeline.
        inline: [
          "react-native",
          "expo-status-bar",
          "@testing-library/react-native",
          "test-renderer",
        ],
      },
    },
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
        // The real `react-native` entrypoint ships Flow type syntax that
        // Node/Vite cannot parse. Alias it to `react-native-web`, a real
        // implementation that renders to DOM, so the test exercises actual
        // rendering instead of a stub. `expo-status-bar` is native-only with
        // no visual output; it stays a minimal mock (StatusBar renders null).
        //
        // The app uses the automatic JSX runtime (Expo default); tell
        // esbuild so the test transform matches and React need not be in
        // scope in .tsx files.
        esbuild: { jsx: "automatic" },
        resolve: {
          alias: {
            "@raices/money": moneySrc,
            "react-native": "react-native-web",
            "expo-status-bar": fileURLToPath(
              new URL("./apps/mobile/test/mocks/expo-status-bar.ts", import.meta.url),
            ),
          },
        },
        test: {
          name: "mobile",
          root: "./apps/mobile",
          environment: "jsdom",
          include: ["test/**/*.test.{ts,tsx}"],
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
      {
        // Guardrail regression tests: verify that the ESLint float ban and
        // the TypeScript multiply-without-rounding error still fire. If a
        // dependency upgrade silently disarms them, these tests fail. (K2.8)
        test: {
          name: "guardrails",
          root: "./tests/guardrails",
          environment: "node",
          include: ["**/*.test.ts"],
          // Loading the repo's real eslint.config.js with type-aware
          // linting is far slower than an inline config. Each test spins up
          // a fresh ESLint instance, so give them room. (K2.8 fix)
          testTimeout: 60_000,
        },
      },
    ],
  },
});
