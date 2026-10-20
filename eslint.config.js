import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

import mobileA11y from "./eslint-plugins/mobile-a11y.js";

/**
 * Money paths never coerce through floats (CLAUDE.md rule 1). Shared so a
 * config block that needs its own `no-restricted-syntax` entry can spread
 * these in rather than silently replacing them: in flat config, the last
 * matching block wins per rule, not per selector.
 */
/**
 * Mobile accessibility baseline (K2.7): never disable OS font scaling on
 * Text — many users are on older phones with large system fonts. Shared so
 * every config block that defines its own `no-restricted-syntax` for mobile
 * files spreads it in rather than silently replacing it: in flat config the
 * last matching block wins per rule, not per selector, so without the
 * spread the i18n block below would delete this ban wherever it applies.
 * (CI-3)
 */
const ALLOW_FONT_SCALING_BAN = {
  selector: "JSXAttribute[name.name='allowFontScaling']",
  message:
    "Do not set allowFontScaling. Text must scale with the OS font-size " +
    "setting (K2.7 accessibility baseline).",
};

const FLOAT_BAN_SELECTORS = [
  {
    selector: "CallExpression[callee.name='Number']",
    message:
      "Number() coerces to a float and loses precision past 2^53. Money is bigint minor units.",
  },
  {
    selector: "NewExpression[callee.name='Number']",
    message: "Number() coerces to a float. Money is bigint minor units.",
  },
  {
    selector: "CallExpression[callee.name='parseFloat']",
    message: "parseFloat produces a float. Parse money with fromMajorString instead.",
  },
  {
    selector: "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']",
    message: "Number.parseFloat produces a float. Parse money with fromMajorString instead.",
  },
];

