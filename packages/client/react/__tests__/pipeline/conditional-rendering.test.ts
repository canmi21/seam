/* packages/client/react/__tests__/pipeline/conditional-rendering.test.ts */

import { describe, it } from "vitest";
import { createElement } from "react";
import { useSeamData } from "../../src/index.js";
import { assertPipelineFidelity } from "./test-utils.js";

describe("2.1a basic boolean conditions", () => {
  it("26. conditional rendering with && operator", () => {
    function App() {
      const { show, text } = useSeamData<{ show: boolean; text: string }>();
      return createElement("div", null, show && createElement("span", null, text));
    }
    // true case
    assertPipelineFidelity({
      component: App,
      mock: { show: true, text: "hello" },
      booleans: ["show"],
      realData: { show: true, text: "visible" },
    });
    // false case
    assertPipelineFidelity({
      component: App,
      mock: { show: true, text: "hello" },
      booleans: ["show"],
      realData: { show: false, text: "visible" },
    });
  });

  it("27. false branch: siblings unaffected", () => {
    function App() {
      const { show, text } = useSeamData<{ show: boolean; text: string }>();
      return createElement(
        "div",
        null,
        createElement("p", null, "before"),
        show && createElement("span", null, text),
        createElement("p", null, "after"),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { show: true, text: "hello" },
      booleans: ["show"],
      realData: { show: true, text: "middle" },
    });
    assertPipelineFidelity({
      component: App,
      mock: { show: true, text: "hello" },
      booleans: ["show"],
      realData: { show: false, text: "middle" },
    });
  });
});

describe("2.1b nested boolean conditions", () => {
  // Nested booleans: sequential extraction does not yet rebase inner offsets
  it.fails("28. nested boolean: outer true + inner true", () => {
    function App() {
      const { outer, inner } = useSeamData<{ outer: boolean; inner: boolean }>();
      return createElement(
        "div",
        null,
        outer &&
          createElement(
            "div",
            null,
            createElement("span", null, "outer"),
            inner && createElement("span", null, "inner"),
          ),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { outer: true, inner: true },
      booleans: ["outer", "inner"],
      realData: { outer: true, inner: true },
    });
  });

  it.fails("29. nested boolean: outer true + inner false", () => {
    function App() {
      const { outer, inner } = useSeamData<{ outer: boolean; inner: boolean }>();
      return createElement(
        "div",
        null,
        outer &&
          createElement(
            "div",
            null,
            createElement("span", null, "outer"),
            inner && createElement("span", null, "inner"),
          ),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { outer: true, inner: true },
      booleans: ["outer", "inner"],
      realData: { outer: true, inner: false },
    });
  });

  it.fails("30. nested boolean: outer false", () => {
    function App() {
      const { outer, inner } = useSeamData<{ outer: boolean; inner: boolean }>();
      return createElement(
        "div",
        null,
        outer &&
          createElement(
            "div",
            null,
            createElement("span", null, "outer"),
            inner && createElement("span", null, "inner"),
          ),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { outer: true, inner: true },
      booleans: ["outer", "inner"],
      realData: { outer: false, inner: true },
    });
  });
});

describe("2.2a basic ternary conditions", () => {
  it("31. ternary true branch", () => {
    function App() {
      const { active } = useSeamData<{ active: boolean }>();
      return createElement(
        "div",
        null,
        active ? createElement("span", null, "on") : createElement("span", null, "off"),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { active: true },
      booleans: ["active"],
      realData: { active: true },
    });
  });

  it("32. ternary false branch", () => {
    function App() {
      const { active } = useSeamData<{ active: boolean }>();
      return createElement(
        "div",
        null,
        active ? createElement("span", null, "on") : createElement("span", null, "off"),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { active: true },
      booleans: ["active"],
      realData: { active: false },
    });
  });

  it("33. branches with different DOM structure", () => {
    function App() {
      const { mode } = useSeamData<{ mode: boolean }>();
      return createElement(
        "div",
        null,
        mode
          ? createElement(
              "section",
              null,
              createElement("h2", null, "Detail"),
              createElement("p", null, "content"),
            )
          : createElement("span", null, "compact"),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { mode: true },
      booleans: ["mode"],
      realData: { mode: true },
    });
    assertPipelineFidelity({
      component: App,
      mock: { mode: true },
      booleans: ["mode"],
      realData: { mode: false },
    });
  });
});

