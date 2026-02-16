/* packages/client/react/__tests__/pipeline/react-markers.test.ts */

import { describe, it } from "vitest";
import { createElement, Suspense } from "react";
import { useSeamData } from "../../src/index.js";
import { assertPipelineFidelity } from "./test-utils.js";

describe("5. React comment markers", () => {
  it("76. empty comment marker from false conditional", () => {
    function App() {
      const { text } = useSeamData<{ text: string }>();
      // null child produces <!-- --> comment in React SSR
      return createElement("div", null, null, createElement("p", null, text));
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "placeholder" },
      realData: { text: "hello" },
    });
  });

  it("77. Suspense boundary markers", () => {
    function App() {
      const { text } = useSeamData<{ text: string }>();
      return createElement(
        Suspense,
        { fallback: createElement("span", null, "loading") },
        createElement("p", null, text),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "placeholder" },
      realData: { text: "loaded content" },
    });
  });

  it("78. adjacent text node comment separators", () => {
    function App() {
      const data = useSeamData<{ a: string; b: string }>();
      return createElement("p", null, data.a, " and ", data.b);
    }
    assertPipelineFidelity({
      component: App,
      mock: { a: "foo", b: "bar" },
      realData: { a: "hello", b: "world" },
    });
  });

  it("79. conditional false placeholder comment", () => {
    function App() {
      const { show, text } = useSeamData<{ show: boolean; text: string }>();
      return createElement(
        "div",
        null,
        show ? createElement("span", null, "visible") : null,
        createElement("p", null, text),
      );
    }
    // true case
    assertPipelineFidelity({
      component: App,
      mock: { show: true, text: "hello" },
      booleans: ["show"],
      realData: { show: true, text: "content" },
    });
    // false case: React emits <!-- --> placeholder
    assertPipelineFidelity({
      component: App,
      mock: { show: true, text: "hello" },
      booleans: ["show"],
      realData: { show: false, text: "content" },
    });
  });

  it("80. multiple adjacent comments order", () => {
    function App() {
      const { text } = useSeamData<{ text: string }>();
      return createElement("div", null, null, false, createElement("span", null, text), null);
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "placeholder" },
      realData: { text: "content" },
    });
  });

  it("81. comments adjacent to dynamic content", () => {
    function App() {
      const { text } = useSeamData<{ text: string }>();
      return createElement("div", null, null, text, null);
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "placeholder" },
      realData: { text: "dynamic" },
    });
  });
});
