/* packages/client/react/__tests__/round-trip.test.ts */

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { useSeamData } from "../src/index.js";
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
    expect(template).toContain("__seam");

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
