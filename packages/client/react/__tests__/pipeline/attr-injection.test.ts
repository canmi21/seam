/* packages/client/react/__tests__/pipeline/attr-injection.test.ts */

import { describe, it } from "vitest";
import { createElement } from "react";
import { useSeamData } from "../../src/index.js";
import { assertPipelineFidelity } from "./test-utils.js";

describe("1.2 attribute injection", () => {
  it("13. className replacement", () => {
    function App() {
      const { cls } = useSeamData<{ cls: string }>();
      return createElement("div", { className: cls }, "content");
    }
    assertPipelineFidelity({
      component: App,
      mock: { cls: "default" },
      realData: { cls: "active highlighted" },
    });
  });

  it("14. href URL attr", () => {
    function App() {
      const { url } = useSeamData<{ url: string }>();
      return createElement("a", { href: url }, "link");
    }
    assertPipelineFidelity({
      component: App,
      mock: { url: "https://example.com" },
      realData: { url: "https://seam.dev/docs" },
    });
  });

  it.todo(
    "14b. src attr on img — React 19 emits <link rel=preload> whose attr order diverges after sentinelToSlots round-trip",
  );

  it.todo("15. style object — per-property sentinels not supported by sentinelToSlots");

  it.todo(
    "16. data-* custom attributes — sentinelToSlots attrRe uses (\\w+) which cannot match hyphenated attr names like data-testid",
  );

  it.todo("17. aria-* accessibility attributes — same (\\w+) regex limitation as data-* attrs");

  it("18. id attribute", () => {
    function App() {
      const { id } = useSeamData<{ id: string }>();
      return createElement("section", { id }, "content");
    }
    assertPipelineFidelity({
      component: App,
      mock: { id: "section-mock" },
      realData: { id: "section-main" },
    });
  });

  it('19. attr value with special chars (", &, space)', () => {
    function App() {
      const { title } = useSeamData<{ title: string }>();
      return createElement("div", { title }, "content");
    }
    assertPipelineFidelity({
      component: App,
      mock: { title: "placeholder" },
      realData: { title: 'He said "hello" & <goodbye> world' },
    });
  });

  it("20. attr value empty string", () => {
    function App() {
      const { title } = useSeamData<{ title: string }>();
      return createElement("div", { title }, "content");
    }
    assertPipelineFidelity({
      component: App,
      mock: { title: "placeholder" },
      realData: { title: "" },
    });
  });

  it.todo(
    '21. dynamic boolean attr (disabled) — disabled={true} renders disabled="" in React but inject produces disabled="true"',
  );

  it.todo("22. checked/selected/readOnly/multiple — same boolean attr issue");

  it("23. numeric attr (width)", () => {
    function App() {
      const { w } = useSeamData<{ w: string }>();
      return createElement("table", { width: w }, createElement("tbody", null));
    }
    assertPipelineFidelity({
      component: App,
      mock: { w: "100" },
      realData: { w: "250" },
    });
  });

  it.todo(
    "23b. tabIndex — sentinelToSlots leaves trailing whitespace on void elements after attr removal",
  );
});

describe("1.3 dynamic props spread", () => {
  it("24. {...props} spread", () => {
    function App() {
      const data = useSeamData<{ props: { title: string } }>();
      return createElement("div", { ...data.props }, "text");
    }
    assertPipelineFidelity({
      component: App,
      mock: { props: { title: "mock-title" } },
      realData: { props: { title: "real-title" } },
    });
  });

  it("25. spread overrides explicit prop", () => {
    function App() {
      const data = useSeamData<{ overrides: { className: string } }>();
      return createElement("div", { className: "base", ...data.overrides }, "text");
    }
    assertPipelineFidelity({
      component: App,
      mock: { overrides: { className: "mock-override" } },
      realData: { overrides: { className: "final-class" } },
    });
  });
});
