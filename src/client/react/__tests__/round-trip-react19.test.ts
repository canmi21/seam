/* src/client/react/__tests__/round-trip-react19.test.ts */

import { describe, it, expect } from "vitest";
import {
  createElement,
  useId,
  use,
  Suspense,
  StrictMode,
  useState,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { renderToString } from "react-dom/server";
import { preload, preinit, prefetchDNS, preconnect } from "react-dom";
import { SeamDataProvider, useSeamData } from "../src/index.js";
import {
  inject,
  buildSentinelData,
  sentinelToSlots,
  wrapDocument,
  renderWithProvider,
} from "./pipeline/test-utils.js";

describe("react 19: useId", () => {
  it("useId values survive the full CTR pipeline", () => {
    function IdForm() {
      const id = useId();
      const { label } = useSeamData<{ label: string }>();
      return createElement(
        "div",
        null,
        createElement("label", { htmlFor: id }, label),
        createElement("input", { id, type: "text" }),
      );
    }

    const mock = { label: "Name" };
    const sentinelData = buildSentinelData(mock);
    const rawHtml = renderWithProvider(IdForm, sentinelData);

    // useId generates deterministic IDs in renderToString
    const idMatch = rawHtml.match(/id="([^"]+)"/);
    const forMatch = rawHtml.match(/for="([^"]+)"/);
    expect(idMatch).not.toBeNull();
    expect(forMatch).not.toBeNull();
    expect(idMatch![1]).toBe(forMatch![1]);
    expect(idMatch![1]).not.toContain("SEAM");

    // Sentinel conversion preserves useId attributes
    const slotHtml = sentinelToSlots(rawHtml);
    expect(slotHtml).toContain("<!--seam:label-->");
    expect(slotHtml).toContain(`id="${idMatch![1]}"`);
    expect(slotHtml).toContain(`for="${idMatch![1]}"`);

    // Full pipeline: wrap + inject
    const template = wrapDocument(slotHtml, [], []);
    const finalHtml = inject(template, { label: "Email" });
    expect(finalHtml).toContain("Email");
    expect(finalHtml).toContain(`id="${idMatch![1]}"`);
    expect(finalHtml).toContain(`for="${idMatch![1]}"`);
  });

  it("useId: StrictMode wrapper does not affect generated IDs", () => {
    function IdField() {
      const id = useId();
      return createElement("span", null, id);
    }

    // Build-time structure: SeamDataProvider -> Component
    const buildHtml = renderToString(
      createElement(SeamDataProvider, { value: {} }, createElement(IdField)),
    );

    // Hydration-time structure: StrictMode -> SeamDataProvider -> Component
    const hydrateHtml = renderToString(
      createElement(
        StrictMode,
        null,
        createElement(SeamDataProvider, { value: {} }, createElement(IdField)),
      ),
    );

    // StrictMode is transparent to useId generation
    expect(buildHtml).toBe(hydrateHtml);
  });
});

describe("react 19: markers and metadata", () => {
  it("Suspense comment markers preserved through pipeline", () => {
    function SuspenseWrapper() {
      const { title } = useSeamData<{ title: string }>();
      return createElement(
        Suspense,
        { fallback: createElement("span", null, "Loading") },
        createElement("div", null, title),
      );
    }

    const mock = { title: "Hello" };
    const sentinelData = buildSentinelData(mock);
    const rawHtml = renderWithProvider(SuspenseWrapper, sentinelData);

    // renderToString wraps resolved Suspense content in <!--$-->...<!--/$-->
    expect(rawHtml).toContain("<!--$-->");
    expect(rawHtml).toContain("<!--/$-->");

    // Sentinel conversion preserves React markers
    const slotHtml = sentinelToSlots(rawHtml);
    expect(slotHtml).toContain("<!--$-->");
    expect(slotHtml).toContain("<!--/$-->");
    expect(slotHtml).toContain("<!--seam:title-->");

    // Full pipeline
    const template = wrapDocument(slotHtml, [], []);
    const finalHtml = inject(template, { title: "World" });
    expect(finalHtml).toContain("<!--$-->");
    expect(finalHtml).toContain("<!--/$-->");
    expect(finalHtml).toContain("World");
  });

  it("ref as prop (no forwardRef) produces no ref attribute", () => {
    // React 19: ref is accepted as a regular prop, no forwardRef wrapper
    function TextInput() {
      const { placeholder } = useSeamData<{ placeholder: string }>();
      return createElement("input", { type: "text", placeholder });
    }

    const mock = { placeholder: "Enter text" };
    const sentinelData = buildSentinelData(mock);
    const rawHtml = renderWithProvider(TextInput, sentinelData);

    // renderToString never includes ref in HTML output
    expect(rawHtml).not.toContain("ref=");
    expect(rawHtml).toContain("%%SEAM:placeholder%%");

    // Full pipeline
    const slotHtml = sentinelToSlots(rawHtml);
    const template = wrapDocument(slotHtml, [], []);
    const finalHtml = inject(template, { placeholder: "Type here" });
    expect(finalHtml).toContain("Type here");
    expect(finalHtml).not.toContain("ref=");
  });

  it("inline document metadata does not conflict with wrapDocument", () => {
    function MetadataPage() {
      const { pageTitle } = useSeamData<{ pageTitle: string }>();
      return createElement(
        "div",
        null,
        createElement("title", null, pageTitle),
        createElement("meta", { name: "description", content: "A test page" }),
        createElement("p", null, "Content"),
      );
    }

    const mock = { pageTitle: "Home" };
    const sentinelData = buildSentinelData(mock);
    const rawHtml = renderWithProvider(MetadataPage, sentinelData);

    // React 19 renderToString hoists <title>/<meta> to the root of its
    // output (not into <head> -- that only happens in CSR). The tags still
    // exist in the HTML string and sentinels inside them convert normally.
    expect(rawHtml).toContain("<title>");
    expect(rawHtml).toContain("<meta");

    const slotHtml = sentinelToSlots(rawHtml);
    expect(slotHtml).toContain("<!--seam:pageTitle-->");

    // wrapDocument extracts metadata to <head>; body content stays inside __seam root div
    const template = wrapDocument(slotHtml, ["style.css"], []);
    const headSection = template.split("</head>")[0];
    expect(headSection).toContain("style.css");
    expect(headSection).toContain("<!--seam:pageTitle-->");

    // Inject real data
    const finalHtml = inject(template, { pageTitle: "My Page" });
    expect(finalHtml).toContain("My Page");
  });
});

