/* packages/eslint-plugin-seam/src/rules/no-async-in-skeleton.ts */

import type { Rule } from "eslint";

const SKELETON_PATTERN = /-skeleton\.tsx$/;

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow async operations (use(), async components, Suspense) in skeleton components",
    },
    schema: [],
    messages: {
      noUse: "use() is not allowed in skeleton components. Move async data to a loader.",
      noAsyncComponent:
        "Async components are not allowed in skeleton files. Skeleton components must render synchronously.",
      noSuspense:
        "Suspense boundaries in skeleton components may produce abort markers (<!--$!-->) that corrupt CTR templates.",
    },
  },
  create(context) {
    if (!SKELETON_PATTERN.test(context.filename)) return {};

    return {
      // use(somePromise)
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "use") {
          context.report({ node, messageId: "noUse" });
        }
      },

      // async function HomeSkeleton() { ... }
      FunctionDeclaration(node) {
        if (node.async) {
          context.report({ node, messageId: "noAsyncComponent" });
        }
      },

      // const HomeSkeleton = async () => { ... }
      ArrowFunctionExpression(node) {
        if (node.async) {
          context.report({ node, messageId: "noAsyncComponent" });
        }
      },

      // const HomeSkeleton = async function() { ... }
      FunctionExpression(node) {
        if (node.async) {
          context.report({ node, messageId: "noAsyncComponent" });
        }
      },

      // <Suspense fallback={...}>...</Suspense>
      JSXOpeningElement(node: Rule.Node) {
        const jsx = node as unknown as { name: { type: string; name: string } };
        if (jsx.name.type === "JSXIdentifier" && jsx.name.name === "Suspense") {
          context.report({ node, messageId: "noSuspense" });
        }
      },
    };
  },
};

export default rule;