describe("2.2b complex ternary conditions", () => {
  it("34. one branch is null", () => {
    function App() {
      const { visible, text } = useSeamData<{ visible: boolean; text: string }>();
      return createElement("div", null, visible ? createElement("span", null, text) : null);
    }
    assertPipelineFidelity({
      component: App,
      mock: { visible: true, text: "hello" },
      booleans: ["visible"],
      realData: { visible: true, text: "shown" },
    });
    assertPipelineFidelity({
      component: App,
      mock: { visible: true, text: "hello" },
      booleans: ["visible"],
      realData: { visible: false, text: "shown" },
    });
  });

  // Nested ternary: inner boolean block offset shifts after outer extraction
  it.fails("35. nested ternary", () => {
    function App() {
      const { a, b } = useSeamData<{ a: boolean; b: boolean }>();
      return createElement(
        "div",
        null,
        a
          ? b
            ? createElement("span", null, "both")
            : createElement("span", null, "only-a")
          : createElement("span", null, "none"),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { a: true, b: true },
      booleans: ["a", "b"],
      realData: { a: true, b: true },
    });
    assertPipelineFidelity({
      component: App,
      mock: { a: true, b: true },
      booleans: ["a", "b"],
      realData: { a: true, b: false },
    });
    assertPipelineFidelity({
      component: App,
      mock: { a: true, b: true },
      booleans: ["a", "b"],
      realData: { a: false, b: true },
    });
  });
});

describe("2.3 multi-branch conditions", () => {
  // Chained ternary with two booleans: same nested extraction limitation
  it.fails("36. if/else if/else chain via two booleans", () => {
    function App() {
      const { a, b } = useSeamData<{ a: boolean; b: boolean }>();
      return createElement(
        "div",
        null,
        a
          ? createElement("span", null, "first")
          : b
            ? createElement("span", null, "second")
            : createElement("span", null, "fallback"),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { a: true, b: true },
      booleans: ["a", "b"],
      realData: { a: true, b: false },
    });
    assertPipelineFidelity({
      component: App,
      mock: { a: true, b: true },
      booleans: ["a", "b"],
      realData: { a: false, b: true },
    });
    assertPipelineFidelity({
      component: App,
      mock: { a: true, b: true },
      booleans: ["a", "b"],
      realData: { a: false, b: false },
    });
  });

  it.todo("37. switch/case mapping — pipeline supports enum; needs enums config in test");
});

describe("2.4 condition-attribute mix", () => {
  it("38. condition determines attr value", () => {
    function App() {
      const { active } = useSeamData<{ active: boolean }>();
      return createElement("div", { className: active ? "on" : "off" }, "toggle");
    }
    assertPipelineFidelity({
      component: App,
      mock: { active: true },
      booleans: ["active"],
      realData: { active: true },
    });
    assertPipelineFidelity({
      component: App,
      mock: { active: true },
      booleans: ["active"],
      realData: { active: false },
    });
  });

  // Attr slot inside boolean block: inject cannot resolve slots within if blocks
  it.fails("39. condition determines attr presence", () => {
    function App() {
      const { show, label } = useSeamData<{ show: boolean; label: string }>();
      return createElement(
        "div",
        null,
        show && createElement("a", { href: "/link", title: label }, label),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { show: true, label: "click" },
      booleans: ["show"],
      realData: { show: true, label: "go" },
    });
    assertPipelineFidelity({
      component: App,
      mock: { show: true, label: "click" },
      booleans: ["show"],
      realData: { show: false, label: "go" },
    });
  });

  it("40. condition determines child props", () => {
    function App() {
      const { enabled, message } = useSeamData<{ enabled: boolean; message: string }>();
      return createElement("div", null, enabled && createElement("p", null, message));
    }
    assertPipelineFidelity({
      component: App,
      mock: { enabled: true, message: "hello" },
      booleans: ["enabled"],
      realData: { enabled: true, message: "active content" },
    });
    assertPipelineFidelity({
      component: App,
      mock: { enabled: true, message: "hello" },
      booleans: ["enabled"],
      realData: { enabled: false, message: "active content" },
    });
  });
});
