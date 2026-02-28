/* packages/server/core/typescript/__tests__/router.test.ts */

import { describe, expect, it } from "vitest";
import { createRouter } from "../src/router/index.js";
import { t } from "../src/types/index.js";

describe("createRouter", () => {
  const router = createRouter({
    greet: {
      input: t.object({ name: t.string() }),
      output: t.object({ message: t.string() }),
      handler: ({ input }) => ({ message: `Hello, ${input.name}!` }),
    },
    add: {
      input: t.object({ a: t.int32(), b: t.int32() }),
      output: t.object({ sum: t.int32() }),
      handler: ({ input }) => ({ sum: input.a + input.b }),
    },
  });

  it("exposes procedures", () => {
    expect(router.procedures).toBeDefined();
    expect(router.procedures.greet).toBeDefined();
    expect(router.procedures.add).toBeDefined();
  });

  it("generates manifest with correct structure", () => {
    const manifest = router.manifest();
    expect(manifest.version).toBe(1);
    expect(Object.keys(manifest.procedures)).toEqual(["greet", "add"]);
  });

  it("manifest contains correct schemas", () => {
    const manifest = router.manifest();
    expect(manifest.procedures.greet.input).toEqual({
      properties: { name: { type: "string" } },
    });
    expect(manifest.procedures.greet.output).toEqual({
      properties: { message: { type: "string" } },
    });
  });

  it("handle delegates to handleRequest", async () => {
    const result = await router.handle("greet", { name: "World" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, data: { message: "Hello, World!" } });
  });
});
