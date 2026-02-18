/* packages/eslint-plugin-seam/src/rules/no-browser-apis-in-skeleton.ts */

import type { Rule } from "eslint";

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow browser-only APIs (window, document, localStorage, etc.) in skeleton components",
    },
    schema: [],
    messages: {
      forbidden: "Browser API '{{name}}' is not available during build-time rendering.",
    },
  },
  create() {
    return {};
  },
};

export default rule;
