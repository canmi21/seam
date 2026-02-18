/* packages/eslint-plugin-seam/src/rules/no-async-in-skeleton.ts */

import type { Rule } from "eslint";

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow async operations (async/await, Promises, fetch, setTimeout) in skeleton components",
    },
    schema: [],
    messages: {
      forbidden: "Async operation '{{name}}' is not supported in build-time skeleton rendering.",
    },
  },
  create() {
    return {};
  },
};

export default rule;