export default tseslint.config(
  {
    // dist-web is Expo web build output (apps/mobile). It was previously
    // excluded only via .gitignore; an explicit --ignore-pattern run linted
    // it and produced thousands of phantom errors. Name it here so lint's
    // view of the tree does not depend on .gitignore (docs/lint-memory.md).
    ignores: ["**/node_modules/**", "**/dist/**", "**/dist-web/**", "**/coverage/**"],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Money paths never coerce through floats. Number(...) and parseFloat are
    // how a bigint minor unit quietly becomes a rounded double, so they are
    // banned outright here rather than left to review (CLAUDE.md rule 1).
    files: [
      "packages/money/**/*.ts",
      "apps/api/src/ledger/**/*.ts",
      "apps/api/src/reconciliation/**/*.ts",
      "apps/api/src/plans/**/*.ts",
      // P2.4: a request carries an amount and is compared against a cap.
      "apps/api/src/requests/**/*.ts",
      // P2.5: a transaction carries an amount, a fee and an FX rate.
      "apps/api/src/transactions/**/*.ts",
    ],
    rules: {
      "no-restricted-syntax": ["error", ...FLOAT_BAN_SELECTORS],
    },
  },
  {
    // P2.4: the tier classifier is pure. Its inputs are values a caller has
    // already read, so it never reaches a database itself — that is what
    // makes every tier exhaustively table-testable without one.
    //
    // Enforced rather than documented: a future change that reaches for a
    // query builder fails to lint instead of quietly turning the classifier
    // into something that needs a container to test. Type-only imports count,
    // because importing the schema is the coupling this prevents.
    files: ["apps/api/src/requests/tier/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "kysely",
              message:
                "The tier classifier is pure: it takes the plan version, the spend to date and " +
                "any recurring rule as values. Read them in the caller (P2.4).",
            },
            { name: "pg", message: "The tier classifier takes values, never a connection (P2.4)." },
            {
              name: "pg-boss",
              message: "The tier classifier takes values, never a job queue (P2.4).",
            },
            {
              name: "postgres",
              message: "The tier classifier takes values, never a connection (P2.4).",
            },
          ],
          patterns: [
            {
              group: [
                "**/db",
                "**/db/*",
                "**/db/**",
                "**/schema.js",
                "**/schema",
                "**/serializable.js",
              ],
              message:
                "The tier classifier does not import the database schema or its helpers. Its " +
                "input types live beside it in apps/api/src/requests/tier/ (P2.4).",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...FLOAT_BAN_SELECTORS,
        {
          selector: "ImportExpression",
          message:
            "A dynamic import would route around the tier module's import ban. The classifier " +
            "is pure and loads nothing at runtime (P2.4).",
        },
        {
          selector: "CallExpression[callee.name='require']",
          message:
            "require() would route around the tier module's import ban. The classifier is pure " +
            "and loads nothing at runtime (P2.4).",
        },
      ],
    },
  },
  {
    // P3.3: the inbound parser is pure, same rule and same reason as the
    // tier classifier above. Its input is a string; its output is a reading
    // or a question. Nothing here opens a connection, which is what lets
    // every Spanish phrasing be table-tested without a container.
    //
    // This matters more than ordinary tidiness: the parser decides what a
    // person asked for, and the approval gate downstream asks somebody to
    // approve that reading. A parser that could reach a database could also
    // start deciding based on history rather than on what was typed.
    files: ["apps/api/src/messaging/parse/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "kysely",
              message:
                "The inbound parser is pure: it takes the message text and returns a reading " +
                "or a question. Do the lookups in the caller (P3.3).",
            },
            { name: "pg", message: "The inbound parser takes text, never a connection (P3.3)." },
            {
              name: "pg-boss",
              message: "The inbound parser takes text, never a job queue (P3.3).",
            },
            {
              name: "postgres",
              message: "The inbound parser takes text, never a connection (P3.3).",
            },
          ],
          patterns: [
            {
              group: [
                "**/db",
                "**/db/*",
                "**/db/**",
                "**/schema.js",
                "**/schema",
                "**/serializable.js",
                "**/conversation/**",
                "**/requests/**",
              ],
              message:
                "The inbound parser does not import the database schema, its helpers, or the " +
                "modules that write. Its types live beside it in apps/api/src/messaging/parse/ (P3.3).",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...FLOAT_BAN_SELECTORS,
        {
          selector: "ImportExpression",
          message:
            "A dynamic import would route around the parser's import ban. The parser is pure " +
            "and loads nothing at runtime (P3.3).",
        },
        {
          selector: "CallExpression[callee.name='require']",
          message:
            "require() would route around the parser's import ban. The parser is pure and " +
            "loads nothing at runtime (P3.3).",
        },
      ],
    },
  },
  {
    // Mobile accessibility baseline (K2.7). Many users are on older phones
    // with large system fonts, so these are lint errors, not suggestions:
    //  - every Pressable/Touchable* needs an accessibility label
    //  - never disable OS font scaling on Text
    files: ["apps/mobile/**/*.tsx", "apps/mobile/**/*.jsx"],
    plugins: { "mobile-a11y": mobileA11y },
    rules: {
      "mobile-a11y/require-accessibility-label": "error",
      "no-restricted-syntax": ["error", ALLOW_FONT_SCALING_BAN],
    },
  },
  {
    // Config files are plain JS and are not part of the typechecked program.
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // babel.config.js is CommonJS; give it the node globals it uses.
    files: ["apps/mobile/babel.config.js"],
    languageOptions: {
      globals: {
        module: "writable",
        require: "readonly",
        __dirname: "readonly",
      },
    },
  },
  {
    // Every user-facing string in the mobile app goes through i18n keys.
    // Hardcoded JSX text is banned; use t("key") instead. (K2.4)
    files: ["apps/mobile/app/**/*.tsx", "apps/mobile/src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // JSXText with non-whitespace content, e.g. <Text>Hello</Text>.
          // Whitespace-only JSXText (formatting) is allowed.
          selector: "JSXText[value=/\\S/]",
          message: 'Hardcoded user-facing string. Use t("key") from react-i18next instead.',
        },
        // CI-3: keep the allowFontScaling ban alive here. This block's
        // no-restricted-syntax replaces the a11y block's for every file it
        // matches; without this spread the ban would be dead in
        // apps/mobile/app/** and apps/mobile/src/**.
        ALLOW_FONT_SCALING_BAN,
      ],
    },
  },
  prettier,
);
