/* packages/eslint-plugin-seam/__tests__/no-async-in-skeleton.test.ts */

import { RuleTester } from "eslint";
import { afterAll, describe, it } from "vitest";
import rule from "../src/rules/no-async-in-skeleton.js";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { ecmaVersion: "latest", sourceType: "module" } });

tester.run("no-async-in-skeleton", rule, {
  valid: [{ code: "const x = 1;" }, { code: "function Skeleton() { return null; }" }],
  invalid: [],
});
