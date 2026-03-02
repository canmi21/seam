/* src/router/seam/src/validator.ts */

import { segmentToUrlPart } from "./conventions.js";
import type { RouteNode, ValidationError } from "./types.js";

function computeUrl(node: RouteNode, parentUrl: string): string {
  const part = segmentToUrlPart(node.segment);
  // Groups contribute nothing to the URL
  if (node.segment.type === "group") return parentUrl;
  const url = parentUrl + part;
  return url || "/";
}

/** Flatten tree into (url, filePath) pairs for nodes that have a pageFile */
function flattenPaths(
  nodes: RouteNode[],
  parentUrl: string,
  result: Array<{ url: string; filePath: string }>,
): void {
  for (const node of nodes) {
    const url = computeUrl(node, parentUrl);
    if (node.pageFile) {
      result.push({ url, filePath: node.pageFile });
    }
    flattenPaths(node.children, url, result);
  }
}

function checkDuplicates(nodes: RouteNode[]): ValidationError[] {
  const entries: Array<{ url: string; filePath: string }> = [];
  flattenPaths(nodes, "", entries);

  const byUrl = new Map<string, string[]>();
  for (const { url, filePath } of entries) {
    const existing = byUrl.get(url);
    if (existing) {
      existing.push(filePath);
    } else {
      byUrl.set(url, [filePath]);
    }
  }

  const errors: ValidationError[] = [];
  for (const [url, paths] of byUrl) {
    if (paths.length > 1) {
      errors.push({
        type: "duplicate-path",
        message: `Duplicate route "${url}" defined in: ${paths.join(", ")}`,
        paths,
      });
    }
  }
  return errors;
}

function checkSiblings(nodes: RouteNode[], errors: ValidationError[]): void {
  // Check at this level
  const paramChildren = nodes.filter((n) => n.segment.type === "param");
  if (paramChildren.length > 1) {
    const names = new Set(
      paramChildren.map((n) => (n.segment.type === "param" ? n.segment.name : "")),
    );
    if (names.size > 1) {
      errors.push({
        type: "ambiguous-dynamic",
        message: `Ambiguous dynamic segments at same level: ${[...names].join(", ")}`,
        paths: paramChildren.map((n) => n.dirPath),
      });
    }
  }

  // Catch-all conflict: both catch-all/optional-catch-all and param at same level
  const hasCatchAll = nodes.some(
    (n) => n.segment.type === "catch-all" || n.segment.type === "optional-catch-all",
  );
  const hasParam = nodes.some((n) => n.segment.type === "param");
  if (hasCatchAll && hasParam) {
    const conflicting = nodes.filter(
      (n) =>
        n.segment.type === "catch-all" ||
        n.segment.type === "optional-catch-all" ||
        n.segment.type === "param",
    );
    errors.push({
      type: "catch-all-conflict",
      message: "Catch-all segment conflicts with param segment at same level",
      paths: conflicting.map((n) => n.dirPath),
    });
  }

  // Recurse into children
  for (const node of nodes) {
    checkSiblings(node.children, errors);
  }
}

export function validateRouteTree(roots: RouteNode[]): ValidationError[] {
  const errors: ValidationError[] = [];
  errors.push(...checkDuplicates(roots));
  checkSiblings(roots, errors);
  return errors;
}
