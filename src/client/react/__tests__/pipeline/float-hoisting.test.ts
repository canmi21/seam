/* src/client/react/__tests__/pipeline/float-hoisting.test.ts */

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { useSeamData } from "../../src/index.js";
import { assertPipelineFidelity, buildTemplate } from "./test-utils.js";

describe("3.1 Float hoisted metadata", () => {
  it("109. <title> dynamic text", () => {
    function App() {
      const { t } = useSeamData<{ t: string }>();
      return createElement(
        "div",
        null,
        createElement("title", null, t),
        createElement("p", null, "body"),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { t: "Mock Title" },
      realData: { t: "Real Title" },
    });
  });

  it("110. <title> mixed static + dynamic text", () => {
    function App() {
      const { t } = useSeamData<{ t: string }>();
      return createElement(
        "div",
        null,
        createElement("title", null, `Page: ${t}`),
        createElement("p", null, "body"),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { t: "Mock" },
      realData: { t: "Dashboard" },
    });
  });

  it("111. <meta content> dynamic attr", () => {
    function App() {
      const { desc } = useSeamData<{ desc: string }>();
      return createElement(
        "div",
        null,
        createElement("meta", { content: desc, name: "description" }),
        createElement("p", null, "body"),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { desc: "mock description" },
      realData: { desc: "A page about seam" },
    });
  });

  it("112. <link href> dynamic attr (rel=canonical)", () => {
    function App() {
      const { url } = useSeamData<{ url: string }>();
      return createElement(
        "div",
        null,
        createElement("link", { href: url, rel: "canonical" }),
        createElement("p", null, "body"),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { url: "https://example.com/mock" },
      realData: { url: "https://seam.dev/docs" },
    });
  });

  it("113. <meta> dual dynamic attrs (property + content)", () => {
    function App() {
      const data = useSeamData<{ ogProp: string; ogContent: string }>();
      return createElement(
        "div",
        null,
        createElement("meta", { property: data.ogProp, content: data.ogContent }),
        createElement("p", null, "body"),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { ogProp: "og:title", ogContent: "mock content" },
      realData: { ogProp: "og:title", ogContent: "SeamJS - Modern SSR" },
    });
  });

  it("114. <title> + <meta> + <link> coexist", () => {
    function App() {
      const data = useSeamData<{ t: string; desc: string; url: string }>();
      return createElement(
        "div",
        null,
        createElement("title", null, data.t),
        createElement("meta", { content: data.desc, name: "description" }),
        createElement("link", { href: data.url, rel: "canonical" }),
        createElement("p", null, "content"),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { t: "Mock", desc: "mock desc", url: "https://example.com" },
      realData: { t: "Real", desc: "real desc", url: "https://seam.dev" },
    });
  });
});

describe("3.1b Float hoisted metadata (advanced)", () => {
  it("115. metadata interleaved with normal content", () => {
    function App() {
      const data = useSeamData<{ t: string; name: string; bio: string }>();
      return createElement(
        "div",
        null,
        createElement("title", null, data.t),
        createElement("h1", null, data.name),
        createElement("meta", { content: data.name, name: "author" }),
        createElement("p", null, data.bio),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { t: "Profile", name: "Alice", bio: "Developer" },
      realData: { t: "User Profile", name: "Bob", bio: "Designer" },
    });
  });

  it("116. <title> under boolean axis control", () => {
    function App() {
      const { show, t, body } = useSeamData<{ show: boolean; t: string; body: string }>();
      return createElement(
        "div",
        null,
        show && createElement("title", null, t),
        createElement("p", null, body),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { show: true, t: "Has Title", body: "content" },
      booleans: ["show"],
      realData: { show: true, t: "Visible Title", body: "real content" },
    });
    assertPipelineFidelity({
      component: App,
      mock: { show: true, t: "Has Title", body: "content" },
      booleans: ["show"],
      realData: { show: false, t: "Hidden", body: "no title" },
    });
  });

  it("117. <meta> in array loop (content-only dynamic attr)", () => {
    function App() {
      const { metas } = useSeamData<{ metas: { content: string }[] }>();
      return createElement(
        "div",
        null,
        metas.map((m, i) =>
          createElement("meta", { key: i, content: m.content, name: "description" }),
        ),
        createElement("p", null, "body"),
      );
    }
    assertPipelineFidelity({
      component: App,
      mock: { metas: [{ content: "mock" }] },
      arrays: ["metas"],
      realData: { metas: [{ content: "News" }, { content: "Blog" }] },
    });
  });

  it("118. <head> separation structural assertion", () => {
    function App() {
      const data = useSeamData<{ t: string; desc: string }>();
      return createElement(
        "div",
        null,
        createElement("title", null, data.t),
        createElement("meta", { name: "description", content: data.desc }),
        createElement("p", null, "content"),
      );
    }
    const template = buildTemplate({
      component: App,
      mock: { t: "Test", desc: "test desc" },
    });

    const headSection = template.split("</head>")[0];
    expect(headSection).toContain("<!--seam:");
    expect(headSection).toContain("<meta charset");

    const rootMatch = template.match(/__seam">([\s\S]*?)<\/div>\n<\/body>/);
    expect(rootMatch).not.toBeNull();
    const rootContent = rootMatch![1];
    // Metadata extracted to <head>, only body content remains in root
    expect(rootContent).toContain("content");
    expect(rootContent).not.toContain("<title>");
  });
});
