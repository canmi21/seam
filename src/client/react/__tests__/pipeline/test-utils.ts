/* src/client/react/__tests__/pipeline/test-utils.ts */

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect } from "vitest";
import { inject } from "@canmi/seam-engine";
import { SeamDataProvider } from "../../src/index.js";
import { buildSentinelData } from "../../src/sentinel.js";
import { extractTemplate, generateCombos } from "./extract/index.js";
import type { Axis } from "./extract/index.js";

export { inject, buildSentinelData };

// -- Slot replacement (mirrors Rust sentinel_to_slots) --
// Non-sentinel attributes (e.g. id="_R_1_" from React's useId) pass through
// verbatim as static template literals. The ID format is React-version dependent
// (18.x `:R1:`, 19.1 `<<R1>>`, 19.2 `_R_1_`), so the React version at build
// time and in the client bundle must be identical for hydration to match.

export function sentinelToSlots(html: string): string {
  const attrRe = /([\w-]+)="%%SEAM:([^%]+)%%"/g;
  const textRe = /%%SEAM:([^%]+)%%/g;
  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  const styleSentinelRe = /style="([^"]*%%SEAM:[^"]*)"/;
  const sentinelExtractRe = /%%SEAM:([^%]+)%%/;

  let result = "";
  let lastEnd = 0;

  for (const match of html.matchAll(tagRe)) {
    const fullMatch = match[0];
    const tagName = match[1];
    const attrsStr = match[2];
    const matchStart = match.index!;
    const matchEnd = matchStart + fullMatch.length;

    const hasStyleSentinels = styleSentinelRe.test(attrsStr);
    attrRe.lastIndex = 0;
    const hasAttrSentinels = attrRe.test(attrsStr);
    attrRe.lastIndex = 0;

    if (!hasStyleSentinels && !hasAttrSentinels) {
      result += html.slice(lastEnd, matchEnd);
      lastEnd = matchEnd;
      continue;
    }

    result += html.slice(lastEnd, matchStart);
    let workingAttrs = attrsStr;

    // Process style sentinels
    if (hasStyleSentinels) {
      const styleMatch = styleSentinelRe.exec(workingAttrs);
      if (styleMatch) {
        const styleValue = styleMatch[1];
        const parts = styleValue.split(";");
        const staticParts: string[] = [];

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;

          if (trimmed.includes("%%SEAM:")) {
            const colonPos = trimmed.indexOf(":");
            if (colonPos !== -1) {
              const cssProperty = trimmed.slice(0, colonPos).trim();
              const sentMatch = sentinelExtractRe.exec(trimmed);
              if (sentMatch) {
                result += `<!--seam:${sentMatch[1]}:style:${cssProperty}-->`;
              }
            }
          } else {
            staticParts.push(trimmed);
          }
        }

        if (staticParts.length === 0) {
          workingAttrs = workingAttrs.replace(styleMatch[0], "");
        } else {
          workingAttrs = workingAttrs.replace(styleMatch[0], `style="${staticParts.join(";")}"`);
        }
      }
    }

    // Process regular attr sentinels
    const comments: string[] = [];
    for (const attrMatch of workingAttrs.matchAll(attrRe)) {
      const attrName = attrMatch[1];
      const path = attrMatch[2];
      comments.push(`<!--seam:${path}:attr:${attrName}-->`);
    }
    const cleanedAttrs = workingAttrs.replace(attrRe, "").trim();

    for (const c of comments) result += c;
    // Handle self-closing void elements: strip trailing '/' from attrs and
    // reattach it directly (no space) to match React's renderToString format
    const selfClose = cleanedAttrs.endsWith("/");
    const finalAttrs = selfClose ? cleanedAttrs.slice(0, -1).trim() : cleanedAttrs;
    const close = selfClose ? "/>" : ">";
    result += finalAttrs ? `<${tagName} ${finalAttrs}${close}` : `<${tagName}${close}`;
    lastEnd = matchEnd;
  }
  result += html.slice(lastEnd);

  return result.replace(textRe, "<!--seam:$1-->");
}

// -- Metadata extraction (mirrors Rust extract_head_metadata) --
// Comments are consumed speculatively; only actual metadata elements advance
// the "confirmed" boundary. After the last metadata, trailing endif/else
// directives are included to keep if/endif pairs intact.

