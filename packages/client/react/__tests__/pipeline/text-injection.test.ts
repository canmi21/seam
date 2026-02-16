/* packages/client/react/__tests__/pipeline/text-injection.test.ts */

import { describe, it } from "vitest";
import { createElement } from "react";
import { useSeamData } from "../../src/index.js";
import { assertPipelineFidelity } from "./test-utils.js";

describe("1.1 text content injection", () => {
  it("01. plain English text", () => {
    function App() {
      const { title } = useSeamData<{ title: string }>();
      return createElement("h1", null, title);
    }
    assertPipelineFidelity({
      component: App,
      mock: { title: "Hello World" },
      realData: { title: "Welcome to Seam" },
    });
  });

  it("02. Chinese / Unicode / emoji", () => {
    function App() {
      const { text } = useSeamData<{ text: string }>();
      return createElement("p", null, text);
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "placeholder" },
      realData: { text: "你好世界 🌍 café résumé" },
    });
  });

  it("03. HTML special characters are escaped correctly", () => {
    function App() {
      const { content } = useSeamData<{ content: string }>();
      return createElement("span", null, content);
    }
    assertPipelineFidelity({
      component: App,
      mock: { content: "sample" },
      realData: { content: '<script>alert("xss")</script> & "quotes" < > \'' },
    });
  });

  it("04. empty string", () => {
    function App() {
      const { value } = useSeamData<{ value: string }>();
      return createElement("div", null, value);
    }
    assertPipelineFidelity({
      component: App,
      mock: { value: "placeholder" },
      realData: { value: "" },
    });
  });

  it("05. pure numbers (0, 1, -1, 3.14)", () => {
    function App() {
      const data = useSeamData<{
        zero: number;
        one: number;
        neg: number;
        pi: number;
      }>();
      return createElement(
        "div",
        null,
        createElement("span", null, String(data.zero)),
        createElement("span", null, String(data.one)),
        createElement("span", null, String(data.neg)),
        createElement("span", null, String(data.pi)),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { zero: 0, one: 1, neg: -1, pi: 3.14 },
      realData: { zero: 0, one: 1, neg: -1, pi: 3.14 },
    });
  });
});
