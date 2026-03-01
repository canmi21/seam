/* src/eslint/src/rules/no-effect-in-skeleton.ts */

import type { Rule } from "eslint";

const SKELETON_PATTERN = /-skeleton\.tsx$/;

const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect"]);

const rule: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Warn against useEffect/useLayoutEffect in skeleton components (dead code in renderToString)",
    },
    schema: [],
    messages: {
      noEffect:
        "{{ name }}() has no effect during build-time rendering (renderToString skips all effects).\n" +
        "  This is dead code in a skeleton component.\n" +
        "  If you need client-side behavior, it belongs in a non-skeleton component.",
    },
  },
  create(context) {
    if (!SKELETON_PATTERN.test(context.filename)) return {};

    return {
      CallExpression(node) {
        if (node.callee.type === "Identifier" && EFFECT_HOOKS.has(node.callee.name)) {
          context.report({
            node,
            messageId: "noEffect",
            data: { name: node.callee.name },
          });
        }
      },
    };
  },
};

export default rule;