describe("react 19: ref and hooks", () => {
  it("common hooks (useState, useRef, useMemo, useCallback) render valid HTML", () => {
    function HooksComponent() {
      const data = useSeamData<{ label: string; count: number }>();
      const [state] = useState("initial");
      const ref = useRef<HTMLDivElement>(null);
      const display = useMemo(() => `${data.label}`, [data.label]);
      const handler = useCallback(() => {}, []);

      return createElement(
        "div",
        { ref, onClick: handler },
        createElement("span", { className: "label" }, display),
        createElement("span", { className: "count" }, String(data.count)),
        createElement("span", { className: "state" }, state),
      );
    }

    const mock = { label: "Items", count: 42 };
    const sentinelData = buildSentinelData(mock);
    const rawHtml = renderWithProvider(HooksComponent, sentinelData);

    // Hooks produce valid HTML containing sentinels
    expect(rawHtml).toContain("%%SEAM:label%%");
    expect(rawHtml).toContain("%%SEAM:count%%");
    expect(rawHtml).toContain("initial");

    // Full pipeline
    const slotHtml = sentinelToSlots(rawHtml);
    expect(slotHtml).toContain("<!--seam:label-->");
    expect(slotHtml).toContain("<!--seam:count-->");
    expect(slotHtml).not.toContain("%%SEAM:");

    const template = wrapDocument(slotHtml, [], []);
    const finalHtml = inject(template, { label: "Products", count: 7 });
    expect(finalHtml).toContain("Products");
    expect(finalHtml).toContain("7");
    expect(finalHtml).toContain("initial");
  });
});

// ---------------------------------------------------------------------------
// P0: preload()/preinit() resource hints injection during renderToString
// ---------------------------------------------------------------------------
// React 19 Resource Hints API injects <link> tags into renderToString output.
// These extra nodes are NOT driven by sentinel data, so they create noise in
// the Rust variant diff and corrupt extracted templates.
//
// Verified on React 19.2.4: all four APIs inject tags BEFORE the component's
// own HTML. Example output:
//   <link rel="preload" href="/fonts/inter.woff2" as="font" .../><h1>%%SEAM:title%%</h1>

