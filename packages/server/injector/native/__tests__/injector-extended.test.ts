/* packages/server/injector/native/__tests__/injector-extended.test.ts */

import { describe, expect, it } from "vitest";
import { inject } from "../src/injector.js";

describe("boolean HTML attributes", () => {
  it('renders disabled="" for truthy value', () => {
    const html = inject(
      "<!--seam:dis:attr:disabled--><input>",
      { dis: true },
      { skipDataScript: true },
    );
    expect(html).toBe('<input disabled="">');
  });

  it("omits disabled for falsy value", () => {
    const html = inject(
      "<!--seam:dis:attr:disabled--><input>",
      { dis: false },
      { skipDataScript: true },
    );
    expect(html).toBe("<input>");
  });

  it('renders checked="" for truthy value', () => {
    // Attribute injection inserts after tag name, before existing attrs
    const html = inject(
      '<!--seam:chk:attr:checked--><input type="checkbox">',
      { chk: true },
      { skipDataScript: true },
    );
    expect(html).toBe('<input checked="" type="checkbox">');
  });

  it('renders selected="" for truthy value', () => {
    const html = inject(
      "<!--seam:sel:attr:selected--><option>A</option>",
      { sel: true },
      { skipDataScript: true },
    );
    expect(html).toBe('<option selected="">A</option>');
  });

  it("omits selected for falsy value", () => {
    const html = inject(
      "<!--seam:sel:attr:selected--><option>A</option>",
      { sel: false },
      { skipDataScript: true },
    );
    expect(html).toBe("<option>A</option>");
  });

  it("does not apply boolean logic to non-boolean attrs", () => {
    const html = inject(
      "<!--seam:cls:attr:class--><div>hi</div>",
      { cls: true },
      { skipDataScript: true },
    );
    expect(html).toBe('<div class="true">hi</div>');
  });
});

describe("style property slots", () => {
  it("injects single style property", () => {
    const html = inject(
      "<!--seam:mt:style:margin-top--><div>text</div>",
      { mt: 16 },
      { skipDataScript: true },
    );
    expect(html).toBe('<div style="margin-top:16px">text</div>');
  });

  it("injects multiple style properties", () => {
    const html = inject(
      "<!--seam:mt:style:margin-top--><!--seam:fs:style:font-size--><div>text</div>",
      { mt: 16, fs: 14 },
      { skipDataScript: true },
    );
    expect(html).toBe('<div style="margin-top:16px;font-size:14px">text</div>');
  });

  it("adds px to numbers for non-unitless properties", () => {
    const html = inject(
      "<!--seam:mt:style:margin-top--><div>text</div>",
      { mt: 16 },
      { skipDataScript: true },
    );
    expect(html).toBe('<div style="margin-top:16px">text</div>');
  });

  it("omits px for unitless properties", () => {
    const html = inject(
      "<!--seam:op:style:opacity--><span>text</span>",
      { op: 0.5 },
      { skipDataScript: true },
    );
    expect(html).toBe('<span style="opacity:0.5">text</span>');
  });

  it("renders zero without px", () => {
    const html = inject(
      "<!--seam:mt:style:margin-top--><div>text</div>",
      { mt: 0 },
      { skipDataScript: true },
    );
    expect(html).toBe('<div style="margin-top:0">text</div>');
  });

  it("skips null values", () => {
    const html = inject(
      "<!--seam:mt:style:margin-top--><div>text</div>",
      { mt: null },
      { skipDataScript: true },
    );
    expect(html).toBe("<div>text</div>");
  });

  it("skips false values", () => {
    const html = inject(
      "<!--seam:mt:style:margin-top--><div>text</div>",
      { mt: false },
      { skipDataScript: true },
    );
    expect(html).toBe("<div>text</div>");
  });

  it("merges with existing static style", () => {
    const html = inject(
      '<!--seam:mt:style:margin-top--><div style="color:red">text</div>',
      { mt: 16 },
      { skipDataScript: true },
    );
    expect(html).toBe('<div style="color:red;margin-top:16px">text</div>');
  });

  it("passes string values through", () => {
    const html = inject(
      "<!--seam:c:style:color--><div>text</div>",
      { c: "blue" },
      { skipDataScript: true },
    );
    expect(html).toBe('<div style="color:blue">text</div>');
  });
});

