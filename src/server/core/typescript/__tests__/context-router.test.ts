/* src/server/core/typescript/__tests__/context-router.test.ts */

import { describe, expect, it } from "vitest";
import { createRouter } from "../src/router/index.js";
import { t } from "../src/types/index.js";

describe("router with context", () => {
  const router = createRouter(
    {
      getSecret: {
        input: t.object({ key: t.string() }),
        output: t.object({ value: t.string() }),
        context: ["auth"],
        handler: ({ input, ctx }) => ({
          value: `${input.key}:${ctx.auth}`,
        }),
      },
      publicOp: {
        input: t.object({ x: t.int32() }),
        output: t.object({ y: t.int32() }),
        handler: ({ input }) => ({ y: input.x + 1 }),
      },
    },
    {
      context: {
        auth: {
          extract: "header:authorization",
          schema: t.string(),
        },
      },
    },
  );

  it("contextExtractKeys returns header names", () => {
    expect(router.contextExtractKeys()).toEqual(["authorization"]);
  });

  it("passes resolved ctx to handler", async () => {
    const result = await router.handle(
      "getSecret",
      { key: "foo" },
      {
        authorization: "Bearer tok",
      },
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      data: { value: "foo:Bearer tok" },
    });
  });

  it("throws CONTEXT_ERROR when required header is missing", async () => {
    const result = await router.handle("getSecret", { key: "foo" }, {});
    expect(result.status).toBe(400);
    const body = result.body as { ok: false; error: { code: string } };
    expect(body.error.code).toBe("CONTEXT_ERROR");
  });

  it("skips context resolution for procedures without context", async () => {
    const result = await router.handle("publicOp", { x: 5 }, {});
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, data: { y: 6 } });
  });

  it("works without rawCtx for procedures without context", async () => {
    const result = await router.handle("publicOp", { x: 5 });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, data: { y: 6 } });
  });

  it("manifest includes context config", () => {
    const manifest = router.manifest();
    expect(manifest.context).toEqual({
      auth: {
        extract: "header:authorization",
        schema: { type: "string" },
      },
    });
  });

  it("manifest includes context field on procedures", () => {
    const manifest = router.manifest();
    expect(manifest.procedures.getSecret.context).toEqual(["auth"]);
    expect(manifest.procedures.publicOp.context).toBeUndefined();
  });
});

describe("router without context config", () => {
  const router = createRouter({
    greet: {
      input: t.object({ name: t.string() }),
      output: t.object({ message: t.string() }),
      handler: ({ input }) => ({ message: `Hi, ${input.name}!` }),
    },
  });

  it("contextExtractKeys returns empty", () => {
    expect(router.contextExtractKeys()).toEqual([]);
  });

  it("manifest context is empty object", () => {
    expect(router.manifest().context).toEqual({});
  });

  it("handle works without rawCtx", async () => {
    const result = await router.handle("greet", { name: "Alice" });
    expect(result.status).toBe(200);
  });
});

describe("context config validation at router creation", () => {
  it("throws when procedure references undefined context field", () => {
    expect(() =>
      createRouter(
        {
          op: {
            input: t.object({}),
            output: t.object({}),
            context: ["nonexistent"],
            handler: () => ({}),
          },
        },
        {
          context: {
            auth: { extract: "header:authorization", schema: t.string() },
          },
        },
      ),
    ).toThrow('references undefined context field "nonexistent"');
  });
});

describe("batch with context", () => {
  const router = createRouter(
    {
      getA: {
        input: t.object({}),
        output: t.object({ token: t.string() }),
        context: ["auth"],
        handler: ({ ctx }) => ({ token: ctx.auth as string }),
      },
      getB: {
        input: t.object({}),
        output: t.object({ n: t.int32() }),
        handler: () => ({ n: 42 }),
      },
    },
    {
      context: {
        auth: { extract: "header:authorization", schema: t.string() },
      },
    },
  );

  it("resolves context per-procedure in batch", async () => {
    const result = await router.handleBatch(
      [
        { procedure: "getA", input: {} },
        { procedure: "getB", input: {} },
      ],
      { authorization: "tok" },
    );
    expect(result.results[0]).toEqual({ ok: true, data: { token: "tok" } });
    expect(result.results[1]).toEqual({ ok: true, data: { n: 42 } });
  });
});
