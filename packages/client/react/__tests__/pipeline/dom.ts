/* packages/client/react/__tests__/pipeline/dom.ts */

export type DomNode =
  | { type: "element"; tag: string; attrs: string; children: DomNode[]; selfClosing: boolean }
  | { type: "text"; value: string }
  | { type: "comment"; value: string };

export function parseHtml(html: string): DomNode[] {
  let pos = 0;

  function parseNodes(parentTag: string | null): DomNode[] {
    const nodes: DomNode[] = [];
    while (pos < html.length) {
      if (html[pos] === "<") {
        // Check for closing tag
        if (pos + 1 < html.length && html[pos + 1] === "/") {
          if (parentTag !== null) {
            const expected = `</${parentTag}>`;
            if (html.startsWith(expected, pos)) {
              pos += expected.length;
              return nodes;
            }
          }
          // Unexpected closing tag; consume and return
          while (pos < html.length && html[pos] !== ">") pos++;
          if (pos < html.length) pos++;
          return nodes;
        }

        // Check for comment
        if (html.startsWith("<!--", pos)) {
          nodes.push(parseComment());
          continue;
        }

        // Opening tag
        nodes.push(parseElement());
      } else {
        // Text node
        const start = pos;
        while (pos < html.length && html[pos] !== "<") pos++;
        const text = html.slice(start, pos);
        if (text.length > 0) {
          nodes.push({ type: "text", value: text });
        }
      }
    }
    return nodes;
  }

  function parseComment(): DomNode {
    // Skip "<!--"
    pos += 4;
    const start = pos;
    while (pos + 2 < html.length) {
      if (html[pos] === "-" && html[pos + 1] === "-" && html[pos + 2] === ">") {
        const content = html.slice(start, pos);
        pos += 3; // skip "-->"
        return { type: "comment", value: content };
      }
      pos++;
    }
    // Unterminated comment
    const content = html.slice(start);
    pos = html.length;
    return { type: "comment", value: content };
  }

  function parseElement(): DomNode {
    // Skip '<'
    pos++;
    const tagStart = pos;

    // Read tag name
    while (pos < html.length && html[pos] !== " " && html[pos] !== ">" && html[pos] !== "/") {
      pos++;
    }
    const tag = html.slice(tagStart, pos);

    // Read attrs: everything until unquoted '>' or '/>'
    const attrsStart = pos;
    let inQuote: string | null = null;
    while (pos < html.length) {
      if (inQuote !== null) {
        if (html[pos] === inQuote) inQuote = null;
        pos++;
      } else {
        if (html[pos] === '"' || html[pos] === "'") {
          inQuote = html[pos];
          pos++;
        } else if (html[pos] === "/" && pos + 1 < html.length && html[pos + 1] === ">") {
          // Self-closing
          const attrs = html.slice(attrsStart, pos);
          pos += 2;
          return { type: "element", tag, attrs, children: [], selfClosing: true };
        } else if (html[pos] === ">") {
          const attrs = html.slice(attrsStart, pos);
          pos++;
          const children = parseNodes(tag);
          return { type: "element", tag, attrs, children, selfClosing: false };
        } else {
          pos++;
        }
      }
    }

    // Unterminated tag
    const attrs = html.slice(attrsStart);
    pos = html.length;
    return { type: "element", tag, attrs, children: [], selfClosing: false };
  }

  return parseNodes(null);
}

export function serialize(nodes: DomNode[]): string {
  let out = "";
  for (const node of nodes) {
    serializeNode(node);
  }
  return out;

  function serializeNode(node: DomNode): void {
    if (node.type === "element") {
      if (node.selfClosing) {
        out += "<" + node.tag + node.attrs + "/>";
      } else {
        out += "<" + node.tag + node.attrs + ">";
        for (const child of node.children) serializeNode(child);
        out += "</" + node.tag + ">";
      }
    } else if (node.type === "text") {
      out += node.value;
    } else {
      out += "<!--" + node.value + "-->";
    }
  }
}

export function fingerprint(node: DomNode): string {
  return serialize([node]);
}
