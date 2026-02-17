/* packages/server/injector/src/injector.ts */

import { escapeHtml } from "./escape.js";
import { resolve } from "./resolve.js";

export interface InjectOptions {
  skipDataScript?: boolean;
}

// -- AST node types --

type AstNode = TextNode | SlotNode | AttrNode | StylePropNode | IfNode | EachNode | MatchNode;

interface TextNode {
  type: "text";
  value: string;
}

interface SlotNode {
  type: "slot";
  path: string;
  mode: "text" | "html";
}

interface AttrNode {
  type: "attr";
  path: string;
  attrName: string;
}

interface StylePropNode {
  type: "styleProp";
  path: string;
  cssProperty: string;
}

interface IfNode {
  type: "if";
  path: string;
  thenNodes: AstNode[];
  elseNodes: AstNode[];
}

interface EachNode {
  type: "each";
  path: string;
  bodyNodes: AstNode[];
}

interface MatchNode {
  type: "match";
  path: string;
  branches: Map<string, AstNode[]>;
}

// -- Tokenizer --

interface Token {
  kind: "text" | "marker";
  value: string; // full text for "text", directive body for "marker"
}

const MARKER_OPEN = "<!--seam:";
const MARKER_CLOSE = "-->";

function tokenize(template: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < template.length) {
    const markerStart = template.indexOf(MARKER_OPEN, pos);
    if (markerStart === -1) {
      tokens.push({ kind: "text", value: template.slice(pos) });
      break;
    }
    if (markerStart > pos) {
      tokens.push({ kind: "text", value: template.slice(pos, markerStart) });
    }
    const markerEnd = template.indexOf(MARKER_CLOSE, markerStart + MARKER_OPEN.length);
    if (markerEnd === -1) {
      // Unclosed marker -- treat rest as text
      tokens.push({ kind: "text", value: template.slice(markerStart) });
      break;
    }
    const directive = template.slice(markerStart + MARKER_OPEN.length, markerEnd);
    tokens.push({ kind: "marker", value: directive });
    pos = markerEnd + MARKER_CLOSE.length;
  }

  return tokens;
}

// -- Parser --

function parse(tokens: Token[]): AstNode[] {
  let pos = 0;

  function parseUntil(stop: ((directive: string) => boolean) | null): AstNode[] {
    const nodes: AstNode[] = [];
    while (pos < tokens.length) {
      const token = tokens[pos];
      if (token.kind === "text") {
        nodes.push({ type: "text", value: token.value });
        pos++;
        continue;
      }

      const directive = token.value;

      // Check stop condition
      if (stop && stop(directive)) {
        return nodes;
      }

      if (directive.startsWith("match:")) {
        const path = directive.slice(6);
        pos++;
        const branches = new Map<string, AstNode[]>();
        // Expect one or more when:VALUE blocks until endmatch
        while (pos < tokens.length) {
          const cur = tokens[pos];
          if (cur.kind === "marker" && cur.value === "endmatch") {
            pos++;
            break;
          }
          if (cur.kind === "marker" && cur.value.startsWith("when:")) {
            const branchValue = cur.value.slice(5);
            pos++;
            const branchNodes = parseUntil((d) => d.startsWith("when:") || d === "endmatch");
            branches.set(branchValue, branchNodes);
          } else {
            // Skip unexpected tokens between match and first when
            pos++;
          }
        }
        nodes.push({ type: "match", path, branches });
      } else if (directive.startsWith("if:")) {
        const path = directive.slice(3);
        pos++;
        const thenNodes = parseUntil((d) => d === "else" || d === `endif:${path}`);
        let elseNodes: AstNode[] = [];
        if (pos < tokens.length && tokens[pos].kind === "marker" && tokens[pos].value === "else") {
          pos++;
          elseNodes = parseUntil((d) => d === `endif:${path}`);
        }
        // Skip the endif token
        if (pos < tokens.length) pos++;
        nodes.push({ type: "if", path, thenNodes, elseNodes });
      } else if (directive.startsWith("each:")) {
        const path = directive.slice(5);
        pos++;
        const bodyNodes = parseUntil((d) => d === "endeach");
        // Skip the endeach token
        if (pos < tokens.length) pos++;
        nodes.push({ type: "each", path, bodyNodes });
      } else if (directive.includes(":style:")) {
        const colonIdx = directive.indexOf(":style:");
        const path = directive.slice(0, colonIdx);
        const cssProperty = directive.slice(colonIdx + 7);
        pos++;
        nodes.push({ type: "styleProp", path, cssProperty });
      } else if (directive.includes(":attr:")) {
        const colonIdx = directive.indexOf(":attr:");
        const path = directive.slice(0, colonIdx);
        const attrName = directive.slice(colonIdx + 6);
        pos++;
        nodes.push({ type: "attr", path, attrName });
      } else if (directive.endsWith(":html")) {
        const path = directive.slice(0, -5);
        pos++;
        nodes.push({ type: "slot", path, mode: "html" });
      } else {
        // Plain text slot
        pos++;
        nodes.push({ type: "slot", path: directive, mode: "text" });
      }
    }
    return nodes;
  }

  return parseUntil(null);
}

// -- Truthiness --

function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === "") {
    return false;
  }
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

// -- Stringify --

function stringify(value: unknown): string {
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

interface AttrEntry {
  marker: string;
  attrName: string;
  value: string;
}

interface StyleAttrEntry {
  marker: string;
  cssProperty: string;
  value: string;
}

function render(
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

// -- Attribute injection (phase B) --

function injectAttributes(html: string, attrs: AttrEntry[]): string {
  let result = html;
  for (const { marker, attrName, value } of attrs) {
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
  const tokens = tokenize(template);
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

  // __SEAM_DATA__ script
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
