/* src/client/react/__tests__/pipeline/extract/helpers.ts */

import type { DomNode } from "../dom.js";

// -- Shared helpers (from mod.rs) --

export function isDirectiveComment(node: DomNode): boolean {
  if (node.type !== "comment") return false;
  const c = node.value;
  return (
    c.startsWith("seam:if:") ||
    c.startsWith("seam:endif:") ||
    c === "seam:else" ||
    c.startsWith("seam:each:") ||
    c === "seam:endeach" ||
    c.startsWith("seam:match:") ||
    c.startsWith("seam:when:") ||
    c === "seam:endmatch"
  );
}

export function contentIndices(tree: DomNode[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < tree.length; i++) {
    if (!isDirectiveComment(tree[i])) result.push(i);
  }
  return result;
}

export function nthContentIndex(tree: DomNode[], n: number): number | undefined {
  let count = 0;
  for (let i = 0; i < tree.length; i++) {
    if (!isDirectiveComment(tree[i])) {
      if (count === n) return i;
      count++;
    }
  }
  return undefined;
}

export function renameSlotMarkers(nodes: DomNode[], prefix: string): void {
  const old = `seam:${prefix}.`;
  for (const node of nodes) {
    if (node.type === "comment" && node.value.startsWith(old)) {
      node.value = `seam:${node.value.slice(old.length)}`;
    } else if (node.type === "element") {
      renameSlotMarkers(node.children, prefix);
    }
  }
}

export function navigateToChildren(nodes: DomNode[], path: number[]): DomNode[] {
  if (path.length === 0) return nodes;
  const node = nodes[path[0]];
  if (node.type === "element") {
    return navigateToChildren(node.children, path.slice(1));
  }
  return nodes;
}

// -- Container (from container.rs) --

export function isListContainer(tag: string): boolean {
  return ["ul", "ol", "dl", "table", "tbody", "thead", "tfoot", "select", "datalist"].includes(tag);
}

export function unwrapContainerTree(
  body: DomNode[],
): { tag: string; attrs: string; children: DomNode[] } | null {
  if (body.length !== 1) return null;
  const node = body[0];
  if (
    node.type === "element" &&
    !node.selfClosing &&
    isListContainer(node.tag) &&
    node.children.length > 0
  ) {
    return { tag: node.tag, attrs: node.attrs, children: node.children };
  }
  return null;
}

export function hoistListContainer(
  body: DomNode[],
): { tag: string; attrs: string; children: DomNode[] } | null {
  let containerTag: string | null = null;
  let containerAttrs: string | null = null;
  let hasElement = false;

  for (const node of body) {
    if (node.type === "comment") continue;
    if (
      node.type === "element" &&
      !node.selfClosing &&
      isListContainer(node.tag) &&
      node.children.length > 0
    ) {
      hasElement = true;
      if (containerTag === null) {
        containerTag = node.tag;
        containerAttrs = node.attrs;
      } else if (containerTag !== node.tag || containerAttrs !== node.attrs) {
        return null;
      }
    } else {
      return null;
    }
  }

  if (!hasElement || containerTag === null || containerAttrs === null) return null;

  const inner: DomNode[] = [];
  for (const node of body) {
    if (node.type === "comment") {
      inner.push({ type: "comment", value: node.value });
    } else if (node.type === "element") {
      inner.push(...structuredClone(node.children));
    }
  }

  return { tag: containerTag, attrs: containerAttrs, children: inner };
}
