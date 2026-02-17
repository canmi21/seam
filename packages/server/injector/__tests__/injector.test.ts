/* packages/server/injector/__tests__/injector.test.ts */

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

    it("removes block for empty array (falsy)", () => {
      const html = inject(
        "<!--seam:if:items--><p>yes</p><!--seam:endif:items-->",
        { items: [] },
        { skipDataScript: true },
      );
      expect(html).toBe("");
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

  describe("else branch", () => {
    it("renders then-block when truthy", () => {
      const tmpl = "<!--seam:if:logged-->Hello<!--seam:else-->Guest<!--seam:endif:logged-->";
      const html = inject(tmpl, { logged: true }, { skipDataScript: true });
      expect(html).toBe("Hello");
    });

    it("renders else-block when falsy", () => {
      const tmpl = "<!--seam:if:logged-->Hello<!--seam:else-->Guest<!--seam:endif:logged-->";
      const html = inject(tmpl, { logged: false }, { skipDataScript: true });
      expect(html).toBe("Guest");
    });

    it("renders else-block when null", () => {
      const tmpl =
        "<!--seam:if:user--><!--seam:user.name--><!--seam:else-->Anonymous<!--seam:endif:user-->";
      const html = inject(tmpl, { user: null }, { skipDataScript: true });
      expect(html).toBe("Anonymous");
    });

    it("renders else-block for empty array", () => {
      const tmpl =
        "<!--seam:if:items--><ul>list</ul><!--seam:else--><p>No items</p><!--seam:endif:items-->";
      const html = inject(tmpl, { items: [] }, { skipDataScript: true });
      expect(html).toBe("<p>No items</p>");
    });
  });

  describe("each iteration", () => {
    it("repeats body for each array element", () => {
      const tmpl = "<!--seam:each:items--><li><!--seam:$.name--></li><!--seam:endeach-->";
      const html = inject(
        tmpl,
        { items: [{ name: "a" }, { name: "b" }] },
        { skipDataScript: true },
      );
      expect(html).toBe("<li>a</li><li>b</li>");
    });

    it("produces no output for empty array", () => {
      const tmpl = "<!--seam:each:items--><li><!--seam:$.name--></li><!--seam:endeach-->";
      const html = inject(tmpl, { items: [] }, { skipDataScript: true });
      expect(html).toBe("");
    });

    it("produces no output for missing path", () => {
      const tmpl = "<!--seam:each:items--><li>x</li><!--seam:endeach-->";
      const html = inject(tmpl, {}, { skipDataScript: true });
      expect(html).toBe("");
    });

    it("handles attribute inside each", () => {
      const tmpl =
        "<!--seam:each:links--><!--seam:$.url:attr:href--><a><!--seam:$.text--></a><!--seam:endeach-->";
      const html = inject(
        tmpl,
        {
          links: [
            { url: "/a", text: "A" },
            { url: "/b", text: "B" },
          ],
        },
        { skipDataScript: true },
      );
      expect(html).toBe('<a href="/a">A</a><a href="/b">B</a>');
    });

    it("supports nested each with $$ reference", () => {
      const tmpl = [
        "<!--seam:each:groups-->",
        "<h2><!--seam:$.title--></h2>",
        "<!--seam:each:$.items-->",
        "<p><!--seam:$.label--> in <!--seam:$$.title--></p>",
        "<!--seam:endeach-->",
        "<!--seam:endeach-->",
      ].join("");
      const data = {
        groups: [
          { title: "G1", items: [{ label: "x" }, { label: "y" }] },
          { title: "G2", items: [{ label: "z" }] },
        ],
      };
      const html = inject(tmpl, data, { skipDataScript: true });
      expect(html).toBe("<h2>G1</h2><p>x in G1</p><p>y in G1</p><h2>G2</h2><p>z in G2</p>");
    });
  });

  describe("empty array falsy", () => {
    it("treats empty array as falsy in if block", () => {
      const tmpl = "<!--seam:if:items-->has<!--seam:endif:items-->";
      expect(inject(tmpl, { items: [] }, { skipDataScript: true })).toBe("");
      expect(inject(tmpl, { items: [1] }, { skipDataScript: true })).toBe("has");
    });
  });

  describe("if inside each", () => {
    it("applies conditional per item", () => {
      const tmpl = [
        "<!--seam:each:users-->",
        "<!--seam:if:$.active--><b><!--seam:$.name--></b><!--seam:endif:$.active-->",
        "<!--seam:endeach-->",
      ].join("");
      const data = {
        users: [
          { name: "Alice", active: true },
          { name: "Bob", active: false },
          { name: "Carol", active: true },
        ],
      };
      const html = inject(tmpl, data, { skipDataScript: true });
      expect(html).toBe("<b>Alice</b><b>Carol</b>");
    });
  });

  describe("same-path nested if", () => {
    it("supports same-path nested if blocks (AST handles it)", () => {
      const tmpl =
        "<!--seam:if:x-->outer[<!--seam:if:x-->inner<!--seam:endif:x-->]<!--seam:endif:x-->";
      expect(inject(tmpl, { x: true }, { skipDataScript: true })).toBe("outer[inner]");
      expect(inject(tmpl, { x: false }, { skipDataScript: true })).toBe("");
    });
  });

  describe("match/when/endmatch", () => {
    it("renders matching branch from 3 options", () => {
      const tmpl = [
        "<!--seam:match:role-->",
        "<!--seam:when:admin--><b>Admin</b>",
        "<!--seam:when:member--><i>Member</i>",
        "<!--seam:when:guest--><span>Guest</span>",
        "<!--seam:endmatch-->",
      ].join("");

      expect(inject(tmpl, { role: "admin" }, { skipDataScript: true })).toBe("<b>Admin</b>");
      expect(inject(tmpl, { role: "member" }, { skipDataScript: true })).toBe("<i>Member</i>");
      expect(inject(tmpl, { role: "guest" }, { skipDataScript: true })).toBe("<span>Guest</span>");
    });

    it("renders nothing when value does not match any branch", () => {
      const tmpl = [
        "<!--seam:match:role-->",
        "<!--seam:when:admin-->Admin",
        "<!--seam:when:guest-->Guest",
        "<!--seam:endmatch-->",
      ].join("");
      expect(inject(tmpl, { role: "unknown" }, { skipDataScript: true })).toBe("");
    });

    it("renders nothing when path is missing", () => {
      const tmpl = [
        "<!--seam:match:role-->",
        "<!--seam:when:admin-->Admin",
        "<!--seam:endmatch-->",
      ].join("");
      expect(inject(tmpl, {}, { skipDataScript: true })).toBe("");
    });

    it("supports match inside each", () => {
      const tmpl = [
        "<!--seam:each:items-->",
        "<!--seam:match:$.priority-->",
        "<!--seam:when:high--><b>!</b>",
        "<!--seam:when:low--><span>~</span>",
        "<!--seam:endmatch-->",
        "<!--seam:endeach-->",
      ].join("");
      const data = {
        items: [{ priority: "high" }, { priority: "low" }, { priority: "medium" }],
      };
      expect(inject(tmpl, data, { skipDataScript: true })).toBe("<b>!</b><span>~</span>");
    });

    it("supports slots inside match branches", () => {
      const tmpl = [
        "<!--seam:match:role-->",
        "<!--seam:when:admin--><b><!--seam:name--></b>",
        "<!--seam:when:guest--><span>Guest</span>",
        "<!--seam:endmatch-->",
      ].join("");
      expect(inject(tmpl, { role: "admin", name: "Alice" }, { skipDataScript: true })).toBe(
        "<b>Alice</b>",
      );
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
      expect(html).toContain('id="__SEAM_DATA__"');
    });
  });
});
