/* packages/eslint-plugin-seam/__tests__/no-browser-apis-in-skeleton.test.ts */

import { RuleTester } from "eslint";
import { afterAll, describe, it } from "vitest";
import rule from "../src/rules/no-browser-apis-in-skeleton.js";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

const SKELETON = "home-skeleton.tsx";

tester.run("no-browser-apis-in-skeleton", rule, {
  valid: [
    // typeof window guard — allowed
    { code: 'const isSSR = typeof window !== "undefined";', filename: SKELETON },
    // browser API in non-skeleton file — not checked
    { code: "document.getElementById('root');", filename: "app.tsx" },
  ],
  invalid: [
    // window access
    {
      code: "const w = window.innerWidth;",
      filename: SKELETON,
      errors: [{ messageId: "forbidden", data: { name: "window" } }],
    },
    // document access
    {
      code: "document.getElementById('root');",
      filename: SKELETON,
      errors: [{ messageId: "forbidden", data: { name: "document" } }],
    },
    // localStorage access
    {
      code: "localStorage.getItem('key');",
      filename: SKELETON,
      errors: [{ messageId: "forbidden", data: { name: "localStorage" } }],
    },
    // sessionStorage access
    {
      code: "sessionStorage.setItem('k', 'v');",
      filename: SKELETON,
      errors: [{ messageId: "forbidden", data: { name: "sessionStorage" } }],
    },
    // navigator access
    {
      code: "const ua = navigator.userAgent;",
      filename: SKELETON,
      errors: [{ messageId: "forbidden", data: { name: "navigator" } }],
    },
    // location access
    {
      code: "const url = location.href;",
      filename: SKELETON,
      errors: [{ messageId: "forbidden", data: { name: "location" } }],
    },
  ],
});
