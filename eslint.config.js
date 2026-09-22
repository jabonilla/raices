import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**"],
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
    files: ["packages/money/**/*.ts", "apps/api/src/ledger/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
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
          selector:
            "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']",
          message: "Number.parseFloat produces a float. Parse money with fromMajorString instead.",
        },
      ],
    },
  },
  {
    // Config files are plain JS and are not part of the typechecked program.
    files: ["**/*.js"],
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
      ],
    },
  },
  prettier,
);
