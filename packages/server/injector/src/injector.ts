/* packages/server/injector/src/injector.ts */

import { escapeHtml } from "./escape.js";
import { resolve } from "./resolve.js";

export interface InjectOptions {
  skipDataScript?: boolean;
}

const COND_RE = /<!--seam:if:([\w.]+)-->([\s\S]*?)<!--seam:endif:\1-->/g;
const ATTR_RE = /<!--seam:([\w.]+):attr:(\w+)-->/g;
const RAW_RE = /<!--seam:([\w.]+):html-->/g;
const TEXT_RE = /<!--seam:([\w.]+)-->/g;

function isTruthy(value: unknown): boolean {
  return value !== null && value !== undefined && value !== false && value !== 0 && value !== "";
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function inject(
  template: string,
  data: Record<string, unknown>,
  options?: InjectOptions,
): string {
  // 1. Conditionals (loop to handle nesting with different paths)
  let result = template;
  let prev: string;
  do {
    prev = result;
    result = result.replace(COND_RE, (_, path: string, inner: string) => {
      const value = resolve(path, data);
      return isTruthy(value) ? inner : "";
    });
  } while (result !== prev);

  // 2. Attributes (two-phase approach)
  // Phase A: Replace each <!--seam:path:attr:name--> comment with a null-byte
  // marker. We can't inject attributes inline because the comment sits *before*
  // the target tag, so we need the tag's position -- which shifts as we edit.
  // Null-byte markers are safe since they never appear in valid HTML.
  const attrs: { marker: string; attrName: string; value: string }[] = [];
  let attrIdx = 0;
  result = result.replace(ATTR_RE, (_, path: string, attrName: string) => {
    const value = resolve(path, data);
    if (value === undefined) return "";
    const marker = `\x00SEAM_ATTR_${attrIdx++}\x00`;
    attrs.push({ marker, attrName, value: escapeHtml(stringify(value)) });
    return marker;
  });
  // Phase B: For each marker, find the next opening `<tag` after the marker
  // position and splice the attribute into the tag.
  for (const { marker, attrName, value } of attrs) {
    const pos = result.indexOf(marker);
    if (pos === -1) continue;
    result = result.slice(0, pos) + result.slice(pos + marker.length);
    const tagStart = result.indexOf("<", pos);
    if (tagStart === -1) continue;
    // Advance past the tag name to find the insertion point for attributes
    let tagNameEnd = tagStart + 1;
    while (
      tagNameEnd < result.length &&
      result[tagNameEnd] !== " " &&
      result[tagNameEnd] !== ">" &&
      result[tagNameEnd] !== "/" &&
      result[tagNameEnd] !== "\n" &&
      result[tagNameEnd] !== "\t"
    ) {
      tagNameEnd++;
    }
    const injection = ` ${attrName}="${value}"`;
    result = result.slice(0, tagNameEnd) + injection + result.slice(tagNameEnd);
  }

  // 3. Raw HTML
  result = result.replace(RAW_RE, (_, path: string) => {
    const value = resolve(path, data);
    return stringify(value);
  });

  // 4. Text (escaped)
  result = result.replace(TEXT_RE, (_, path: string) => {
    const value = resolve(path, data);
    return escapeHtml(stringify(value));
  });

  // 5. __SEAM_DATA__ script
  if (!options?.skipDataScript) {
    const script = `<script id="__SEAM_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
    const bodyClose = result.lastIndexOf("</body>");
    if (bodyClose !== -1) {
      result = result.slice(0, bodyClose) + script + result.slice(bodyClose);
    } else {
      result += script;
    }
  }

  return result;
}
