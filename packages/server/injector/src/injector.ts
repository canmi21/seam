/* packages/server/injector/src/injector.ts */

import { escapeHtml } from "./escape.js";
import { resolve } from "./resolve.js";

export interface InjectOptions {
  skipDataScript?: boolean;
}

// -- AST node types --

type AstNode = TextNode | SlotNode | AttrNode | IfNode | EachNode | MatchNode;

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

// -- Renderer --

interface AttrEntry {
  marker: string;
  attrName: string;
  value: string;
}

function render(nodes: AstNode[], data: Record<string, unknown>, attrs: AttrEntry[]): string {
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

      case "if": {
        const value = resolve(node.path, data);
        if (isTruthy(value)) {
          out += render(node.thenNodes, data, attrs);
        } else {
          out += render(node.elseNodes, data, attrs);
        }
        break;
      }

      case "each": {
        const value = resolve(node.path, data);
        if (Array.isArray(value)) {
          for (const item of value) {
            const scopedData: Record<string, unknown> = { ...data, $$: data.$, $: item };
            out += render(node.bodyNodes, scopedData, attrs);
          }
        }
        break;
      }

      case "match": {
        const value = resolve(node.path, data);
        const key = stringify(value);
        const branch = node.branches.get(key);
        if (branch) {
          out += render(branch, data, attrs);
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

// -- Entry point --

export function inject(
  template: string,
  data: Record<string, unknown>,
  options?: InjectOptions,
): string {
  const tokens = tokenize(template);
  const ast = parse(tokens);
  const attrs: AttrEntry[] = [];
  let result = render(ast, data, attrs);

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