describe("combined", () => {
  it("handles all slot types in one template", () => {
    const tmpl = [
      "<html><body>",
      "<!--seam:cls:attr:class--><div>",
      "<!--seam:if:user-->",
      "<h1><!--seam:user.name--></h1>",
      "<div><!--seam:user.bio:html--></div>",
      "<!--seam:endif:user-->",
      "</div>",
      "</body></html>",
    ].join("");

    const data = {
      cls: "container",
      user: { name: "Alice & Bob", bio: "<em>friends</em>" },
    };

    const html = inject(tmpl, data);
    expect(html).toContain('class="container"');
    expect(html).toContain("<h1>Alice &amp; Bob</h1>");
    expect(html).toContain("<div><em>friends</em></div>");
    expect(html).toContain('id="__data"');
  });
});

describe("metadata tag injection", () => {
  it("injects text inside <title>", () => {
    const html = inject("<title><!--seam:t--></title>", { t: "My Page" }, { skipDataScript: true });
    expect(html).toBe("<title>My Page</title>");
  });

  it("injects attr on void <meta>", () => {
    const html = inject(
      '<!--seam:d:attr:content--><meta name="description">',
      { d: "A description" },
      { skipDataScript: true },
    );
    expect(html).toBe('<meta content="A description" name="description">');
  });

  it("injects attr on void <link>", () => {
    const html = inject(
      '<!--seam:u:attr:href--><link rel="canonical">',
      { u: "https://example.com" },
      { skipDataScript: true },
    );
    expect(html).toBe('<link href="https://example.com" rel="canonical">');
  });

  it("preserves order for multiple dynamic attrs on same element", () => {
    const html = inject(
      '<!--seam:a:attr:property--><!--seam:b:attr:content--><meta name="og">',
      { a: "og:title", b: "My Page" },
      { skipDataScript: true },
    );
    expect(html).toBe('<meta property="og:title" content="My Page" name="og">');
  });

  it("preserves order for three dynamic attrs", () => {
    const html = inject(
      "<!--seam:x:attr:id--><!--seam:y:attr:class--><!--seam:z:attr:title--><div>text</div>",
      { x: "main", y: "active", z: "hello" },
      { skipDataScript: true },
    );
    expect(html).toBe('<div id="main" class="active" title="hello">text</div>');
  });

  it("handles dynamic attr alongside existing static attr", () => {
    const html = inject(
      '<!--seam:d:attr:content--><meta name="description">',
      { d: "A description" },
      { skipDataScript: true },
    );
    expect(html).toBe('<meta content="A description" name="description">');
  });

  it("handles boolean + non-boolean attrs on same element", () => {
    const html = inject(
      '<!--seam:cls:attr:class--><!--seam:dis:attr:disabled--><input type="text">',
      { cls: "field", dis: true },
      { skipDataScript: true },
    );
    expect(html).toBe('<input class="field" disabled="" type="text">');
  });

  it("injects into full document with hoisted metadata", () => {
    const tmpl = [
      '<!DOCTYPE html><html><head><meta charset="utf-8">',
      "<title><!--seam:t--></title>",
      '<!--seam:d:attr:content--><meta name="description">',
      '<link rel="stylesheet" href="/_seam/static/style.css">',
      '</head><body><div id="__seam">',
      "<p><!--seam:body--></p>",
      "</div></body></html>",
    ].join("");

    const html = inject(
      tmpl,
      { t: "Home", d: "Welcome page", body: "Hello world" },
      { skipDataScript: true },
    );

    // <head> section has injected values
    const head = html.split("</head>")[0];
    expect(head).toContain("style.css");
    expect(head).toContain("<title>Home</title>");
    expect(head).toContain('content="Welcome page"');

    // Content injected correctly
    expect(html).toContain("<p>Hello world</p>");
  });
});
