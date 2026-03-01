/* src/client/react/__tests__/pipeline/dom-structure.test.ts */

import { describe, it } from "vitest";
import { createElement, Fragment } from "react";
import { useSeamData } from "../../src/index.js";
import { assertPipelineFidelity } from "./test-utils.js";

describe("4.1 tag types", () => {
  it("53. block-level elements", () => {
    function App() {
      const data = useSeamData<{ title: string; body: string; note: string }>();
      return createElement(
        "div",
        null,
        createElement("section", null, data.title),
        createElement("article", null, data.body),
        createElement("aside", null, data.note),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { title: "t", body: "b", note: "n" },
      realData: { title: "Welcome", body: "Article content", note: "Side note" },
    });
  });

  it("54. inline elements", () => {
    function App() {
      const data = useSeamData<{ link: string; bold: string; italic: string }>();
      return createElement(
        "p",
        null,
        createElement("span", null, data.link),
        createElement("a", { href: "#" }, data.bold),
        createElement("strong", null, data.bold),
        createElement("em", null, data.italic),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { link: "l", bold: "b", italic: "i" },
      realData: { link: "Click here", bold: "Important", italic: "Emphasis" },
    });
  });

  it("55. self-closing tags", () => {
    // Avoid <img> — React 19 SSR adds <link rel="preload"> which the injector can't replicate
    function App() {
      const { text } = useSeamData<{ text: string }>();
      return createElement(
        "div",
        null,
        createElement("br", null),
        createElement("hr", null),
        createElement("input", { type: "text", placeholder: "enter" }),
        createElement("span", null, text),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "t" },
      realData: { text: "Self-closing tags above" },
    });
  });

  it("56. void elements", () => {
    // Use static attrs to avoid attr injection spacing artifacts on self-closing tags
    function App() {
      const { text } = useSeamData<{ text: string }>();
      return createElement(
        "div",
        null,
        createElement("area", { alt: "zone" }),
        createElement("col", null),
        createElement("embed", { src: "/static.mp4" }),
        createElement("source", { src: "/static.mp4" }),
        createElement("wbr", null),
        createElement("span", null, text),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "t" },
      realData: { text: "Void elements above" },
    });
  });

  it("57. textarea content", () => {
    function App() {
      const { text } = useSeamData<{ text: string }>();
      return createElement("textarea", { defaultValue: text });
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "placeholder" },
      realData: { text: "User entered some text here" },
    });
  });

  it.todo(
    "58. select + option selected — React SSR computes selected from defaultValue match, sentinel string matches no option so selected is lost",
  );
});

describe("4.2 nesting depth", () => {
  it("59. 3-level nesting", () => {
    function App() {
      const { text } = useSeamData<{ text: string }>();
      return createElement(
        "div",
        null,
        createElement("div", null, createElement("div", null, text)),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "t" },
      realData: { text: "Deeply nested content" },
    });
  });

  it("60. 10-level nesting", () => {
    function App() {
      const { text } = useSeamData<{ text: string }>();
      let node: React.ReactElement = createElement("span", null, text);
      for (let i = 0; i < 10; i++) {
        node = createElement("div", null, node);
      }
      return node;
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "t" },
      realData: { text: "Ten levels deep" },
    });
  });

  it("61. 20-level nesting", () => {
    function App() {
      const { text } = useSeamData<{ text: string }>();
      let node: React.ReactElement = createElement("span", null, text);
      for (let i = 0; i < 20; i++) {
        node = createElement("div", null, node);
      }
      return node;
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "t" },
      realData: { text: "Twenty levels deep" },
    });
  });
});

describe("4.3 Fragment", () => {
  it("62. top-level Fragment (multiple roots)", () => {
    function App() {
      const data = useSeamData<{ a: string; b: string }>();
      return createElement(
        Fragment,
        null,
        createElement("h1", null, data.a),
        createElement("p", null, data.b),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { a: "t", b: "p" },
      realData: { a: "Title", b: "Paragraph" },
    });
  });

  it("63. Fragment with mixed elements and text", () => {
    function App() {
      const data = useSeamData<{ word: string; note: string }>();
      return createElement(
        Fragment,
        null,
        "Static prefix ",
        createElement("strong", null, data.word),
        " middle ",
        createElement("em", null, data.note),
        " static suffix",
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { word: "w", note: "n" },
      realData: { word: "bold text", note: "italic text" },
    });
  });

  it("64. nested Fragment", () => {
    function App() {
      const data = useSeamData<{ a: string; b: string; c: string }>();
      return createElement(
        Fragment,
        null,
        createElement("h1", null, data.a),
        createElement(
          Fragment,
          null,
          createElement("p", null, data.b),
          createElement("p", null, data.c),
        ),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { a: "a", b: "b", c: "c" },
      realData: { a: "Heading", b: "First paragraph", c: "Second paragraph" },
    });
  });

  it("65. Fragment with conditional", () => {
    function App() {
      const data = useSeamData<{ show: boolean; text: string }>();
      return createElement(
        Fragment,
        null,
        createElement("p", null, "always"),
        data.show ? createElement("p", null, data.text) : null,
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { show: true, text: "t" },
      realData: { show: true, text: "Conditionally shown" },
      booleans: ["show"],
    });
  });

  it("66. Fragment with list", () => {
    function App() {
      const data = useSeamData<{ items: { label: string }[] }>();
      return createElement(
        Fragment,
        null,
        createElement("h2", null, "List"),
        data.items.map((item, i) => createElement("span", { key: i }, item.label)),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { items: [{ label: "x" }] },
      realData: { items: [{ label: "Alpha" }, { label: "Beta" }, { label: "Gamma" }] },
      arrays: ["items"],
    });
  });
});

