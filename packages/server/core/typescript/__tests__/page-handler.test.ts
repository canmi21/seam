/* packages/server/core/typescript/__tests__/page-handler.test.ts */

import { describe, expect, it } from "vitest";
import { handlePageRequest } from "../src/page/handler.js";
import type { InternalProcedure } from "../src/procedure.js";
import type { PageDef } from "../src/page/index.js";

function makeProcedures(...entries: [string, InternalProcedure][]) {
  return new Map(entries);
}

function mockProcedure(handler: InternalProcedure["handler"]): InternalProcedure {
  return { inputSchema: {}, outputSchema: {}, handler };
}

function simplePage(template: string, loaders: PageDef["loaders"]): PageDef {
  return { template, loaders };
}

describe("handlePageRequest", () => {
  it("injects loader data", async () => {
    const procs = makeProcedures([
      "getUser",
      mockProcedure(() => ({ name: "Alice", email: "a@b.com" })),
    ]);
    const page = simplePage("<h1><!--seam:user.name--></h1>", {
      user: () => ({ procedure: "getUser", input: {} }),
    });

    const result = await handlePageRequest(page, {}, procs);
    expect(result.status).toBe(200);
    expect(result.html).toContain("Alice");
    expect(result.html).toContain("__SEAM_DATA__");
  });

  it("returns 500 when procedure not found", async () => {
    const procs = makeProcedures();
    const page = simplePage("<h1><!--seam:user.name--></h1>", {
      user: () => ({ procedure: "missing", input: {} }),
    });

    const result = await handlePageRequest(page, {}, procs);
    expect(result.status).toBe(500);
    expect(result.html).toContain("not found");
  });

  it("returns 500 when handler throws", async () => {
    const procs = makeProcedures([
      "getUser",
      mockProcedure(() => {
        throw new Error("db down");
      }),
    ]);
    const page = simplePage("<h1><!--seam:user.name--></h1>", {
      user: () => ({ procedure: "getUser", input: {} }),
    });

    const result = await handlePageRequest(page, {}, procs);
    expect(result.status).toBe(500);
    expect(result.html).toContain("db down");
  });

  it("runs multiple loaders in parallel", async () => {
    const procs = makeProcedures(
      ["getUser", mockProcedure(() => ({ name: "Alice" }))],
      ["getOrg", mockProcedure(() => ({ title: "Acme" }))],
    );
    const page = simplePage("<h1><!--seam:user.name--></h1><h2><!--seam:org.title--></h2>", {
      user: () => ({ procedure: "getUser", input: {} }),
      org: () => ({ procedure: "getOrg", input: {} }),
    });

    const result = await handlePageRequest(page, {}, procs);
    expect(result.status).toBe(200);
    expect(result.html).toContain("Alice");
    expect(result.html).toContain("Acme");
  });

  it("passes route params to loader", async () => {
    const procs = makeProcedures([
      "getUser",
      mockProcedure(({ input }) => {
        const { id } = input as { id: number };
        return { name: id === 42 ? "Found" : "Wrong" };
      }),
    ]);
    const page = simplePage("<h1><!--seam:user.name--></h1>", {
      user: (params) => ({ procedure: "getUser", input: { id: Number(params.id) } }),
    });

    const result = await handlePageRequest(page, { id: "42" }, procs);
    expect(result.status).toBe(200);
    expect(result.html).toContain("Found");
  });

  it("escapes error message in HTML", async () => {
    const procs = makeProcedures([
      "getUser",
      mockProcedure(() => {
        throw new Error("<script>alert(1)</script>");
      }),
    ]);
    const page = simplePage("<h1><!--seam:user.name--></h1>", {
      user: () => ({ procedure: "getUser", input: {} }),
    });

    const result = await handlePageRequest(page, {}, procs);
    expect(result.status).toBe(500);
    expect(result.html).not.toContain("<script>alert(1)</script>");
    expect(result.html).toContain("&lt;script&gt;");
  });
});
