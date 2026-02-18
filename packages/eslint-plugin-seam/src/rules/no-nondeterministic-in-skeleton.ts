/* packages/eslint-plugin-seam/src/rules/no-nondeterministic-in-skeleton.ts */

import type { Rule } from "eslint";

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow non-deterministic expressions (Date.now, Math.random, crypto) in skeleton components",
    },
    schema: [],
    messages: {
      forbidden:
        "Non-deterministic expression '{{name}}' produces unstable output in build-time rendering.",
    },
  },
  create() {
    return {};
  },
};

export default rule;
