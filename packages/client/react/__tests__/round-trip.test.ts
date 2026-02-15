/* packages/client/react/__tests__/round-trip.test.ts */

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { inject } from "@canmi/seam-injector";
import { setSSRData, clearSSRData, useSeamData } from "../src/index.js";
import { buildSentinelData } from "../src/sentinel.js";

// -- Slot replacement (mirrors Rust logic) --

function sentinelToSlots(html: string): string {
  const attrRe = /(\w+)="%%SEAM:([^%]+)%%"/g;
  const textRe = /%%SEAM:([^%]+)%%/g;
  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;

  let result = "";
  let lastEnd = 0;

  for (const match of html.matchAll(tagRe)) {
    const fullMatch = match[0];
    const tagName = match[1];
    const attrsStr = match[2];
    const matchStart = match.index!;
    const matchEnd = matchStart + fullMatch.length;

    if (!attrRe.test(attrsStr)) {
      result += html.slice(lastEnd, matchEnd);
      lastEnd = matchEnd;
      attrRe.lastIndex = 0;
      continue;
    }
    attrRe.lastIndex = 0;

    result += html.slice(lastEnd, matchStart);

    const comments: string[] = [];
    let cleanedAttrs = attrsStr;
    for (const attrMatch of attrsStr.matchAll(attrRe)) {
      const attrName = attrMatch[1];
      const path = attrMatch[2];
      comments.push(`<!--seam:${path}:attr:${attrName}-->`);
    }
    cleanedAttrs = cleanedAttrs.replace(attrRe, "").trim();

    for (const c of comments) result += c;
    result += cleanedAttrs ? `<${tagName} ${cleanedAttrs}>` : `<${tagName}>`;
    lastEnd = matchEnd;
  }
  result += html.slice(lastEnd);

  return result.replace(textRe, "<!--seam:$1-->");
}

function wrapDocument(skeleton: string, css: string[], js: string[]): string {
  let doc = '<!DOCTYPE html>\n<html>\n<head>\n    <meta charset="utf-8">\n';
  for (const f of css) doc += `    <link rel="stylesheet" href="/_seam/static/${f}">\n`;
  doc += '</head>\n<body>\n    <div id="__SEAM_ROOT__">';
  doc += skeleton;
  doc += "</div>\n";
  for (const f of js) doc += `    <script type="module" src="/_seam/static/${f}"></script>\n`;
  doc += "</body>\n</html>";
  return doc;
}

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

// -- Array block helpers (mirrors Rust logic) --

function detectArrayBlock(
  fullHtml: string,
  emptiedHtml: string,
  field: string,
): { start: number; end: number; field: string } | null {
  if (fullHtml === emptiedHtml) return null;
  let prefixLen = 0;
  while (
    prefixLen < fullHtml.length &&
    prefixLen < emptiedHtml.length &&
    fullHtml[prefixLen] === emptiedHtml[prefixLen]
  ) {
    prefixLen++;
  }
  const fullRem = fullHtml.slice(prefixLen);
  const emptiedRem = emptiedHtml.slice(prefixLen);
  let suffixLen = 0;
  while (
    suffixLen < fullRem.length &&
    suffixLen < emptiedRem.length &&
    fullRem[fullRem.length - 1 - suffixLen] === emptiedRem[emptiedRem.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }
  const start = prefixLen;
  const end = fullHtml.length - suffixLen;
  if (start >= end) return null;
  return { start, end, field };
}

function applyArrayBlocks(
  html: string,
  blocks: { start: number; end: number; field: string }[],
): string {
  let result = html;
  blocks.sort((a, b) => b.start - a.start);
  for (const block of blocks) {
    let body = result.slice(block.start, block.end);
    const fieldPrefix = `<!--seam:${block.field}.`;
    body = body.replaceAll(fieldPrefix, "<!--seam:");
    const wrapped = `<!--seam:each:${block.field}-->${body}<!--seam:endeach-->`;
    result = result.slice(0, block.start) + wrapped + result.slice(block.end);
  }
  return result;
}

describe("round-trip: render -> slots -> inject", () => {
  it("produces correct HTML with real data after full pipeline", () => {
    const mock = {
      user: { id: 1, name: "Alice", email: "alice@example.com", avatar: "pic.png" },
    };

    // Step 1: Build sentinel data and render
    const sentinelData = buildSentinelData(mock);
    setSSRData(sentinelData);
    const rawHtml = renderToString(createElement(UserPage));
    clearSSRData();

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
    setSSRData(sentinelData);
    const fullHtml = sentinelToSlots(renderToString(createElement(UserPage)));
    clearSSRData();

    // Nulled render: null the field in sentinel data (not in mock)
    // so the component's conditional `user.avatar && ...` evaluates to false
    const nulledSentinel = JSON.parse(JSON.stringify(sentinelData));
    nulledSentinel.user.avatar = null;
    setSSRData(nulledSentinel);
    const nulledHtml = sentinelToSlots(renderToString(createElement(UserPage)));
    clearSSRData();

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
    setSSRData(sentinelData);
    const fullHtml = sentinelToSlots(renderToString(createElement(MessageList)));
    clearSSRData();

    // Emptied render (empty array)
    const emptiedSentinel = JSON.parse(JSON.stringify(sentinelData));
    emptiedSentinel.messages = [];
    setSSRData(emptiedSentinel);
    const emptiedHtml = sentinelToSlots(renderToString(createElement(MessageList)));
    clearSSRData();

    // Detect array block
    const block = detectArrayBlock(fullHtml, emptiedHtml, "messages");
    expect(block).not.toBeNull();

    // Apply array blocks
    const processed = applyArrayBlocks(fullHtml, [block!]);
    expect(processed).toContain("<!--seam:each:messages-->");
    expect(processed).toContain("<!--seam:endeach-->");
    expect(processed).toContain("<!--seam:$.text-->");
    expect(processed).not.toContain("messages.$.text");

    // Wrap and inject with real data
    const template = wrapDocument(processed, [], []);
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
