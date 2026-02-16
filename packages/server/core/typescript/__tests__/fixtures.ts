/* packages/server/core/typescript/__tests__/fixtures.ts */

import { createRouter, t } from "../src/index.js";

/** Canonical greet router used across adapter and handler tests */
export const greetRouter = createRouter({
  greet: {
    input: t.object({ name: t.string() }),
    output: t.object({ message: t.string() }),
    handler: ({ input }) => ({ message: `Hello, ${input.name}!` }),
  },
});

export const greetInput = { name: "Alice" };
export const greetExpected = { message: "Hello, Alice!" };

/** Raw schemas for low-level handler tests */
export const greetInputSchema = t.object({ name: t.string() });
export const greetOutputSchema = t.object({ message: t.string() });
