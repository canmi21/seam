/* src/server/injector/js/__tests__/parity.test.ts */

import { describe, expect, it } from "vitest";
import { inject, escapeHtml } from "../src/index.js";
// Import from source to avoid requiring a build before test
import { inject as nativeInject, escapeHtml as nativeEscapeHtml } from "../../native/src/index.js";

const fixtures = [
  {
    name: "text slot",
    template: "<p><!--seam:name--></p>",
    data: { name: "Alice" },
  },
  {
    name: "html escape",
    template: "<p><!--seam:msg--></p>",
    data: { msg: '<script>alert("xss")</script>' },
  },
  {
    name: "nested path",
    template: "<p><!--seam:user.address.city--></p>",
    data: { user: { address: { city: "Tokyo" } } },
  },
  {
    name: "conditional true",
    template: "<!--seam:if:show--><p>yes</p><!--seam:endif:show-->",
    data: { show: true },
  },
  {
    name: "conditional false with else",
    template: "<!--seam:if:show-->yes<!--seam:else-->no<!--seam:endif:show-->",
    data: { show: false },
  },
  {
    name: "each loop",
    template: "<!--seam:each:items--><li><!--seam:$.name--></li><!--seam:endeach-->",
    data: { items: [{ name: "a" }, { name: "b" }] },
  },
  {
    name: "nested each with $$",
    template:
      "<!--seam:each:groups--><h2><!--seam:$.title--></h2><!--seam:each:$.items--><p><!--seam:$.label--> in <!--seam:$$.title--></p><!--seam:endeach--><!--seam:endeach-->",
    data: {
      groups: [
        { title: "G1", items: [{ label: "x" }, { label: "y" }] },
        { title: "G2", items: [{ label: "z" }] },
      ],
    },
  },
  {
    name: "attribute injection",
    template: "<!--seam:cls:attr:class--><div>hi</div>",
    data: { cls: "active" },
  },
  {
    name: "boolean attribute true",
    template: "<!--seam:dis:attr:disabled--><input>",
    data: { dis: true },
  },
  {
    name: "boolean attribute false",
    template: "<!--seam:dis:attr:disabled--><input>",
    data: { dis: false },
  },
  {
    name: "style injection",
    template: "<!--seam:mt:style:margin-top--><div>text</div>",
    data: { mt: 16 },
  },
  {
    name: "match/when",
    template:
      "<!--seam:match:role--><!--seam:when:admin--><b>Admin</b><!--seam:when:guest--><span>Guest</span><!--seam:endmatch-->",
    data: { role: "admin" },
  },
  {
    name: "__data injection",
    template: "<body><p>hi</p></body>",
    data: { x: 1 },
  },
];

describe("WASM parity with native TS", () => {
  for (const { name, template, data } of fixtures) {
    it(name, () => {
      const wasmResult = inject(template, data, { skipDataScript: true });
      const nativeResult = nativeInject(template, data, { skipDataScript: true });
      expect(wasmResult).toBe(nativeResult);
    });
  }

  it("__data script parity", () => {
    const template = "<body><p>hi</p></body>";
    const data = { x: 1 };
    const wasmResult = inject(template, data);
    const nativeResult = nativeInject(template, data);
    expect(wasmResult).toBe(nativeResult);
  });

  it("escapeHtml parity", () => {
    const input = `<div class="foo">&bar's</div>`;
    expect(escapeHtml(input)).toBe(nativeEscapeHtml(input));
  });
});
