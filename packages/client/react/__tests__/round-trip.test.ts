/* packages/client/react/__tests__/round-trip.test.ts */

import { describe, it, expect } from "vitest";
import {
  createElement,
  useId,
  Suspense,
  StrictMode,
  useState,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { renderToString } from "react-dom/server";
import { SeamDataProvider, useSeamData } from "../src/index.js";
import {
  inject,
  buildSentinelData,
  sentinelToSlots,
  wrapDocument,
  renderWithProvider,
} from "./pipeline/test-utils.js";
import { extractTemplate } from "./pipeline/extract/index.js";
import type { Axis } from "./pipeline/extract/index.js";

// -- Test component --

function UserPage() {
  const { user } = useSeamData<{
    user: { id: number; name: string; email: string; avatar: string | null };
  }>();
  return createElement(
    "div",
    null,
    createElement("h1", null, user.name),
    createElement("p", null, user.email),
    user.avatar ? createElement("img", { src: user.avatar }) : null,
  );
}

describe("round-trip: render -> slots -> inject", () => {
  it("produces correct HTML with real data after full pipeline", () => {
    const mock = {
      user: { id: 1, name: "Alice", email: "alice@example.com", avatar: "pic.png" },
    };

    // Step 1: Build sentinel data and render
    const sentinelData = buildSentinelData(mock);
    const rawHtml = renderWithProvider(UserPage, sentinelData);

    // Step 2: Convert sentinels to slots
    const slotHtml = sentinelToSlots(rawHtml);
    expect(slotHtml).toContain("<!--seam:user.name-->");
    expect(slotHtml).toContain("<!--seam:user.email-->");
    expect(slotHtml).not.toContain("%%SEAM:");

    // Step 3: Wrap in document
    const template = wrapDocument(slotHtml, ["style.css"], ["main.js"]);
    expect(template).toContain("<!DOCTYPE html>");
    expect(template).toContain("__SEAM_ROOT__");

    // Step 4: Inject real data
    const realData = {
      user: { id: 1, name: "Alice", email: "alice@example.com", avatar: "pic.png" },
    };
    const finalHtml = inject(template, realData);

    expect(finalHtml).toContain("Alice");
    expect(finalHtml).toContain("alice@example.com");
    expect(finalHtml).toContain('src="pic.png"');
    expect(finalHtml).toContain("__SEAM_DATA__");
  });

  it("handles nullable fields via conditional wrapping", () => {
    const mock = {
      user: { id: 1, name: "Alice", email: "a@b.com", avatar: "pic.png" },
    };

    // Full render
    const sentinelData = buildSentinelData(mock);
    const fullHtml = sentinelToSlots(renderWithProvider(UserPage, sentinelData));

    // Nulled render: null the field in sentinel data (not in mock)
    // so the component's conditional `user.avatar && ...` evaluates to false
    const nulledSentinel = JSON.parse(JSON.stringify(sentinelData));
    nulledSentinel.user.avatar = null;
    const nulledHtml = sentinelToSlots(renderWithProvider(UserPage, nulledSentinel));

    // The nulled version should lack the img element
    expect(fullHtml).toContain("img");
    expect(nulledHtml).not.toContain("img");

    // Wrap and inject with avatar present
    const template = wrapDocument(fullHtml, [], []);
    const withAvatar = inject(template, {
      user: { id: 1, name: "Bob", email: "bob@b.com", avatar: "bob.png" },
    });
    expect(withAvatar).toContain("Bob");
    expect(withAvatar).toContain('src="bob.png"');
  });

  it("handles array fields via each wrapping", () => {
    // Component that renders a list
    function MessageList() {
      const { messages } = useSeamData<{
        messages: { id: string; text: string }[];
      }>();
      return createElement(
        "ul",
        null,
        messages.map((m) => createElement("li", { key: m.id }, m.text)),
      );
    }

    const mock = {
      messages: [{ id: "1", text: "hello" }],
    };

    // Full render (1-element sentinel array)
    const sentinelData = buildSentinelData(mock);
    expect(sentinelData.messages).toHaveLength(1);
    const fullHtml = sentinelToSlots(renderWithProvider(MessageList, sentinelData));

    // Emptied render (empty array)
    const emptiedSentinel = JSON.parse(JSON.stringify(sentinelData));
    emptiedSentinel.messages = [];
    const emptiedHtml = sentinelToSlots(renderWithProvider(MessageList, emptiedSentinel));

    // Extract template via DOM tree diffing
    const axes: Axis[] = [{ path: "messages", kind: "array", values: ["populated", "empty"] }];
    const skeleton = extractTemplate(axes, [fullHtml, emptiedHtml]);
    expect(skeleton).toContain("<!--seam:each:messages-->");
    expect(skeleton).toContain("<!--seam:endeach-->");
    expect(skeleton).toContain("<!--seam:$.text-->");
    expect(skeleton).not.toContain("messages.$.text");

    // Wrap and inject with real data
    const template = wrapDocument(skeleton, [], []);
    const realData = {
      messages: [
        { id: "1", text: "hello" },
        { id: "2", text: "world" },
      ],
    };
    const finalHtml = inject(template, realData);
    expect(finalHtml).toContain("hello");
    expect(finalHtml).toContain("world");
    expect(finalHtml).toContain("__SEAM_DATA__");
  });
});

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

    // wrapDocument adds its own <head>; hoisted metadata stays inside __SEAM_ROOT__
    const template = wrapDocument(slotHtml, ["style.css"], []);
    const headSection = template.split("</head>")[0];
    expect(headSection).toContain("style.css");
    expect(headSection).not.toContain("<!--seam:pageTitle-->");

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