// eslint-disable-next-line max-lines-per-function -- test suite grows with HTML edge cases
describe("4.4 special HTML", () => {
  it("67. table strict nesting", () => {
    function App() {
      const data = useSeamData<{ header: string; cell: string }>();
      return createElement(
        "table",
        null,
        createElement(
          "thead",
          null,
          createElement("tr", null, createElement("th", null, data.header)),
        ),
        createElement(
          "tbody",
          null,
          createElement("tr", null, createElement("td", null, data.cell)),
        ),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { header: "h", cell: "c" },
      realData: { header: "Name", cell: "Alice" },
    });
  });

  it("68. ul/li and ol/li", () => {
    function App() {
      const data = useSeamData<{ a: string; b: string; c: string }>();
      return createElement(
        "div",
        null,
        createElement(
          "ul",
          null,
          createElement("li", null, data.a),
          createElement("li", null, data.b),
        ),
        createElement("ol", null, createElement("li", null, data.c)),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { a: "a", b: "b", c: "c" },
      realData: { a: "First", b: "Second", c: "Ordered item" },
    });
  });

  it("69. dl/dt/dd", () => {
    function App() {
      const data = useSeamData<{ term: string; desc: string }>();
      return createElement(
        "dl",
        null,
        createElement("dt", null, data.term),
        createElement("dd", null, data.desc),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { term: "t", desc: "d" },
      realData: { term: "HTML", desc: "HyperText Markup Language" },
    });
  });

  it("70. SVG elements", () => {
    // Use dynamic text content instead of dynamic attr to avoid attr ordering issue
    function App() {
      const { label } = useSeamData<{ label: string }>();
      return createElement(
        "svg",
        { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 100 100" },
        createElement("circle", { cx: "50", cy: "50", r: "25" }),
        createElement("text", { x: "50", y: "50" }, label),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { label: "x" },
      realData: { label: "Hello SVG" },
    });
  });

  it("71. MathML basic fraction", () => {
    function App() {
      const { num, den } = useSeamData<{ num: string; den: string }>();
      return createElement(
        "math",
        { xmlns: "http://www.w3.org/1998/Math/MathML" },
        createElement(
          "mfrac",
          null,
          createElement("mi", null, num),
          createElement("mi", null, den),
        ),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { num: "x", den: "y" },
      realData: { num: "a", den: "b" },
    });
  });

  it("72. pre preserves whitespace", () => {
    function App() {
      const { code } = useSeamData<{ code: string }>();
      return createElement("pre", null, code);
    }
    assertPipelineFidelity({
      component: App,
      mock: { code: "x" },
      realData: { code: "function foo() {\n  return 1;\n}" },
    });
  });
});

describe("4.5 innerHTML", () => {
  // Static innerHTML test: dangerouslySetInnerHTML with hardcoded safe HTML
  // for structure preservation testing only
  it("73. innerHTML static", () => {
    function App() {
      const { title } = useSeamData<{ title: string }>();
      return createElement(
        "div",
        null,
        createElement("h1", null, title),
        createElement("div", {
          dangerouslySetInnerHTML: { __html: "<p>static</p>" },
        }),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { title: "t" },
      realData: { title: "Page Title" },
    });
  });

  // 74–75: dynamic innerHTML requires an html-slot generation mechanism.
  // The injector already supports <!--seam:path:html--> (raw HTML injection),
  // but buildSentinelData / sentinelToSlots have no way to detect
  // the innerHTML prop and emit :html markers. Needs design: schema-level
  // t.html() type, or component-level detection.
  // 75 additionally raises XSS concerns (script tag injection).
  it.todo("74. innerHTML dynamic — needs html-slot generation design");
  it.todo("75. innerHTML with script tag — same as 74, plus XSS safety considerations");
});
