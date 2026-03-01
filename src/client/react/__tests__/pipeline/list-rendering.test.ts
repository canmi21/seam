/* src/client/react/__tests__/pipeline/list-rendering.test.ts */

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { useSeamData } from "../../src/index.js";
import { assertPipelineFidelity, renderWithProvider } from "./test-utils.js";

describe("3.1a simple lists", () => {
  it("41. empty array yields no output", () => {
    function App() {
      const { items } = useSeamData<{ items: { name: string }[] }>();
      return createElement(
        "ul",
        null,
        items.map((item, i) => createElement("li", { key: i }, item.name)),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { items: [{ name: "mock" }] },
      arrays: ["items"],
      realData: { items: [] },
    });
  });

  it("42. single item array", () => {
    function App() {
      const { items } = useSeamData<{ items: { name: string }[] }>();
      return createElement(
        "ul",
        null,
        items.map((item, i) => createElement("li", { key: i }, item.name)),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { items: [{ name: "mock" }] },
      arrays: ["items"],
      realData: { items: [{ name: "Alice" }] },
    });
  });

  it("43. multi-item array (5 items)", () => {
    function App() {
      const { items } = useSeamData<{ items: { name: string }[] }>();
      return createElement(
        "ul",
        null,
        items.map((item, i) => createElement("li", { key: i }, item.name)),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { items: [{ name: "mock" }] },
      arrays: ["items"],
      realData: {
        items: [
          { name: "Alice" },
          { name: "Bob" },
          { name: "Carol" },
          { name: "Dave" },
          { name: "Eve" },
        ],
      },
    });
  });

  it("44. list items are simple text", () => {
    function App() {
      const { tags } = useSeamData<{ tags: { label: string }[] }>();
      return createElement(
        "ul",
        null,
        tags.map((tag, i) => createElement("li", { key: i }, tag.label)),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { tags: [{ label: "mock" }] },
      arrays: ["tags"],
      realData: {
        tags: [{ label: "react" }, { label: "seam" }, { label: "ssr" }],
      },
    });
  });
});

describe("3.1b complex items", () => {
  it("45. list items are complex components", () => {
    function App() {
      const { users } = useSeamData<{ users: { name: string; bio: string }[] }>();
      return createElement(
        "div",
        null,
        users.map((user, i) =>
          createElement(
            "div",
            { key: i },
            createElement("span", null, user.name),
            createElement("p", null, user.bio),
          ),
        ),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { users: [{ name: "mock", bio: "mock bio" }] },
      arrays: ["users"],
      realData: {
        users: [
          { name: "Alice", bio: "Engineer at Seam" },
          { name: "Bob", bio: "Designer at Acme" },
        ],
      },
    });
  });

  it("46. list items with multiple dynamic fields", () => {
    function App() {
      const { members } = useSeamData<{
        members: { name: string; email: string; role: string }[];
      }>();
      return createElement(
        "ul",
        null,
        members.map((m, i) =>
          createElement(
            "li",
            { key: i },
            createElement("span", null, m.name),
            createElement("span", null, m.email),
            createElement("span", null, m.role),
          ),
        ),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: {
        members: [{ name: "mock", email: "mock@test.com", role: "mock" }],
      },
      arrays: ["members"],
      realData: {
        members: [
          { name: "Alice", email: "alice@seam.dev", role: "admin" },
          { name: "Bob", email: "bob@seam.dev", role: "editor" },
          { name: "Carol", email: "carol@seam.dev", role: "viewer" },
        ],
      },
    });
  });
});

