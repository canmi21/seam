/* packages/server/injector/native/src/renderer.ts */

import type { AstNode } from "./ast.js";
import { escapeHtml } from "./escape.js";
import { resolve } from "./resolve.js";

// -- Truthiness --

export function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === "") {
    return false;
  }
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

// -- Stringify --

export function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- only primitives reach here
  return String(value);
}

// -- HTML boolean attributes --

const HTML_BOOLEAN_ATTRS = new Set([
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "readonly",
  "required",
  "reversed",
  "selected",
]);

// -- CSS unitless properties --

const CSS_UNITLESS_PROPERTIES = new Set([
  "animation-iteration-count",
  "border-image-outset",
  "border-image-slice",
  "border-image-width",
  "box-flex",
  "box-flex-group",
  "box-ordinal-group",
  "column-count",
  "columns",
  "flex",
  "flex-grow",
  "flex-positive",
  "flex-shrink",
  "flex-negative",
  "flex-order",
  "font-weight",
  "grid-area",
  "grid-column",
  "grid-column-end",
  "grid-column-span",
  "grid-column-start",
  "grid-row",
  "grid-row-end",
  "grid-row-span",
  "grid-row-start",
  "line-clamp",
  "line-height",
  "opacity",
  "order",
  "orphans",
  "tab-size",
  "widows",
  "z-index",
  "zoom",
  "fill-opacity",
  "flood-opacity",
  "stop-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
]);

function formatStyleValue(cssProperty: string, value: unknown): string | null {
  if (value === null || value === undefined || value === false) return null;
  if (typeof value === "number") {
    if (value === 0) return "0";
    if (CSS_UNITLESS_PROPERTIES.has(cssProperty)) return String(value);
    return `${value}px`;
  }
  if (typeof value === "string") {
    return value || null; // empty string returns null (skip)
  }
  return null;
}

// -- Renderer --

export interface AttrEntry {
  marker: string;
  attrName: string;
  value: string;
}

export interface StyleAttrEntry {
  marker: string;
  cssProperty: string;
  value: string;
}

export function render(
  nodes: AstNode[],
  data: Record<string, unknown>,
  attrs: AttrEntry[],
  styleAttrs: StyleAttrEntry[],
): string {
  let out = "";

  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out += node.value;
        break;

      case "slot": {
        const value = resolve(node.path, data);
        out += node.mode === "html" ? stringify(value) : escapeHtml(stringify(value));
        break;
      }

      case "attr": {
        const value = resolve(node.path, data);
        if (value !== undefined) {
          if (HTML_BOOLEAN_ATTRS.has(node.attrName)) {
            // Boolean HTML attrs: truthy -> attr="", falsy -> omit
            if (isTruthy(value)) {
              const marker = `\x00SEAM_ATTR_${attrs.length}\x00`;
              attrs.push({ marker, attrName: node.attrName, value: "" });
              out += marker;
            }
          } else {
            const marker = `\x00SEAM_ATTR_${attrs.length}\x00`;
            attrs.push({ marker, attrName: node.attrName, value: escapeHtml(stringify(value)) });
            out += marker;
          }
        }
        break;
      }

      case "styleProp": {
        const value = resolve(node.path, data);
        if (value !== undefined) {
          const formatted = formatStyleValue(node.cssProperty, value);
          if (formatted !== null) {
            const marker = `\x00SEAM_STYLE_${styleAttrs.length}\x00`;
            styleAttrs.push({ marker, cssProperty: node.cssProperty, value: formatted });
            out += marker;
          }
        }
        break;
      }

      case "if": {
        const value = resolve(node.path, data);
        if (isTruthy(value)) {
          out += render(node.thenNodes, data, attrs, styleAttrs);
        } else {
          out += render(node.elseNodes, data, attrs, styleAttrs);
        }
        break;
      }

      case "each": {
        const value = resolve(node.path, data);
        if (Array.isArray(value)) {
          for (const item of value) {
            const scopedData: Record<string, unknown> = { ...data, $$: data.$, $: item };
            out += render(node.bodyNodes, scopedData, attrs, styleAttrs);
          }
        }
        break;
      }

      case "match": {
        const value = resolve(node.path, data);
        const key = stringify(value);
        const branch = node.branches.get(key);
        if (branch) {
          out += render(branch, data, attrs, styleAttrs);
        }
        break;
      }
    }
  }

  return out;
}
