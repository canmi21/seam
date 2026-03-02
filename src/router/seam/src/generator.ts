/* src/router/seam/src/generator.ts */

import * as path from "node:path";
import { segmentToUrlPart } from "./conventions.js";
import { detectNamedExports } from "./detect-exports.js";
import type { RouteNode, SegmentKind } from "./types.js";

export interface GenerateOptions {
  outputPath: string;
}

interface ImportEntry {
  name: string;
  source: string;
  isDefault: boolean;
}

interface DataImportEntry {
  exportName: string;
  alias: string;
  source: string;
}

const SEGMENT_ORDER: Record<SegmentKind["type"], number> = {
  static: 0,
  group: 0,
  param: 1,
  "optional-param": 2,
  "catch-all": 3,
  "optional-catch-all": 4,
};

function sanitizePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "_");
}

function toImportName(prefix: string, urlPath: string): string {
  if (urlPath === "/" || urlPath === "") return `${prefix}_index`;
  const parts = urlPath
    .split("/")
    .filter(Boolean)
    .map((p) => {
      if (p.startsWith(":")) return `$${sanitizePart(p.slice(1))}`;
      if (p.startsWith("*")) return `$$${sanitizePart(p.slice(1))}`;
      return sanitizePart(p);
    });
  return `${prefix}_${parts.join("_")}`;
}

