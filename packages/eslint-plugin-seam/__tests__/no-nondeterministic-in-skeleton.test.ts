/* packages/eslint-plugin-seam/__tests__/no-nondeterministic-in-skeleton.test.ts */

import { RuleTester } from "eslint";
import { afterAll, describe, it } from "vitest";
import rule from "../src/rules/no-nondeterministic-in-skeleton.js";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { ecmaVersion: "latest", sourceType: "module" } });

tester.run("no-nondeterministic-in-skeleton", rule, {
  valid: [{ code: "const x = 1;" }, { code: "function Skeleton() { return null; }" }],
  invalid: [],
});
