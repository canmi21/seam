/* packages/eslint-plugin-seam/src/rules/no-nondeterministic-in-skeleton.ts */

import type { Rule } from "eslint";

const SKELETON_PATTERN = /-skeleton\.tsx$/;

// obj.method patterns detected via MemberExpression + CallExpression
const MEMBER_CALLS = new Map<string, Map<string, string>>([
  ["Math", new Map([["random", "mathRandom"]])],
  ["Date", new Map([["now", "dateNow"]])],
  [
    "crypto",
    new Map([
      ["randomUUID", "cryptoRandom"],
      ["getRandomValues", "cryptoRandom"],
    ]),
  ],
]);

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow non-deterministic expressions (Math.random, Date.now, new Date, crypto) in skeleton components",
    },
    schema: [],
    messages: {
      mathRandom:
        "Math.random() produces different values on each render variant, making Rust diff results unreliable. Use a deterministic sentinel value in RouteDef.mock instead.",
      dateNow:
        "Date.now()/new Date() is non-deterministic at build time. Use a fixed mock date in RouteDef.mock instead.",
      cryptoRandom:
        "crypto random APIs are non-deterministic. Use a fixed mock value in RouteDef.mock instead.",
    },
  },
  create(context) {
    if (!SKELETON_PATTERN.test(context.filename)) return {};

    return {
      // Math.random(), Date.now(), crypto.randomUUID(), crypto.getRandomValues()
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.property.type === "Identifier"
        ) {
          const methods = MEMBER_CALLS.get(callee.object.name);
          const messageId = methods?.get(callee.property.name);
          if (messageId) {
            context.report({ node, messageId });
          }
        }
      },

      // new Date()
      NewExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "Date") {
          context.report({ node, messageId: "dateNow" });
        }
      },
    };
  },
};

export default rule;