describe("3.2a boolean-gated lists", () => {
  it("47. top-level boolean wrapping a list", () => {
    function App() {
      const { show, items } = useSeamData<{ show: boolean; items: { name: string }[] }>();
      return createElement(
        "div",
        null,
        show &&
          createElement(
            "ul",
            null,
            items.map((item, i) => createElement("li", { key: i }, item.name)),
          ),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { show: true, items: [{ name: "mock" }] },
      booleans: ["show"],
      arrays: ["items"],
      realData: { show: true, items: [{ name: "Alice" }, { name: "Bob" }] },
    });
  });

  it("49. conditional wrapping a list", () => {
    function App() {
      const { visible, items } = useSeamData<{ visible: boolean; items: { name: string }[] }>();
      return createElement(
        "section",
        null,
        visible &&
          createElement(
            "ul",
            null,
            items.map((item, i) => createElement("li", { key: i }, item.name)),
          ),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { visible: true, items: [{ name: "mock" }] },
      booleans: ["visible"],
      arrays: ["items"],
      realData: {
        visible: true,
        items: [{ name: "X" }, { name: "Y" }, { name: "Z" }],
      },
    });
  });
});

describe("3.2b deeply nested lists", () => {
  it("48. nested list (2D array)", () => {
    function App() {
      const { groups } = useSeamData<{
        groups: { title: string; items: { name: string }[] }[];
      }>();
      return createElement(
        "div",
        null,
        groups.map((group, gi) =>
          createElement(
            "section",
            { key: gi },
            createElement("h2", null, group.title),
            createElement(
              "ul",
              null,
              group.items.map((item, ii) => createElement("li", { key: ii }, item.name)),
            ),
          ),
        ),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { groups: [{ title: "A", items: [{ name: "x" }] }] },
      arrays: ["groups", "groups.$.items"],
      realData: {
        groups: [
          { title: "Group 1", items: [{ name: "Alice" }, { name: "Bob" }] },
          { title: "Group 2", items: [{ name: "Carol" }] },
        ],
      },
    });
    assertPipelineFidelity({
      component: App,
      mock: { groups: [{ title: "A", items: [{ name: "x" }] }] },
      arrays: ["groups", "groups.$.items"],
      realData: { groups: [] },
    });
  });

  it("50. list + condition + list", () => {
    function App() {
      const { posts } = useSeamData<{
        posts: { title: string; visible: boolean; tags: { label: string }[] }[];
      }>();
      return createElement(
        "div",
        null,
        posts.map((post, pi) =>
          createElement(
            "article",
            { key: pi },
            createElement("h3", null, post.title),
            post.visible &&
              createElement(
                "ul",
                null,
                post.tags.map((tag, ti) => createElement("li", { key: ti }, tag.label)),
              ),
          ),
        ),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { posts: [{ title: "P", visible: true, tags: [{ label: "t" }] }] },
      arrays: ["posts", "posts.$.tags"],
      booleans: ["posts.$.visible"],
      realData: {
        posts: [
          { title: "First", visible: true, tags: [{ label: "react" }, { label: "seam" }] },
          { title: "Second", visible: false, tags: [] },
        ],
      },
    });
  });
});

describe("3.3 key handling", () => {
  it("51. key not in HTML output", () => {
    function App() {
      const { items } = useSeamData<{ items: { name: string }[] }>();
      return createElement(
        "ul",
        null,
        items.map((item, i) => createElement("li", { key: i }, item.name)),
      );
    }
    const html = renderWithProvider(App, {
      items: [{ name: "Alice" }, { name: "Bob" }],
    });
    expect(html).not.toContain("key=");
  });

  it("52. index key vs id key produce same HTML", () => {
    function IndexKeyApp() {
      const { items } = useSeamData<{ items: { id: string; name: string }[] }>();
      return createElement(
        "ul",
        null,
        items.map((item, i) => createElement("li", { key: i }, item.name)),
      );
    }
    function IdKeyApp() {
      const { items } = useSeamData<{ items: { id: string; name: string }[] }>();
      return createElement(
        "ul",
        null,
        items.map((item) => createElement("li", { key: item.id }, item.name)),
      );
    }
    const data = {
      items: [
        { id: "a1", name: "Alice" },
        { id: "b2", name: "Bob" },
      ],
    };
    const indexHtml = renderWithProvider(IndexKeyApp, data);
    const idHtml = renderWithProvider(IdKeyApp, data);
    expect(indexHtml).toBe(idHtml);
  });
});
