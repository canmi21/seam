/* packages/server/injector/native/src/injector.ts */

import { tokenize } from "./parser.js";
import { parse } from "./parser.js";
import { render } from "./renderer.js";
import type { AttrEntry, StyleAttrEntry } from "./renderer.js";

export interface InjectOptions {
  skipDataScript?: boolean;
  dataId?: string;
}

// -- Attribute injection (phase B) --

function injectAttributes(html: string, attrs: AttrEntry[]): string {
  let result = html;
  // Process in reverse so each insertion at tagNameEnd builds the correct
  // left-to-right order (later attrs get pushed right by earlier ones)
  for (let i = attrs.length - 1; i >= 0; i--) {
    const { marker, attrName, value } = attrs[i];
    const pos = result.indexOf(marker);
    if (pos === -1) continue;
    result = result.slice(0, pos) + result.slice(pos + marker.length);
    const tagStart = result.indexOf("<", pos);
    if (tagStart === -1) continue;
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
  return result;
}

// -- Style attribute injection (phase B) --

function injectStyleAttributes(html: string, entries: StyleAttrEntry[]): string {
  let result = html;
  for (const { marker, cssProperty, value } of entries) {
    const pos = result.indexOf(marker);
    if (pos === -1) continue;
    result = result.slice(0, pos) + result.slice(pos + marker.length);

    const tagStart = result.indexOf("<", pos);
    if (tagStart === -1) continue;
    const tagEnd = result.indexOf(">", tagStart);
    if (tagEnd === -1) continue;

    const tagContent = result.slice(tagStart, tagEnd);
    const styleIdx = tagContent.indexOf('style="');

    if (styleIdx !== -1) {
      // Merge into existing style
      const absStyleValStart = tagStart + styleIdx + 7;
      const styleValEnd = result.indexOf('"', absStyleValStart);
      if (styleValEnd !== -1) {
        const injection = `;${cssProperty}:${value}`;
        result = result.slice(0, styleValEnd) + injection + result.slice(styleValEnd);
      }
    } else {
      // Insert new style attribute after tag name
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
      const injection = ` style="${cssProperty}:${value}"`;
      result = result.slice(0, tagNameEnd) + injection + result.slice(tagNameEnd);
    }
  }
  return result;
}

// -- Entry point --

export function inject(
  template: string,
  data: Record<string, unknown>,
  options?: InjectOptions,
): string {
  // Null-byte marker safety: Phase B uses \x00SEAM_ATTR_N\x00 / \x00SEAM_STYLE_N\x00
  // as deferred attribute-injection placeholders. HTML spec forbids U+0000, so valid
  // templates never contain them. Strip any stray null bytes from malformed SSR output
  // to prevent marker collisions in the indexOf lookups.
  const clean = template.includes("\x00") ? template.replaceAll("\x00", "") : template;
  const tokens = tokenize(clean);
  const ast = parse(tokens);
  const attrs: AttrEntry[] = [];
  const styleAttrs: StyleAttrEntry[] = [];
  let result = render(ast, data, attrs, styleAttrs);

  // Phase B: splice style attributes first
  if (styleAttrs.length > 0) {
    result = injectStyleAttributes(result, styleAttrs);
  }

  // Phase B: splice collected attributes into their target tags
  if (attrs.length > 0) {
    result = injectAttributes(result, attrs);
  }

  // data script
  if (!options?.skipDataScript) {
    const id = options?.dataId ?? "__data";
    const script = `<script id="${id}" type="application/json">${JSON.stringify(data)}</script>`;
    const bodyClose = result.lastIndexOf("</body>");
    if (bodyClose !== -1) {
      result = result.slice(0, bodyClose) + script + result.slice(bodyClose);
    } else {
      result += script;
    }
  }

  return result;
}