function toPosixRelative(from: string, to: string): string {
  let rel = path.relative(from, to).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

function computeUrlPath(node: RouteNode, parentUrl: string): string {
  const part = segmentToUrlPart(node.segment);
  if (node.segment.type === "group") return parentUrl;
  const url = parentUrl + part;
  return url || "/";
}

function collectImports(
  nodes: RouteNode[],
  parentUrl: string,
  outputDir: string,
  componentImports: ImportEntry[],
  dataImports: DataImportEntry[],
): void {
  for (const node of nodes) {
    const url = computeUrlPath(node, parentUrl);

    if (node.pageFile) {
      componentImports.push({
        name: toImportName("Page", url),
        source: toPosixRelative(outputDir, node.pageFile),
        isDefault: true,
      });
    }

    if (node.dataFile) {
      const exports = detectNamedExports(node.dataFile);
      const src = toPosixRelative(outputDir, node.dataFile);
      for (const exp of exports) {
        dataImports.push({
          exportName: exp,
          alias: `${toImportName("Page", url)}_${exp}`,
          source: src,
        });
      }
    }

    if (node.layoutFile) {
      componentImports.push({
        name: toImportName("Layout", url),
        source: toPosixRelative(outputDir, node.layoutFile),
        isDefault: true,
      });
    }

    if (node.layoutDataFile) {
      const exports = detectNamedExports(node.layoutDataFile);
      const src = toPosixRelative(outputDir, node.layoutDataFile);
      for (const exp of exports) {
        dataImports.push({
          exportName: exp,
          alias: `${toImportName("Layout", url)}_${exp}`,
          source: src,
        });
      }
    }

    if (node.errorFile) {
      componentImports.push({
        name: toImportName("Error", url),
        source: toPosixRelative(outputDir, node.errorFile),
        isDefault: true,
      });
    }

    if (node.loadingFile) {
      componentImports.push({
        name: toImportName("Loading", url),
        source: toPosixRelative(outputDir, node.loadingFile),
        isDefault: true,
      });
    }

    if (node.notFoundFile) {
      componentImports.push({
        name: toImportName("NotFound", url),
        source: toPosixRelative(outputDir, node.notFoundFile),
        isDefault: true,
      });
    }

    collectImports(node.children, url, outputDir, componentImports, dataImports);
  }
}

function sortChildren(children: RouteNode[]): RouteNode[] {
  return [...children].sort(
    (a, b) => SEGMENT_ORDER[a.segment.type] - SEGMENT_ORDER[b.segment.type],
  );
}

function renderRouteNode(node: RouteNode, parentUrl: string, indent: string): string {
  const url = computeUrlPath(node, parentUrl);

  // Group with layout → layout wrapper at path "/"
  if (node.segment.type === "group" && node.layoutFile) {
    const layoutName = toImportName("Layout", url);
    const sorted = sortChildren(node.children);
    const childrenStr = sorted
      .map((c) => renderRouteNode(c, url, indent + "  "))
      .filter(Boolean)
      .join(",\n");

    const fields: string[] = [];
    fields.push(`${indent}  path: "/"`);
    fields.push(`${indent}  layout: ${layoutName}`);

    // Layout data
    if (node.layoutDataFile) {
      const exports = detectNamedExports(node.layoutDataFile);
      for (const exp of exports) {
        fields.push(`${indent}  ${exp}: ${toImportName("Layout", url)}_${exp}`);
      }
    }

    if (childrenStr) {
      fields.push(`${indent}  children: [\n${childrenStr}\n${indent}  ]`);
    }

    return `${indent}{\n${fields.join(",\n")}\n${indent}}`;
  }

  // Group without layout → merge children into parent
  if (node.segment.type === "group" && !node.layoutFile) {
    const sorted = sortChildren(node.children);
    return sorted
      .map((c) => renderRouteNode(c, url, indent))
      .filter(Boolean)
      .join(",\n");
  }

  // Non-group nodes
  const routePath = segmentToUrlPart(node.segment);
  const fields: string[] = [];
  fields.push(`${indent}  path: "${routePath || "/"}"`);

  if (node.pageFile) {
    fields.push(`${indent}  component: ${toImportName("Page", url)}`);
  }

  if (node.layoutFile) {
    fields.push(`${indent}  layout: ${toImportName("Layout", url)}`);
  }

  // Page data exports
  if (node.dataFile) {
    const exports = detectNamedExports(node.dataFile);
    for (const exp of exports) {
      fields.push(`${indent}  ${exp}: ${toImportName("Page", url)}_${exp}`);
    }
  }

  // Layout data exports
  if (node.layoutDataFile) {
    const exports = detectNamedExports(node.layoutDataFile);
    for (const exp of exports) {
      fields.push(`${indent}  ${exp}: ${toImportName("Layout", url)}_${exp}`);
    }
  }

  if (node.errorFile) {
    fields.push(`${indent}  errorComponent: ${toImportName("Error", url)}`);
  }

  if (node.loadingFile) {
    fields.push(`${indent}  pendingComponent: ${toImportName("Loading", url)}`);
  }

  if (node.notFoundFile) {
    fields.push(`${indent}  notFoundComponent: ${toImportName("NotFound", url)}`);
  }

  const sorted = sortChildren(node.children);
  const childrenStr = sorted
    .map((c) => renderRouteNode(c, url, indent + "  "))
    .filter(Boolean)
    .join(",\n");

  if (childrenStr) {
    fields.push(`${indent}  children: [\n${childrenStr}\n${indent}  ]`);
  }

  // Skip nodes that have no page, no layout, no children, and no special files
  if (
    !node.pageFile &&
    !node.layoutFile &&
    !node.errorFile &&
    !node.loadingFile &&
    !node.notFoundFile &&
    !childrenStr
  ) {
    return "";
  }

  return `${indent}{\n${fields.join(",\n")}\n${indent}}`;
}

export function generateRoutesFile(tree: RouteNode[], options: GenerateOptions): string {
  const outputDir = path.dirname(path.resolve(options.outputPath));
  const componentImports: ImportEntry[] = [];
  const dataImports: DataImportEntry[] = [];

  collectImports(tree, "", outputDir, componentImports, dataImports);

  const lines: string[] = [
    "/* .seam/generated/routes.ts — auto-generated by @canmi/seam-router, do not edit */",
    "",
    'import { defineSeamRoutes } from "@canmi/seam-tanstack-router/routes"',
  ];

  // Group data imports by source
  const dataBySource = new Map<string, DataImportEntry[]>();
  for (const d of dataImports) {
    const existing = dataBySource.get(d.source);
    if (existing) {
      existing.push(d);
    } else {
      dataBySource.set(d.source, [d]);
    }
  }

  // Component imports
  for (const imp of componentImports) {
    lines.push(`import ${imp.name} from "${imp.source}"`);
  }

  // Data imports
  for (const [source, entries] of dataBySource) {
    const specifiers = entries.map((e) => `${e.exportName} as ${e.alias}`).join(", ");
    lines.push(`import { ${specifiers} } from "${source}"`);
  }

  lines.push("");

  const routeEntries = tree
    .map((node) => renderRouteNode(node, "", "  "))
    .filter(Boolean)
    .join(",\n");

  lines.push(`export default defineSeamRoutes([\n${routeEntries}\n])`);
  lines.push("");

  return lines.join("\n");
}
