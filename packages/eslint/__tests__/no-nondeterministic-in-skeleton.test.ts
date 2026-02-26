/* packages/eslint/__tests__/no-nondeterministic-in-skeleton.test.ts */

import { RuleTester } from "eslint";
import { afterAll, describe, it } from "vitest";
import rule from "../src/rules/no-nondeterministic-in-skeleton.js";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

const SKELETON = "home-skeleton.tsx";

tester.run("no-nondeterministic-in-skeleton", rule, {
  valid: [
    // deterministic math in skeleton — allowed
    { code: "const x = Math.floor(1.5);", filename: SKELETON },
    // Math.random in non-skeleton file — not checked
    { code: "const r = Math.random();", filename: "home.tsx" },
  ],
  invalid: [
    // Math.random()
    {
      code: "const r = Math.random();",
      filename: SKELETON,
      errors: [{ messageId: "mathRandom" }],
    },
    // Date.now()
    {
      code: "const t = Date.now();",
      filename: SKELETON,
      errors: [{ messageId: "dateNow" }],
    },
    // new Date()
    {
      code: "const d = new Date();",
      filename: SKELETON,
      errors: [{ messageId: "dateNow" }],
    },
    // crypto.randomUUID()
    {
      code: "const id = crypto.randomUUID();",
      filename: SKELETON,
      errors: [{ messageId: "cryptoRandom" }],
    },
    // crypto.getRandomValues()
    {
      code: "const buf = crypto.getRandomValues(new Uint8Array(16));",
      filename: SKELETON,
      errors: [{ messageId: "cryptoRandom" }],
    },
  ],
});
