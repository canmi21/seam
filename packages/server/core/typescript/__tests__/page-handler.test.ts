/* packages/server/core/typescript/__tests__/page-handler.test.ts */

import { describe, expect, it } from "vitest";
import { handlePageRequest } from "../src/page/handler.js";
import type { InternalProcedure } from "../src/procedure.js";
import { definePage } from "../src/page/index.js";
import type { PageDef, LayoutDef } from "../src/page/index.js";

function makeProcedures(...entries: [string, InternalProcedure][]) {
  return new Map(entries);
}

function mockProcedure(handler: InternalProcedure["handler"]): InternalProcedure {
  return { inputSchema: {}, outputSchema: {}, handler };
}

function simplePage(template: string, loaders: PageDef["loaders"]): PageDef {
  return { template, loaders, layoutChain: [] };
}

/** Extract __SEAM_DATA__ JSON from rendered HTML */
function extractSeamData(html: string): Record<string, unknown> {
  const match = html.match(/<script id="__SEAM_DATA__" type="application\/json">(.*?)<\/script>/);
  if (!match) throw new Error("__SEAM_DATA__ script not found");
  return JSON.parse(match[1]);
}

// ---------------------------------------------------------------------------
// Page without layouts (existing tests, fixed for layoutChain)
// ---------------------------------------------------------------------------
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
describe("handlePageRequest — single layout", () => {
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

  it("stores layout data under _layouts in __SEAM_DATA__", async () => {
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

// ---------------------------------------------------------------------------
// Nested layouts (outer -> inner -> page)
// ---------------------------------------------------------------------------
describe("handlePageRequest — nested layouts", () => {
  const outerLayout: LayoutDef = {
    id: "root",
    template: "<html><body><header><!--seam:app--></header><!--seam:outlet--></body></html>",
    loaders: { meta: () => ({ procedure: "getApp", input: {} }) },
  };
  const innerLayout: LayoutDef = {
    id: "dashboard",
    template: '<div class="dash"><aside><!--seam:nav--></aside><!--seam:outlet--></div>',
    loaders: { sidebar: () => ({ procedure: "getNav", input: {} }) },
  };

  it("composes outer -> inner -> page in correct nesting order", async () => {
    const page: PageDef = {
      template: "<section><!--seam:content--></section>",
      loaders: { page: () => ({ procedure: "getContent", input: {} }) },
      layoutChain: [outerLayout, innerLayout],
    };
    const procs = makeProcedures(
      ["getApp", mockProcedure(() => ({ app: "SeamJS" }))],
      ["getNav", mockProcedure(() => ({ nav: "sidebar" }))],
      ["getContent", mockProcedure(() => ({ content: "main" }))],
    );
    const result = await handlePageRequest(page, {}, procs);

    expect(result.status).toBe(200);
    expect(result.html).toContain("<header>SeamJS</header>");
    expect(result.html).toContain("<aside>sidebar</aside>");
    expect(result.html).toContain("<section>main</section>");

    // Nesting order: outer wraps inner wraps page
    const headerIdx = result.html.indexOf("<header>");
    const asideIdx = result.html.indexOf("<aside>");
    const sectionIdx = result.html.indexOf("<section>");
    expect(headerIdx).toBeLessThan(asideIdx);
    expect(asideIdx).toBeLessThan(sectionIdx);
  });

  it("stores all layout data keyed by id in _layouts", async () => {
    const page: PageDef = {
      template: "<p>page</p>",
      loaders: { page: () => ({ procedure: "getContent", input: {} }) },
      layoutChain: [outerLayout, innerLayout],
    };
    const procs = makeProcedures(
      ["getApp", mockProcedure(() => ({ app: "SeamJS" }))],
      ["getNav", mockProcedure(() => ({ nav: "links" }))],
      ["getContent", mockProcedure(() => ({ content: "text" }))],
    );
    const result = await handlePageRequest(page, {}, procs);
    const data = extractSeamData(result.html);

    expect(data._layouts).toEqual({
      root: { meta: { app: "SeamJS" } },
      dashboard: { sidebar: { nav: "links" } },
    });
    expect(data.page).toEqual({ content: "text" });
  });
});

// ---------------------------------------------------------------------------
// Route params forwarded to layout and page loaders
// ---------------------------------------------------------------------------
describe("handlePageRequest — route params with layouts", () => {
  it("forwards params to both layout and page loaders", async () => {
    const inputs: Record<string, unknown>[] = [];
    const captureProcedure = mockProcedure(({ input }) => {
      inputs.push(input as Record<string, unknown>);
      return {};
    });
    const procedures = new Map<string, InternalProcedure>([
      ["getUser", captureProcedure],
      ["getUserPosts", captureProcedure],
    ]);

    const layout: LayoutDef = {
      id: "user",
      template: "<div><!--seam:outlet--></div>",
      loaders: {
        user: (params) => ({ procedure: "getUser", input: { username: params.username } }),
      },
    };
    const page: PageDef = {
      template: "<p>posts</p>",
      loaders: {
        posts: (params) => ({ procedure: "getUserPosts", input: { username: params.username } }),
      },
      layoutChain: [layout],
    };

    await handlePageRequest(page, { username: "alice" }, procedures);

    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toEqual({ username: "alice" });
    expect(inputs[1]).toEqual({ username: "alice" });
  });
});

// ---------------------------------------------------------------------------
// flattenForSlots — verified via slot resolution
// ---------------------------------------------------------------------------
describe("handlePageRequest — flattenForSlots", () => {
  it("flattens nested loader results so slots resolve", async () => {
    const page = simplePage("<p><!--seam:name--> is <!--seam:age--></p>", {
      user: () => ({ procedure: "getUser", input: {} }),
    });
    const procs = makeProcedures(["getUser", mockProcedure(() => ({ name: "Alice", age: 30 }))]);
    const result = await handlePageRequest(page, {}, procs);

    expect(result.html).toContain("<p>Alice is 30</p>");
  });

  it("flattens layout loader results for layout template slots", async () => {
    const layout: LayoutDef = {
      id: "root",
      template: "<nav><!--seam:username--></nav><!--seam:outlet-->",
      loaders: { session: () => ({ procedure: "getSession", input: {} }) },
    };
    const page: PageDef = {
      template: "<p>page</p>",
      loaders: {},
      layoutChain: [layout],
    };
    const procs = makeProcedures(["getSession", mockProcedure(() => ({ username: "bob" }))]);
    const result = await handlePageRequest(page, {}, procs);

    expect(result.html).toContain("<nav>bob</nav>");
  });
});

// ---------------------------------------------------------------------------
// __SEAM_DATA__ placement
// ---------------------------------------------------------------------------
describe("handlePageRequest — data script placement", () => {
  it("injects __SEAM_DATA__ before </body> in layout", async () => {
    const layout: LayoutDef = {
      id: "root",
      template: "<html><body><!--seam:outlet--></body></html>",
      loaders: {},
    };
    const page: PageDef = {
      template: "<p>hi</p>",
      loaders: { page: () => ({ procedure: "getData", input: {} }) },
      layoutChain: [layout],
    };
    const procs = makeProcedures(["getData", mockProcedure(() => ({ v: 1 }))]);
    const result = await handlePageRequest(page, {}, procs);

    // Script should appear before </body>
    const scriptIdx = result.html.indexOf("__SEAM_DATA__");
    const bodyCloseIdx = result.html.indexOf("</body>");
    expect(scriptIdx).toBeGreaterThan(-1);
    expect(scriptIdx).toBeLessThan(bodyCloseIdx);
  });

  it("appends __SEAM_DATA__ when no </body> exists", async () => {
    const page = simplePage("<p>no body tag</p>", {
      page: () => ({ procedure: "getData", input: {} }),
    });
    const procs = makeProcedures(["getData", mockProcedure(() => ({ v: 1 }))]);
    const result = await handlePageRequest(page, {}, procs);

    expect(result.html).toContain("__SEAM_DATA__");
    // Script should be at the end
    expect(result.html).toMatch(/<\/script>$/);
  });
});
