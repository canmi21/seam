/* packages/client/react/__tests__/pipeline/test-utils.ts */

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect } from "vitest";
import { inject } from "@canmi/seam-injector";
import { SeamDataProvider } from "../../src/index.js";
import { buildSentinelData } from "../../src/sentinel.js";

export { inject, buildSentinelData };

// -- Slot replacement (mirrors Rust sentinel_to_slots) --

export function sentinelToSlots(html: string): string {
  const attrRe = /([\w-]+)="%%SEAM:([^%]+)%%"/g;
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

// -- Document wrapper --

export function wrapDocument(skeleton: string, css: string[], js: string[]): string {
  let doc = '<!DOCTYPE html>\n<html>\n<head>\n    <meta charset="utf-8">\n';
  for (const f of css) doc += `    <link rel="stylesheet" href="/_seam/static/${f}">\n`;
  doc += '</head>\n<body>\n    <div id="__SEAM_ROOT__">';
  doc += skeleton;
  doc += "</div>\n";
  for (const f of js) doc += `    <script type="module" src="/_seam/static/${f}"></script>\n`;
  doc += "</body>\n</html>";
  return doc;
}

// -- Render helper --

export function renderWithProvider(component: React.FC, data: unknown): string {
  return renderToString(createElement(SeamDataProvider, { value: data }, createElement(component)));
}

// -- Array block detection (mirrors Rust logic) --

export function detectArrayBlock(
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

export function applyArrayBlocks(
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

// -- Boolean block detection --

export interface BooleanBlock {
  start: number;
  end: number;
  field: string;
  thenContent: string;
  elseContent: string;
}

export function detectBooleanBlock(
  truthyHtml: string,
  falsyHtml: string,
  field: string,
): BooleanBlock | null {
  if (truthyHtml === falsyHtml) return null;

  let prefixLen = 0;
  while (
    prefixLen < truthyHtml.length &&
    prefixLen < falsyHtml.length &&
    truthyHtml[prefixLen] === falsyHtml[prefixLen]
  ) {
    prefixLen++;
  }

  const truthyRem = truthyHtml.slice(prefixLen);
  const falsyRem = falsyHtml.slice(prefixLen);
  let suffixLen = 0;
  while (
    suffixLen < truthyRem.length &&
    suffixLen < falsyRem.length &&
    truthyRem[truthyRem.length - 1 - suffixLen] === falsyRem[falsyRem.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const start = prefixLen;
  const truthyEnd = truthyHtml.length - suffixLen;
  const falsyEnd = falsyHtml.length - suffixLen;

  const thenContent = truthyHtml.slice(start, truthyEnd);
  const elseContent = falsyHtml.slice(start, falsyEnd);

  // Both empty means no real difference (edge case)
  if (!thenContent && !elseContent) return null;

  return { start, end: truthyEnd, field, thenContent, elseContent };
}

export function applyBooleanBlocks(html: string, blocks: BooleanBlock[]): string {
  let result = html;
  blocks.sort((a, b) => b.start - a.start);
  for (const block of blocks) {
    const wrapped = block.elseContent
      ? `<!--seam:if:${block.field}-->${block.thenContent}<!--seam:else-->${block.elseContent}<!--seam:endif:${block.field}-->`
      : `<!--seam:if:${block.field}-->${block.thenContent}<!--seam:endif:${block.field}-->`;
    result = result.slice(0, block.start) + wrapped + result.slice(block.end);
  }
  return result;
}

// -- Enum block detection --

export interface EnumBlock {
  start: number;
  end: number;
  field: string;
  variants: Map<string, string>;
}

export function detectEnumBlock(
  variantHtmls: Map<string, string>,
  field: string,
): EnumBlock | null {
  const entries = [...variantHtmls.entries()];
  if (entries.length < 2) return null;

  const htmls = entries.map(([, html]) => html);

  // Common prefix across all variants
  let prefixLen = 0;
  const minLen = Math.min(...htmls.map((h) => h.length));
  outer_prefix: while (prefixLen < minLen) {
    const ch = htmls[0][prefixLen];
    for (let i = 1; i < htmls.length; i++) {
      if (htmls[i][prefixLen] !== ch) break outer_prefix;
    }
    prefixLen++;
  }

  // Common suffix across all variants
  let suffixLen = 0;
  outer_suffix: while (suffixLen < minLen - prefixLen) {
    const ch = htmls[0][htmls[0].length - 1 - suffixLen];
    for (let i = 1; i < htmls.length; i++) {
      if (htmls[i][htmls[i].length - 1 - suffixLen] !== ch) break outer_suffix;
    }
    suffixLen++;
  }

  const variants = new Map<string, string>();
  for (const [value, html] of entries) {
    variants.set(value, html.slice(prefixLen, html.length - suffixLen));
  }

  // All variants identical means no real enum branching
  const contents = [...variants.values()];
  if (contents.every((c) => c === contents[0])) return null;

  const end = htmls[0].length - suffixLen;
  return { start: prefixLen, end, field, variants };
}

export function applyEnumBlocks(html: string, blocks: EnumBlock[]): string {
  let result = html;
  blocks.sort((a, b) => b.start - a.start);
  for (const block of blocks) {
    let inner = "";
    for (const [value, content] of block.variants) {
      inner += `<!--seam:when:${value}-->${content}`;
    }
    const wrapped = `<!--seam:match:${block.field}-->${inner}<!--seam:endmatch-->`;
    result = result.slice(0, block.start) + wrapped + result.slice(block.end);
  }
  return result;
}

// -- High-level orchestrators --

export interface TemplateConfig {
  component: React.FC;
  mock: Record<string, unknown>;
  arrays?: string[];
  booleans?: string[];
  enums?: { field: string; values: string[] }[];
}

/**
 * Build a template from a React component + mock data by running the
 * full JS-side CTR pipeline: sentinel -> render -> slot conversion ->
 * structural extraction -> document wrapping.
 */
export function buildTemplate(config: TemplateConfig): string {
  const sentinelData = buildSentinelData(config.mock);
  const rawHtml = renderWithProvider(config.component, sentinelData);
  let processed = sentinelToSlots(rawHtml);

  // Array extraction
  if (config.arrays) {
    const arrayBlocks: ReturnType<typeof detectArrayBlock>[] = [];
    for (const field of config.arrays) {
      const emptiedSentinel = JSON.parse(JSON.stringify(sentinelData));
      setNestedValue(emptiedSentinel, field, []);
      const emptiedHtml = sentinelToSlots(renderWithProvider(config.component, emptiedSentinel));
      const block = detectArrayBlock(processed, emptiedHtml, field);
      if (block) arrayBlocks.push(block);
    }
    processed = applyArrayBlocks(
      processed,
      arrayBlocks.filter((b): b is NonNullable<typeof b> => b !== null),
    );
  }

  // Boolean extraction
  if (config.booleans) {
    const boolBlocks: BooleanBlock[] = [];
    for (const field of config.booleans) {
      // Truthy render uses the existing sentinel (string sentinels are truthy)
      const truthyHtml = processed;

      // Falsy render: set the field to null
      const falsySentinel = JSON.parse(JSON.stringify(sentinelData));
      setNestedValue(falsySentinel, field, null);
      let falsyHtml = sentinelToSlots(renderWithProvider(config.component, falsySentinel));

      // Re-apply any prior array blocks to keep positions aligned
      if (config.arrays) {
        const emptiedSentinel = JSON.parse(JSON.stringify(falsySentinel));
        for (const af of config.arrays) setNestedValue(emptiedSentinel, af, []);
        const emptiedHtml = sentinelToSlots(renderWithProvider(config.component, emptiedSentinel));
        const blocks = config.arrays
          .map((af) => detectArrayBlock(falsyHtml, emptiedHtml, af))
          .filter((b): b is NonNullable<typeof b> => b !== null);
        falsyHtml = applyArrayBlocks(falsyHtml, blocks);
      }

      const block = detectBooleanBlock(truthyHtml, falsyHtml, field);
      if (block) boolBlocks.push(block);
    }
    processed = applyBooleanBlocks(processed, boolBlocks);
  }

  // Enum extraction
  if (config.enums) {
    const enumBlocks: EnumBlock[] = [];
    for (const { field, values } of config.enums) {
      const variantHtmls = new Map<string, string>();
      for (const value of values) {
        const variantSentinel = JSON.parse(JSON.stringify(sentinelData));
        setNestedValue(variantSentinel, field, value);
        const html = sentinelToSlots(renderWithProvider(config.component, variantSentinel));
        variantHtmls.set(value, html);
      }
      const block = detectEnumBlock(variantHtmls, field);
      if (block) enumBlocks.push(block);
    }
    processed = applyEnumBlocks(processed, enumBlocks);
  }

  return wrapDocument(processed, [], []);
}

// -- Core fidelity assertion --

export interface FidelityTestConfig extends TemplateConfig {
  realData: Record<string, unknown>;
}

/**
 * Assert the CTR pipeline produces identical output to direct React rendering.
 * inject(template, realData) === wrapDocument(renderToString(component, realData))
 */
export function assertPipelineFidelity(config: FidelityTestConfig): void {
  const template = buildTemplate(config);
  const injected = inject(template, config.realData, {
    skipDataScript: true,
  });

  const expectedSkeleton = renderWithProvider(config.component, config.realData);
  const expected = wrapDocument(expectedSkeleton, [], []);

  expect(injected).toBe(expected);
}

// -- Utility: set a value at a dot-separated path --

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}
