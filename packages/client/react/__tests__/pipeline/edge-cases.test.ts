/* packages/client/react/__tests__/pipeline/edge-cases.test.ts */

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { useSeamData } from "../../src/index.js";
import {
  assertPipelineFidelity,
  buildTemplate,
  inject,
  renderWithProvider,
  wrapDocument,
} from "./test-utils.js";

describe("8a data handling", () => {
  it("101. missing data field renders empty", () => {
    function App() {
      const { title, subtitle } = useSeamData<{ title: string; subtitle: string }>();
      return createElement(
        "div",
        null,
        createElement("h1", null, title),
        createElement("p", null, subtitle),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { title: "t", subtitle: "s" },
      realData: { title: "Hello" } as Record<string, unknown>,
    });
  });

  it("102. extra data fields are ignored", () => {
    function App() {
      const { name } = useSeamData<{ name: string }>();
      return createElement("p", null, name);
    }
    assertPipelineFidelity({
      component: App,
      mock: { name: "placeholder" },
      realData: { name: "Alice", extraField: "unused", another: 42 } as Record<string, unknown>,
    });
  });

  it.todo("103. type mismatch — React renders [object Object], injector uses JSON.stringify");

  it("104. data containing Seam marker strings", () => {
    function App() {
      const { text } = useSeamData<{ text: string }>();
      return createElement("p", null, text);
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "placeholder" },
      realData: { text: "%%SEAM:injection%%attack<!--seam:hack-->" },
    });
  });

  it("105. very large field (1MB text)", () => {
    function App() {
      const { text } = useSeamData<{ text: string }>();
      return createElement("p", null, text);
    }
    assertPipelineFidelity({
      component: App,
      mock: { text: "placeholder" },
      realData: { text: "x".repeat(1_000_000) },
    });
  });
});

describe("8b scalability", () => {
  it("106. 1000 list items", () => {
    function App() {
      const { items } = useSeamData<{ items: { id: string; label: string }[] }>();
      return createElement(
        "ul",
        null,
        items.map((item, i) => createElement("li", { key: i }, item.id, ": ", item.label)),
      );
    }
    const realItems = Array.from({ length: 1000 }, (_, i) => ({
      id: String(i),
      label: `Item ${i}`,
    }));
    assertPipelineFidelity({
      component: App,
      mock: { items: [{ id: "0", label: "mock" }] },
      arrays: ["items"],
      realData: { items: realItems },
    });
  });

  it("107. deeply nested data object (10 levels)", () => {
    function App() {
      const data = useSeamData<{
        a: { b: { c: { d: { e: { f: { g: { h: { i: { j: string } } } } } } } } };
      }>();
      return createElement("span", null, data.a.b.c.d.e.f.g.h.i.j);
    }
    assertPipelineFidelity({
      component: App,
      mock: {
        a: { b: { c: { d: { e: { f: { g: { h: { i: { j: "deep" } } } } } } } } },
      },
      realData: {
        a: { b: { c: { d: { e: { f: { g: { h: { i: { j: "found at bottom" } } } } } } } } },
      },
    });
  });

  it("108. concurrent injection — same template, different data", () => {
    function App() {
      const { name, role } = useSeamData<{ name: string; role: string }>();
      return createElement(
        "div",
        null,
        createElement("h1", null, name),
        createElement("p", null, role),
      );
    }
    const template = buildTemplate({
      component: App,
      mock: { name: "placeholder", role: "placeholder" },
    });

    const data1 = { name: "Alice", role: "Admin" };
    const data2 = { name: "Bob", role: "User" };

    const result1 = inject(template, data1, { skipDataScript: true });
    const result2 = inject(template, data2, { skipDataScript: true });

    const expected1 = wrapDocument(renderWithProvider(App, data1), [], []);
    const expected2 = wrapDocument(renderWithProvider(App, data2), [], []);

    expect(result1).toBe(expected1);
    expect(result2).toBe(expected2);
    expect(result1).not.toBe(result2);
  });
});
