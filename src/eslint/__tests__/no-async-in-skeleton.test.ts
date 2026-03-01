/* src/eslint/__tests__/no-async-in-skeleton.test.ts */

import { RuleTester } from "eslint";
import { afterAll, describe, it } from "vitest";
import rule from "../src/rules/no-async-in-skeleton.js";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const SKELETON = "home-skeleton.tsx";

tester.run("no-async-in-skeleton", rule, {
  valid: [
    // synchronous component in skeleton file — allowed
    { code: "function HomeSkeleton() { return <div />; }", filename: SKELETON },
    // use() in non-skeleton file — not checked
    { code: "const data = use(promise);", filename: "home.tsx" },
  ],
  invalid: [
    // use() call
    {
      code: "const data = use(fetchData());",
      filename: SKELETON,
      errors: [{ messageId: "noUse" }],
    },
    // async function component
    {
      code: "async function HomeSkeleton() { return <div />; }",
      filename: SKELETON,
      errors: [{ messageId: "noAsyncComponent" }],
    },
    // async arrow function component
    {
      code: "const HomeSkeleton = async () => <div />;",
      filename: SKELETON,
      errors: [{ messageId: "noAsyncComponent" }],
    },
    // async function expression
    {
      code: "const HomeSkeleton = async function() { return <div />; }",
      filename: SKELETON,
      errors: [{ messageId: "noAsyncComponent" }],
    },
    // Suspense boundary
    {
      code: "<Suspense fallback={<p>Loading</p>}><Child /></Suspense>;",
      filename: SKELETON,
      errors: [{ messageId: "noSuspense" }],
    },
  ],
});
