/* src/server/core/typescript/__tests__/router.test.ts */

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

  it("existing definitions default to query type", () => {
    const manifest = router.manifest();
    expect(manifest.procedures.greet.type).toBe("query");
    expect(manifest.procedures.add.type).toBe("query");
  });
});

describe("command definitions", () => {
  const router = createRouter({
    createUser: {
      type: "command",
      input: t.object({ name: t.string() }),
      output: t.object({ id: t.string() }),
      handler: ({ input }) => ({ id: `user-${input.name}` }),
    },
    getUser: {
      input: t.object({ id: t.string() }),
      output: t.object({ name: t.string() }),
      handler: ({ input }) => ({ name: `user-${input.id}` }),
    },
  });

  it("command definition produces manifest type 'command'", () => {
    const manifest = router.manifest();
    expect(manifest.procedures.createUser.type).toBe("command");
  });

  it("query definition still produces type 'query'", () => {
    const manifest = router.manifest();
    expect(manifest.procedures.getUser.type).toBe("query");
  });

  it("command handler executes correctly", async () => {
    const result = await router.handle("createUser", { name: "Alice" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, data: { id: "user-Alice" } });
  });
});

describe("error schema in manifest", () => {
  const router = createRouter({
    riskyOp: {
      type: "command",
      input: t.object({ data: t.string() }),
      output: t.object({ ok: t.boolean() }),
      error: t.object({ code: t.string(), detail: t.string() }),
      handler: ({ input }) => ({ ok: !!input.data }),
    },
    safeOp: {
      input: t.object({ x: t.int32() }),
      output: t.object({ y: t.int32() }),
      handler: ({ input }) => ({ y: input.x + 1 }),
    },
  });

  it("error schema appears in manifest when provided", () => {
    const manifest = router.manifest();
    expect(manifest.procedures.riskyOp.error).toEqual({
      properties: {
        code: { type: "string" },
        detail: { type: "string" },
      },
    });
  });

  it("error schema is absent when not provided", () => {
    const manifest = router.manifest();
    expect(manifest.procedures.safeOp.error).toBeUndefined();
  });
});
