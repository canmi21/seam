/* packages/injector/__tests__/injector.test.ts */

import { describe, expect, it } from "vitest";
import { inject } from "../src/injector.js";

describe("inject", () => {
  describe("text slots", () => {
    it("replaces text slot with escaped value", () => {
      const html = inject("<p><!--seam:name--></p>", { name: "Alice" }, { skipDataScript: true });
      expect(html).toBe("<p>Alice</p>");
    });

    it("escapes HTML entities in text slots", () => {
      const html = inject(
        "<p><!--seam:msg--></p>",
        { msg: '<script>alert("xss")</script>' },
        { skipDataScript: true },
      );
      expect(html).toBe("<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>");
    });

    it("escapes ampersand and quotes", () => {
      const html = inject("<p><!--seam:v--></p>", { v: "A&B 'C'" }, { skipDataScript: true });
      expect(html).toBe("<p>A&amp;B &#x27;C&#x27;</p>");
    });

    it("resolves nested paths", () => {
      const html = inject(
        "<p><!--seam:user.address.city--></p>",
        { user: { address: { city: "Tokyo" } } },
        { skipDataScript: true },
      );
      expect(html).toBe("<p>Tokyo</p>");
    });

    it("returns empty string for missing path", () => {
      const html = inject("<p><!--seam:missing--></p>", {}, { skipDataScript: true });
      expect(html).toBe("<p></p>");
    });

    it("converts non-string values via String()", () => {
      const html = inject("<p><!--seam:count--></p>", { count: 42 }, { skipDataScript: true });
      expect(html).toBe("<p>42</p>");
    });

    it("converts boolean values", () => {
      const html = inject("<p><!--seam:flag--></p>", { flag: true }, { skipDataScript: true });
      expect(html).toBe("<p>true</p>");
    });

    it("converts null to empty string", () => {
      const html = inject("<p><!--seam:v--></p>", { v: null }, { skipDataScript: true });
      expect(html).toBe("<p></p>");
    });
  });

  describe("raw HTML slots", () => {
    it("replaces raw slot without escaping", () => {
      const html = inject(
        "<div><!--seam:content:html--></div>",
        { content: "<b>bold</b>" },
        { skipDataScript: true },
      );
      expect(html).toBe("<div><b>bold</b></div>");
    });

    it("returns empty string for missing raw path", () => {
      const html = inject("<div><!--seam:missing:html--></div>", {}, { skipDataScript: true });
      expect(html).toBe("<div></div>");
    });
  });

  describe("attribute slots", () => {
    it("injects attribute on next opening tag", () => {
      const html = inject(
        "<!--seam:cls:attr:class--><div>hi</div>",
        { cls: "active" },
        { skipDataScript: true },
      );
      expect(html).toBe('<div class="active">hi</div>');
    });

    it("escapes attribute values", () => {
      const html = inject(
        "<!--seam:v:attr:title--><span>x</span>",
        { v: 'a"b' },
        { skipDataScript: true },
      );
      expect(html).toBe('<span title="a&quot;b">x</span>');
    });

    it("skips injection for missing path", () => {
      const html = inject(
        "<!--seam:missing:attr:class--><div>hi</div>",
        {},
        { skipDataScript: true },
      );
      expect(html).toBe("<div>hi</div>");
    });
  });

  describe("conditional slots", () => {
    it("keeps block when value is truthy", () => {
      const html = inject(
        "<!--seam:if:show--><p>visible</p><!--seam:endif:show-->",
        { show: true },
        { skipDataScript: true },
      );
      expect(html).toBe("<p>visible</p>");
    });

    it("removes block when value is falsy (false)", () => {
      const html = inject(
        "<!--seam:if:show--><p>hidden</p><!--seam:endif:show-->",
        { show: false },
        { skipDataScript: true },
      );
      expect(html).toBe("");
    });

    it("removes block when value is falsy (null)", () => {
      const html = inject(
        "<!--seam:if:show--><p>hidden</p><!--seam:endif:show-->",
        { show: null },
        { skipDataScript: true },
      );
      expect(html).toBe("");
    });

    it("removes block when value is falsy (0)", () => {
      const html = inject(
        "<!--seam:if:count--><p>has items</p><!--seam:endif:count-->",
        { count: 0 },
        { skipDataScript: true },
      );
      expect(html).toBe("");
    });

    it("removes block when value is falsy (empty string)", () => {
      const html = inject(
        "<!--seam:if:name--><p>hi</p><!--seam:endif:name-->",
        { name: "" },
        { skipDataScript: true },
      );
      expect(html).toBe("");
    });

    it("removes block when path is missing", () => {
      const html = inject(
        "<!--seam:if:missing--><p>gone</p><!--seam:endif:missing-->",
        {},
        { skipDataScript: true },
      );
      expect(html).toBe("");
    });

    it("keeps block for truthy object", () => {
      const html = inject(
        "<!--seam:if:user--><p>logged in</p><!--seam:endif:user-->",
        { user: { name: "A" } },
        { skipDataScript: true },
      );
      expect(html).toBe("<p>logged in</p>");
    });

    it("keeps block for empty array (truthy)", () => {
      const html = inject(
        "<!--seam:if:items--><p>yes</p><!--seam:endif:items-->",
        { items: [] },
        { skipDataScript: true },
      );
      expect(html).toBe("<p>yes</p>");
    });

    it("supports nested conditionals with different paths", () => {
      const tmpl = "<!--seam:if:a-->[<!--seam:if:b-->inner<!--seam:endif:b-->]<!--seam:endif:a-->";
      expect(inject(tmpl, { a: true, b: true }, { skipDataScript: true })).toBe("[inner]");
      expect(inject(tmpl, { a: true, b: false }, { skipDataScript: true })).toBe("[]");
      expect(inject(tmpl, { a: false, b: true }, { skipDataScript: true })).toBe("");
    });

    it("removes slots inside removed conditional block", () => {
      const tmpl = "<!--seam:if:show--><p><!--seam:name--></p><!--seam:endif:show-->";
      const html = inject(tmpl, { show: false, name: "Alice" }, { skipDataScript: true });
      expect(html).toBe("");
    });
  });

  describe("__SEAM_DATA__ script", () => {
    it("inserts before </body>", () => {
      const html = inject("<body><p>hi</p></body>", { x: 1 });
      expect(html).toBe(
        '<body><p>hi</p><script id="__SEAM_DATA__" type="application/json">{"x":1}</script></body>',
      );
    });

    it("appends at end when no </body>", () => {
      const html = inject("<p>hi</p>", { x: 1 });
      expect(html).toBe(
        '<p>hi</p><script id="__SEAM_DATA__" type="application/json">{"x":1}</script>',
      );
    });

    it("is omitted when skipDataScript is true", () => {
      const html = inject("<body><p>hi</p></body>", { x: 1 }, { skipDataScript: true });
      expect(html).toBe("<body><p>hi</p></body>");
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
      expect(html).toContain('id="__SEAM_DATA__"');
    });
  });
});
