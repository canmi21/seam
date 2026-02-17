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

  it("16. data-* custom attributes", () => {
    function App() {
      const { tid } = useSeamData<{ tid: string }>();
      return createElement("div", { "data-testid": tid }, "content");
    }
    assertPipelineFidelity({
      component: App,
      mock: { tid: "card-mock" },
      realData: { tid: "card-main" },
    });
  });

  it("17. aria-* accessibility attributes", () => {
    function App() {
      const { label } = useSeamData<{ label: string }>();
      return createElement("button", { "aria-label": label }, "click");
    }
    assertPipelineFidelity({
      component: App,
      mock: { label: "placeholder" },
      realData: { label: "Submit form" },
    });
  });

  it("16b. data-* with boolean false value", () => {
    function App() {
      const { active } = useSeamData<{ active: boolean }>();
      return createElement("div", { "data-active": active }, "content");
    }
    assertPipelineFidelity({
      component: App,
      mock: { active: false },
      realData: { active: false },
    });
  });

  it("17b. aria-* with boolean false value", () => {
    function App() {
      const { expanded } = useSeamData<{ expanded: boolean }>();
      return createElement("div", { "aria-expanded": expanded }, "content");
    }
    assertPipelineFidelity({
      component: App,
      mock: { expanded: false },
      realData: { expanded: false },
    });
  });

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

  it("21. dynamic boolean attr (disabled) via boolean axis", () => {
    function App() {
      const { dis } = useSeamData<{ dis: boolean }>();
      return createElement("input", { disabled: dis });
    }
    // Truthy: inject produces <input disabled="">, matches React
    assertPipelineFidelity({
      component: App,
      mock: { dis: true },
      realData: { dis: true },
      booleans: ["dis"],
    });
    // Falsy: inject produces <input>, matches React
    assertPipelineFidelity({
      component: App,
      mock: { dis: true },
      realData: { dis: false },
      booleans: ["dis"],
    });
  });

  it("22. checked/selected boolean attrs via boolean axis", () => {
    function CheckedApp() {
      const { chk } = useSeamData<{ chk: boolean }>();
      return createElement("input", { type: "checkbox", checked: chk });
    }
    assertPipelineFidelity({
      component: CheckedApp,
      mock: { chk: true },
      realData: { chk: true },
      booleans: ["chk"],
    });
    assertPipelineFidelity({
      component: CheckedApp,
      mock: { chk: true },
      realData: { chk: false },
      booleans: ["chk"],
    });

    function SelectedApp() {
      const { sel } = useSeamData<{ sel: boolean }>();
      return createElement("option", { selected: sel }, "A");
    }
    assertPipelineFidelity({
      component: SelectedApp,
      mock: { sel: true },
      realData: { sel: true },
      booleans: ["sel"],
    });
    assertPipelineFidelity({
      component: SelectedApp,
      mock: { sel: true },
      realData: { sel: false },
      booleans: ["sel"],
    });
  });

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
    "23b. tabIndex — reclassified: not a bug; tabIndex matches [\\w-]+ and trim() cleans whitespace",
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
