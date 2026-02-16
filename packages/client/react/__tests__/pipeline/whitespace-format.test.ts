/* packages/client/react/__tests__/pipeline/whitespace-format.test.ts */

import { describe, it } from "vitest";
import { createElement } from "react";
import { useSeamData } from "../../src/index.js";
import { assertPipelineFidelity } from "./test-utils.js";

describe("6. whitespace and format", () => {
  it("82. no extra whitespace between elements", () => {
    function App() {
      const data = useSeamData<{ a: string; b: string }>();
      return createElement(
        "div",
        null,
        createElement("span", null, data.a),
        createElement("span", null, data.b),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { a: "x", b: "y" },
      realData: { a: "hello", b: "world" },
    });
  });

  it("83. text node leading/trailing whitespace preserved", () => {
    function App() {
      const { text } = useSeamData<{ text: string }>();
      return createElement("p", null, text);
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "x" },
      realData: { text: " hello world " },
    });
  });

  it("84. explicit space text node", () => {
    function App() {
      const data = useSeamData<{ a: string; b: string }>();
      return createElement("p", null, data.a, " ", data.b);
    }
    assertPipelineFidelity({
      component: App,
      mock: { a: "x", b: "y" },
      realData: { a: "hello", b: "world" },
    });
  });

  it("85. mixed text and elements", () => {
    function App() {
      const { word } = useSeamData<{ word: string }>();
      return createElement("p", null, "before ", createElement("strong", null, word), " after");
    }
    assertPipelineFidelity({
      component: App,
      mock: { word: "x" },
      realData: { word: "bold" },
    });
  });

  it("86. pre verbatim whitespace", () => {
    function App() {
      const { text } = useSeamData<{ text: string }>();
      return createElement("pre", null, text);
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "x" },
      realData: { text: "  line 1\n    line 2\n  line 3\n" },
    });
  });

  it("87. attribute order preserved", () => {
    // Static attrs on input; dynamic data in sibling text to trigger sentinel
    function App() {
      const { text } = useSeamData<{ text: string }>();
      return createElement(
        "div",
        null,
        createElement("input", {
          type: "text",
          className: "form-input",
          name: "field",
          placeholder: "enter",
        }),
        createElement("span", null, text),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "x" },
      realData: { text: "hello" },
    });
  });

  it("88. multiple inline styles", () => {
    function App() {
      const { text } = useSeamData<{ text: string }>();
      return createElement(
        "div",
        { style: { color: "red", fontSize: "12px", marginTop: "8px" } },
        text,
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "x" },
      realData: { text: "styled content" },
    });
  });
});