describe("P0: resource hints injection in renderToString", () => {
  it('preload() prepends <link rel="preload"> before component output', () => {
    function PreloadComponent() {
      const { title } = useSeamData<{ title: string }>();
      preload("/fonts/inter.woff2", { as: "font", type: "font/woff2" });
      return createElement("h1", null, title);
    }

    const mock = { title: "Hello" };
    const sentinelData = buildSentinelData(mock);
    const rawHtml = renderWithProvider(PreloadComponent, sentinelData);

    // React injects the link tag at the start of the output
    expect(rawHtml).toContain('<link rel="preload"');
    expect(rawHtml).toContain('href="/fonts/inter.woff2"');
    // Sentinel data still present after the injected tag
    expect(rawHtml).toContain("%%SEAM:title%%");
    // The link tag appears BEFORE the component content
    const linkIdx = rawHtml.indexOf("<link");
    const h1Idx = rawHtml.indexOf("<h1>");
    expect(linkIdx).toBeLessThan(h1Idx);
  });

  it('preinit() prepends <link rel="stylesheet"> before component output', () => {
    function PreinitComponent() {
      const { title } = useSeamData<{ title: string }>();
      preinit("/styles/main.css", { as: "style" });
      return createElement("h1", null, title);
    }

    const mock = { title: "Hello" };
    const sentinelData = buildSentinelData(mock);
    const rawHtml = renderWithProvider(PreinitComponent, sentinelData);

    expect(rawHtml).toContain('<link rel="stylesheet"');
    expect(rawHtml).toContain('href="/styles/main.css"');
    expect(rawHtml).toContain("%%SEAM:title%%");
  });

  it("prefetchDNS() and preconnect() prepend <link> tags before component output", () => {
    function DnsComponent() {
      const { title } = useSeamData<{ title: string }>();
      prefetchDNS("https://cdn.example.com");
      preconnect("https://api.example.com");
      return createElement("h1", null, title);
    }

    const mock = { title: "Hello" };
    const sentinelData = buildSentinelData(mock);
    const rawHtml = renderWithProvider(DnsComponent, sentinelData);

    expect(rawHtml).toContain('rel="dns-prefetch"');
    expect(rawHtml).toContain('rel="preconnect"');
    expect(rawHtml).toContain("%%SEAM:title%%");
  });

  it("variant diff is stable when resource hints are absent", () => {
    function StableComponent() {
      const { title } = useSeamData<{ title: string }>();
      return createElement("h1", null, title);
    }

    const mock = { title: "Hello" };
    const sentinelData = buildSentinelData(mock);
    const html1 = renderWithProvider(StableComponent, sentinelData);
    const html2 = renderWithProvider(StableComponent, sentinelData);
    expect(html1).toBe(html2);
    // No injected link tags when resource hints APIs are not called
    expect(html1).not.toContain("<link ");
  });
});

// ---------------------------------------------------------------------------
// P1: use() hook behavior during build-time renderToString
// ---------------------------------------------------------------------------
// Three distinct scenarios with different risk profiles:
//   1. use(unresolvedPromise) WITHOUT Suspense: throws (safe -- detectable)
//   2. use(unresolvedPromise) WITH Suspense: renders fallback (dangerous -- silent)
//   3. use(resolvedThenable): works correctly (safe)

describe("P1: use() hook in build-time renderToString", () => {
  it("use() with unresolved Promise throws without Suspense boundary", () => {
    function UsePromiseComponent() {
      const { title } = useSeamData<{ title: string }>();
      const _data = use(new Promise<string>(() => {})); // never resolves
      return createElement("h1", null, title, _data);
    }

    const mock = { title: "Hello" };
    const sentinelData = buildSentinelData(mock);

    // Safe: renderToString throws, build-skeletons.mjs will propagate the error
    expect(() => renderWithProvider(UsePromiseComponent, sentinelData)).toThrow();
  });

  it("use() with Suspense boundary silently bakes fallback into template", () => {
    function UseInSuspenseComponent() {
      const _data = use(new Promise<string>(() => {}));
      return createElement("span", null, _data);
    }

    function PageWithSuspense() {
      const { title } = useSeamData<{ title: string }>();
      return createElement(
        "div",
        null,
        createElement("h1", null, title),
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading...") },
          createElement(UseInSuspenseComponent),
        ),
      );
    }

    const mock = { title: "Hello" };
    const sentinelData = buildSentinelData(mock);

    // Dangerous: renderToString does NOT throw -- it renders the fallback
    const result = renderWithProvider(PageWithSuspense, sentinelData);

    // The sentinel data for the non-suspended part is present
    expect(result).toContain("%%SEAM:title%%");
    // The Suspense fallback is baked in as static content
    expect(result).toContain("Loading...");
    // React emits a client-rendering-abort template marker
    expect(result).toContain("<!--$!-->");
  });

  it("use() with already-resolved thenable works correctly", () => {
    function UseResolvedComponent() {
      const { title } = useSeamData<{ title: string }>();
      const resolvedThenable = {
        status: "fulfilled",
        value: "extra-data",
        // oxlint-disable-next-line unicorn/no-thenable -- testing React's thenable protocol
        then(resolve: (v: string) => void) {
          resolve("extra-data");
        },
      };
      const _data = use(resolvedThenable as unknown as Promise<string>);
      return createElement("h1", null, title, " ", _data);
    }

    const mock = { title: "Hello" };
    const sentinelData = buildSentinelData(mock);
    const result = renderWithProvider(UseResolvedComponent, sentinelData);

    // Both sentinel and resolved data present
    expect(result).toContain("%%SEAM:title%%");
    expect(result).toContain("extra-data");
  });
});
