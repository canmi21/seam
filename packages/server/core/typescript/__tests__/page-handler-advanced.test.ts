/* packages/server/core/typescript/__tests__/page-handler-advanced.test.ts */

import { describe, expect, it } from "vitest";
import { handlePageRequest } from "../src/page/handler.js";
import type { InternalProcedure } from "../src/procedure.js";
import type { PageDef, LayoutDef } from "../src/page/index.js";
import {
  makeProcedures,
  mockProcedure,
  simplePage,
  extractSeamData,
} from "./page-handler-helpers.js";

// ---------------------------------------------------------------------------
// Nested layouts (outer -> inner -> page)
// ---------------------------------------------------------------------------
describe("handlePageRequest -- nested layouts", () => {
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
describe("handlePageRequest -- route params with layouts", () => {
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
// flattenForSlots -- verified via slot resolution
// ---------------------------------------------------------------------------
describe("handlePageRequest -- flattenForSlots", () => {
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
// headMeta injection into <head>
// ---------------------------------------------------------------------------
describe("handlePageRequest -- headMeta", () => {
  const layoutWithHead: LayoutDef = {
    id: "root",
    template:
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><!--seam:outlet--></body></html>',
    loaders: {},
  };

  it("injects headMeta into <head> after charset", async () => {
    const page: PageDef = {
      template: "<main><h1><!--seam:page.title--></h1></main>",
      loaders: { page: () => ({ procedure: "getData", input: {} }) },
      layoutChain: [layoutWithHead],
      headMeta: "<title><!--seam:page.title--></title>",
    };
    const procs = makeProcedures(["getData", mockProcedure(() => ({ title: "Hello" }))]);
    const result = await handlePageRequest(page, {}, procs);

    expect(result.status).toBe(200);
    // Title should be in <head>, injected with resolved data
    const head = result.html.split("</head>")[0];
    expect(head).toContain("<title>Hello</title>");
    // Title should NOT be in body
    const body = result.html.split("</head>")[1];
    expect(body).not.toContain("<title>");
  });

  it("does not modify output when headMeta is undefined", async () => {
    const page: PageDef = {
      template: "<main><h1><!--seam:page.title--></h1></main>",
      loaders: { page: () => ({ procedure: "getData", input: {} }) },
      layoutChain: [layoutWithHead],
    };
    const procs = makeProcedures(["getData", mockProcedure(() => ({ title: "Hello" }))]);
    const result = await handlePageRequest(page, {}, procs);

    expect(result.status).toBe(200);
    const head = result.html.split("</head>")[0];
    expect(head).not.toContain("<title>");
    expect(result.html).toContain("<h1>Hello</h1>");
  });

  it("injects headMeta with conditional directives", async () => {
    const page: PageDef = {
      template: "<p>body</p>",
      loaders: { page: () => ({ procedure: "getData", input: {} }) },
      layoutChain: [layoutWithHead],
      headMeta:
        '<!--seam:if:page.ogTitle--><!--seam:page.ogTitle:attr:content--><meta name="og:title"><!--seam:endif:page.ogTitle-->',
    };
    const procs = makeProcedures(["getData", mockProcedure(() => ({ ogTitle: "Share Me" }))]);
    const result = await handlePageRequest(page, {}, procs);

    const head = result.html.split("</head>")[0];
    expect(head).toContain('content="Share Me"');
    expect(head).toContain('name="og:title"');
  });

  it("page title comes before layout content (first-title-wins)", async () => {
    const layoutWithTitle: LayoutDef = {
      id: "root",
      template:
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Default</title></head><body><!--seam:outlet--></body></html>',
      loaders: {},
    };
    const page: PageDef = {
      template: "<p>body</p>",
      loaders: { page: () => ({ procedure: "getData", input: {} }) },
      layoutChain: [layoutWithTitle],
      headMeta: "<title><!--seam:page.title--></title>",
    };
    const procs = makeProcedures(["getData", mockProcedure(() => ({ title: "Page Title" }))]);
    const result = await handlePageRequest(page, {}, procs);

    const head = result.html.split("</head>")[0];
    // Page title should appear before layout default title
    const pageTitleIdx = head.indexOf("<title>Page Title</title>");
    const defaultTitleIdx = head.indexOf("<title>Default</title>");
    expect(pageTitleIdx).toBeGreaterThan(-1);
    expect(defaultTitleIdx).toBeGreaterThan(-1);
    expect(pageTitleIdx).toBeLessThan(defaultTitleIdx);
  });
});

// ---------------------------------------------------------------------------
// __data placement
// ---------------------------------------------------------------------------
describe("handlePageRequest -- data script placement", () => {
  it("injects __data before </body> in layout", async () => {
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
    const scriptIdx = result.html.indexOf("__data");
    const bodyCloseIdx = result.html.indexOf("</body>");
    expect(scriptIdx).toBeGreaterThan(-1);
    expect(scriptIdx).toBeLessThan(bodyCloseIdx);
  });

  it("appends __data when no </body> exists", async () => {
    const page = simplePage("<p>no body tag</p>", {
      page: () => ({ procedure: "getData", input: {} }),
    });
    const procs = makeProcedures(["getData", mockProcedure(() => ({ v: 1 }))]);
    const result = await handlePageRequest(page, {}, procs);

    expect(result.html).toContain("__data");
    // Script should be at the end
    expect(result.html).toMatch(/<\/script>$/);
  });
});

// ---------------------------------------------------------------------------
// Custom dataId
// ---------------------------------------------------------------------------
describe("handlePageRequest -- custom dataId", () => {
  it("uses custom dataId for script tag", async () => {
    const page: PageDef = {
      template: "<body><p>hi</p></body>",
      loaders: { page: () => ({ procedure: "getData", input: {} }) },
      layoutChain: [],
      dataId: "__sd",
    };
    const procs = makeProcedures(["getData", mockProcedure(() => ({ v: 1 }))]);
    const result = await handlePageRequest(page, {}, procs);

    expect(result.html).toContain('id="__sd"');
    expect(result.html).not.toContain('id="__data"');
    const data = extractSeamData(result.html, "__sd");
    expect(data.page).toEqual({ v: 1 });
  });

  it("defaults to __data when dataId is undefined", async () => {
    const page: PageDef = {
      template: "<body><p>hi</p></body>",
      loaders: { page: () => ({ procedure: "getData", input: {} }) },
      layoutChain: [],
    };
    const procs = makeProcedures(["getData", mockProcedure(() => ({ v: 1 }))]);
    const result = await handlePageRequest(page, {}, procs);

    expect(result.html).toContain('id="__data"');
  });
});
