// Local ESLint plugin: mobile accessibility baseline (K2.7).
// Many Raíces users are on older phones with large system fonts, so the
// accessibility baseline is enforced by lint, not left to review.
//
// Rule "mobile-a11y/require-accessibility-label":
//   Every interactive element (Pressable, TouchableOpacity, etc.) must have
//   an accessibilityLabel (or aria-label). A touch target without a label is
//   invisible to screen readers.

const TOUCHABLES = new Set([
  "Pressable",
  "TouchableOpacity",
  "TouchableHighlight",
  "TouchableWithoutFeedback",
]);

const LABEL_PROPS = new Set(["accessibilityLabel", "aria-label"]);

/** @type {import("eslint").ESLint.Plugin} */
const plugin = {
  rules: {
    "require-accessibility-label": {
      meta: {
        type: "problem",
        docs: {
          description: "Require an accessibility label on every interactive element",
        },
        schema: [],
      },
      create(context) {
        return {
          JSXOpeningElement(node) {
            const name = node.name;
            if (name.type !== "JSXIdentifier" || !TOUCHABLES.has(name.name)) {
              return;
            }
            const hasLabel = node.attributes.some(
              (attr) =>
                attr.type === "JSXAttribute" &&
                attr.name.type === "JSXIdentifier" &&
                LABEL_PROPS.has(attr.name.name),
            );
            if (!hasLabel) {
              context.report({
                node,
                message:
                  `<${name.name}> has no accessibilityLabel. Every interactive ` +
                  `element needs a label so screen readers can announce it ` +
                  `(K2.7 accessibility baseline).`,
              });
            }
          },
        };
      },
    },
  },
};

export default plugin;
