/* packages/client/react/__tests__/pipeline/component-patterns.test.ts */

import { describe, it } from "vitest";
import {
  createElement,
  forwardRef,
  lazy,
  memo,
  createContext,
  Suspense,
  useContext,
  useId,
  Component,
} from "react";
import type { ReactNode } from "react";
import { useSeamData } from "../../src/index.js";
import { assertPipelineFidelity } from "./test-utils.js";

describe("7a basic component patterns", () => {
  it("89. component returns null", () => {
    function App() {
      useSeamData<{ unused: string }>();
      return null;
    }
    assertPipelineFidelity({
      component: App,
      mock: { unused: "x" },
      realData: { unused: "y" },
    });
  });

  it("90. component returns string", () => {
    function App() {
      const { text } = useSeamData<{ text: string }>();
      return text;
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "placeholder" },
      realData: { text: "just a string" },
    });
  });

  it("91. component returns number", () => {
    function App() {
      const { num } = useSeamData<{ num: string }>();
      return createElement("span", null, num);
    }
    assertPipelineFidelity({
      component: App,
      mock: { num: "0" },
      realData: { num: "42" },
    });
  });

  it("92. HOC-wrapped component", () => {
    function withWrapper(Inner: React.FC) {
      return function Wrapped() {
        return createElement("div", { className: "wrapper" }, createElement(Inner));
      };
    }
    function BaseApp() {
      const { text } = useSeamData<{ text: string }>();
      return createElement("span", null, text);
    }
    const App = withWrapper(BaseApp);
    assertPipelineFidelity({
      component: App,
      mock: { text: "placeholder" },
      realData: { text: "wrapped content" },
    });
  });

  it("93. render props pattern", () => {
    function DataRenderer({ render }: { render: (text: string) => ReactNode }) {
      const { text } = useSeamData<{ text: string }>();
      return createElement("div", null, render(text));
    }
    function App() {
      return createElement(DataRenderer, {
        render: (text: string) => createElement("strong", null, text),
      });
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "placeholder" },
      realData: { text: "rendered via prop" },
    });
  });

  it("94. compound components", () => {
    function List({ children }: { children: ReactNode }) {
      return createElement("ul", null, children);
    }
    function Item({ text }: { text: string }) {
      return createElement("li", null, text);
    }
    function App() {
      const { items } = useSeamData<{ items: string }>();
      return createElement(List, null, createElement(Item, { text: items }));
    }
    assertPipelineFidelity({
      component: App,
      mock: { items: "placeholder" },
      realData: { items: "real item" },
    });
  });
});

// eslint-disable-next-line max-lines-per-function -- test suite grows with component patterns
describe("7b advanced component patterns", () => {
  it("95. forwardRef component", () => {
    const FancyButton = forwardRef<HTMLButtonElement, { label: string }>(
      function FancyButton(props, ref) {
        return createElement("button", { ref, type: "button" }, props.label);
      },
    );
    function App() {
      const { label } = useSeamData<{ label: string }>();
      return createElement(FancyButton, { label });
    }
    assertPipelineFidelity({
      component: App,
      mock: { label: "placeholder" },
      realData: { label: "forwarded" },
    });
  });

  it("96. React.memo wrapped", () => {
    const MemoChild = memo(function MemoChild({ text }: { text: string }) {
      return createElement("p", null, text);
    });
    function App() {
      const { text } = useSeamData<{ text: string }>();
      return createElement(MemoChild, { text });
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "placeholder" },
      realData: { text: "memoized" },
    });
  });

  it("97. React.lazy + Suspense — fallback renders synchronously", () => {
    const LazyChild = lazy(() => new Promise<never>(() => {}));
    function App() {
      const { text } = useSeamData<{ text: string }>();
      return createElement(
        Suspense,
        { fallback: createElement("p", null, text) },
        createElement(LazyChild, null),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "placeholder" },
      realData: { text: "Loading..." },
    });
  });

  it("98. Error Boundary (normal path)", () => {
    class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
      state = { error: false };
      static getDerivedStateFromError() {
        return { error: true };
      }
      render() {
        if (this.state.error) return createElement("div", null, "Error");
        return this.props.children;
      }
    }
    function App() {
      const { text } = useSeamData<{ text: string }>();
      return createElement(ErrorBoundary, null, createElement("p", null, text));
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "placeholder" },
      realData: { text: "no error" },
    });
  });

  it("99. multiple Context Providers (3+)", () => {
    const ThemeCtx = createContext("light");
    const LangCtx = createContext("en");
    const SizeCtx = createContext("md");

    function Inner() {
      const theme = useContext(ThemeCtx);
      const lang = useContext(LangCtx);
      const size = useContext(SizeCtx);
      const { text } = useSeamData<{ text: string }>();
      return createElement("div", null, `${theme}-${lang}-${size}: ${text}`);
    }
    function App() {
      return createElement(
        ThemeCtx.Provider,
        { value: "dark" },
        createElement(
          LangCtx.Provider,
          { value: "zh" },
          createElement(SizeCtx.Provider, { value: "lg" }, createElement(Inner)),
        ),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "placeholder" },
      realData: { text: "contextualized" },
    });
  });

  it("100. useId preserved after inject", () => {
    function App() {
      const id = useId();
      const { label } = useSeamData<{ label: string }>();
      return createElement(
        "div",
        null,
        createElement("label", { htmlFor: id }, label),
        createElement("input", { id, type: "text" }),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { label: "placeholder" },
      realData: { label: "Username" },
    });
  });
});
