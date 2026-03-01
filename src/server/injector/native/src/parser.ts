/* src/server/injector/native/src/parser.ts */

import type { AstNode } from "./ast.js";

// -- Tokenizer --

export interface Token {
  kind: "text" | "marker";
  value: string; // full text for "text", directive body for "marker"
}

const MARKER_OPEN = "<!--seam:";
const MARKER_CLOSE = "-->";

export function tokenize(template: string): Token[] {
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

export function parse(tokens: Token[]): AstNode[] {
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
