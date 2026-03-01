/* src/server/core/typescript/__tests__/page-handler.test.ts */

import { describe, expect, it } from "vitest";
import { handlePageRequest } from "../src/page/handler.js";
import { definePage } from "../src/page/index.js";
import type { LayoutDef } from "../src/page/index.js";
import {
  makeProcedures,
  mockProcedure,
  simplePage,
  extractSeamData,
} from "./page-handler-helpers.js";

// ---------------------------------------------------------------------------
// Page without layouts (existing tests, fixed for layoutChain)
// ---------------------------------------------------------------------------
// eslint-disable-next-line max-lines-per-function -- test suite grows with page handler features
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
    expect(result.html).toContain("__data");
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

  it("omits _layouts when no layouts present", async () => {
    const page = simplePage("<body><p>hi</p></body>", {
      page: () => ({ procedure: "getData", input: {} }),
    });
    const procs = makeProcedures(["getData", mockProcedure(() => ({ v: 1 }))]);
    const result = await handlePageRequest(page, {}, procs);

    const data = extractSeamData(result.html);
    expect(data._layouts).toBeUndefined();
  });

  it("works without explicit layoutChain (standalone definePage)", async () => {
    const page = definePage({
      template: "<h1><!--seam:user.name--></h1>",
      loaders: { user: () => ({ procedure: "getUser", input: {} }) },
    });
    const procs = makeProcedures(["getUser", mockProcedure(() => ({ name: "Alice" }))]);
    const result = await handlePageRequest(page, {}, procs);
    expect(result.status).toBe(200);
    expect(result.html).toContain("Alice");
  });
});

// ---------------------------------------------------------------------------
// Single layout
// ---------------------------------------------------------------------------
describe("handlePageRequest -- single layout", () => {
  const layout: LayoutDef = {
    id: "root",
    template:
      "<html><body><nav><!--seam:username--></nav><!--seam:outlet--><footer>f</footer></body></html>",
    loaders: {
      session: () => ({ procedure: "getSession", input: {} }),
    },
  };

  it("injects layout data and places page at outlet", async () => {
    const page: PageDef = {
      template: "<main><h1><!--seam:title--></h1></main>",
      loaders: { page: () => ({ procedure: "getHome", input: {} }) },
      layoutChain: [layout],
    };
    const procs = makeProcedures(
      ["getSession", mockProcedure(() => ({ username: "alice" }))],
      ["getHome", mockProcedure(() => ({ title: "Welcome" }))],
    );
    const result = await handlePageRequest(page, {}, procs);

    expect(result.status).toBe(200);
    expect(result.html).toContain("<nav>alice</nav>");
    expect(result.html).toContain("<main><h1>Welcome</h1></main>");
    expect(result.html).toContain("<footer>f</footer>");
  });

  it("stores layout data under _layouts in __data", async () => {
    const page: PageDef = {
      template: "<p>page</p>",
      loaders: { page: () => ({ procedure: "getHome", input: {} }) },
      layoutChain: [layout],
    };
    const procs = makeProcedures(
      ["getSession", mockProcedure(() => ({ username: "bob" }))],
      ["getHome", mockProcedure(() => ({ title: "Hi" }))],
    );
    const result = await handlePageRequest(page, {}, procs);
    const data = extractSeamData(result.html);

    expect(data.page).toEqual({ title: "Hi" });
    expect(data._layouts).toEqual({
      root: { session: { username: "bob" } },
    });
  });

  it("layout without outlet falls back to inject-only", async () => {
    const noOutletLayout: LayoutDef = {
      id: "simple",
      template: "<html><body><p><!--seam:msg--></p></body></html>",
      loaders: { data: () => ({ procedure: "getMsg", input: {} }) },
    };
    const page: PageDef = {
      template: "<span>ignored</span>",
      loaders: {},
      layoutChain: [noOutletLayout],
    };
    const procs = makeProcedures(["getMsg", mockProcedure(() => ({ msg: "hi" }))]);
    const result = await handlePageRequest(page, {}, procs);

    expect(result.html).toContain("<p>hi</p>");
  });

  it("layout with empty loaders still wraps page content", async () => {
    const shellLayout: LayoutDef = {
      id: "shell",
      template: '<html><body><div id="app"><!--seam:outlet--></div></body></html>',
      loaders: {},
    };
    const page: PageDef = {
      template: "<p><!--seam:greeting--></p>",
      loaders: { page: () => ({ procedure: "greet", input: {} }) },
      layoutChain: [shellLayout],
    };
    const procs = makeProcedures(["greet", mockProcedure(() => ({ greeting: "hi" }))]);
    const result = await handlePageRequest(page, {}, procs);

    expect(result.html).toContain('<div id="app"><p>hi</p></div>');
  });
});