function extractHeadMetadata(skeleton: string): [string, string] {
  let pos = 0;
  let confirmed = 0;
  const len = skeleton.length;

  while (pos < len) {
    if (/\s/.test(skeleton[pos])) {
      pos++;
      continue;
    }
    if (skeleton[pos] !== "<") break;

    // Comments: consume speculatively (don't advance confirmed)
    if (skeleton.startsWith("<!--", pos)) {
      const end = skeleton.indexOf("-->", pos);
      if (end === -1) break;
      pos = end + 3;
      continue;
    }

    // Metadata elements: consume and confirm
    if (skeleton.startsWith("<title", pos)) {
      const end = skeleton.indexOf("</title>", pos);
      if (end === -1) break;
      pos = end + 8;
      confirmed = pos;
      continue;
    }
    if (skeleton.startsWith("<meta", pos)) {
      const end = skeleton.indexOf(">", pos);
      if (end === -1) break;
      pos = end + 1;
      confirmed = pos;
      continue;
    }
    if (skeleton.startsWith("<link", pos)) {
      const end = skeleton.indexOf(">", pos);
      if (end === -1) break;
      pos = end + 1;
      confirmed = pos;
      continue;
    }

    break;
  }

  // Include trailing endif/else directives that pair with consumed if directives
  if (confirmed > 0) {
    let trail = confirmed;
    while (trail < len) {
      while (trail < len && /\s/.test(skeleton[trail])) trail++;
      if (trail >= len) break;
      const rest = skeleton.slice(trail);
      if (rest.startsWith("<!--seam:end") || rest.startsWith("<!--seam:else")) {
        const end = skeleton.indexOf("-->", trail);
        if (end === -1) break;
        trail = end + 3;
        continue;
      }
      break;
    }
    confirmed = trail;
  }

  return [skeleton.slice(0, confirmed), skeleton.slice(confirmed)];
}

// -- Document wrapper --

export function wrapDocument(
  skeleton: string,
  css: string[],
  js: string[],
  rootId = "__seam",
): string {
  const [headMeta, bodySkeleton] = extractHeadMetadata(skeleton);
  let doc = '<!DOCTYPE html>\n<html>\n<head>\n    <meta charset="utf-8">\n';
  // No extra formatting around headMeta — inject doesn't strip whitespace
  // from empty conditional blocks, so extra indentation would cause mismatches.
  if (headMeta) doc += headMeta;
  for (const f of css) doc += `    <link rel="stylesheet" href="/_seam/static/${f}">\n`;
  doc += `</head>\n<body>\n    <div id="${rootId}">`;
  doc += bodySkeleton;
  doc += "</div>\n";
  for (const f of js) doc += `    <script type="module" src="/_seam/static/${f}"></script>\n`;
  doc += "</body>\n</html>";
  return doc;
}

// -- Render helper --

export function renderWithProvider(component: React.FC, data: unknown): string {
  return renderToString(createElement(SeamDataProvider, { value: data }, createElement(component)));
}

// -- Axis conversion --

function configToAxes(config: TemplateConfig): Axis[] {
  const axes: Axis[] = [];
  if (config.arrays) {
    for (const field of config.arrays) {
      axes.push({ path: field, kind: "array", values: ["populated", "empty"] });
    }
  }
  if (config.booleans) {
    for (const field of config.booleans) {
      axes.push({ path: field, kind: "boolean", values: [true, false] });
    }
  }
  if (config.enums) {
    for (const { field, values } of config.enums) {
      axes.push({ path: field, kind: "enum", values });
    }
  }
  return axes;
}

function applyCombToSentinel(
  baseSentinel: Record<string, unknown>,
  axes: Axis[],
  combo: unknown[],
): Record<string, unknown> {
  const data: Record<string, unknown> = JSON.parse(JSON.stringify(baseSentinel));
  for (let i = 0; i < axes.length; i++) {
    const axis = axes[i];
    const value = combo[i];
    switch (axis.kind) {
      case "boolean":
      case "nullable":
        if (value === false || value === null) setNestedValue(data, axis.path, null);
        break;
      case "array":
        if (value === "empty") setNestedValue(data, axis.path, []);
        break;
      case "enum":
        setNestedValue(data, axis.path, value);
        break;
    }
  }
  return data;
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
 * DOM tree diffing extraction -> document wrapping.
 */
export function buildTemplate(config: TemplateConfig): string {
  const sentinelData = buildSentinelData(config.mock);
  const axes = configToAxes(config);
  const combos = generateCombos(axes);

  const variants = combos.map((combo) => {
    const data = applyCombToSentinel(sentinelData, axes, combo);
    return sentinelToSlots(renderWithProvider(config.component, data));
  });

  const skeleton = extractTemplate(axes, variants);
  return wrapDocument(skeleton, [], []);
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === "$") {
      // $ refers to first element of the parent array (sentinel arrays have length 1)
      if (!Array.isArray(current) || current.length === 0) return;
      current = current[0];
    } else {
      current = current[parts[i]];
    }
    if (current === null || current === undefined) return;
  }
  const lastPart = parts[parts.length - 1];
  if (lastPart === "$") {
    if (Array.isArray(current)) current[0] = value;
  } else {
    current[lastPart] = value;
  }
}
