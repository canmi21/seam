/* src/client/react/scripts/skeleton/layout.mjs */

import { createElement } from "react";
import { buildSentinelData } from "@canmi/seam-react";
import {
  generateMockFromSchema,
  flattenLoaderMock,
  deepMerge,
  collectHtmlPaths,
  createAccessTracker,
  checkFieldAccess,
} from "../mock-generator.mjs";
import { guardedRender } from "./render.mjs";
import { buildPageSchema } from "./schema.mjs";

function toLayoutId(path) {
  return path === "/"
    ? "_layout_root"
    : `_layout_${path.replace(/^\/|\/$/g, "").replace(/\//g, "-")}`;
}

/** Extract layout components and metadata from route tree */
function extractLayouts(routes) {
  const seen = new Map();
  (function walk(defs, parentId) {
    for (const def of defs) {
      if (def.layout && def.children) {
        const id = toLayoutId(def.path);
        if (!seen.has(id)) {
          seen.set(id, {
            component: def.layout,
            loaders: def.loaders || {},
            mock: def.mock || null,
            parentId: parentId || null,
          });
        }
        walk(def.children, id);
      }
    }
  })(routes, null);
  return seen;
}

/**
 * Resolve mock data for a layout: auto-generate from schema when loaders exist,
 * then deep-merge any user-provided partial mock on top.
 * Unlike resolveRouteMock, a layout with no loaders and no mock is valid (empty shell).
 */
function resolveLayoutMock(entry, manifest) {
  if (Object.keys(entry.loaders).length > 0) {
    const schema = buildPageSchema(entry, manifest);
    if (schema) {
      const keyedMock = generateMockFromSchema(schema);
      const autoMock = flattenLoaderMock(keyedMock);
      return entry.mock ? deepMerge(autoMock, entry.mock) : autoMock;
    }
  }
  return entry.mock || {};
}

/**
 * Render layout with seam-outlet placeholder, optionally with sentinel data.
 * @param {{ buildWarnings: string[], seenWarnings: Set<string> }} ctx - shared warning state
 */
function renderLayout(LayoutComponent, id, entry, manifest, i18nValue, ctx) {
  const mock = resolveLayoutMock(entry, manifest);
  const schema =
    Object.keys(entry.loaders || {}).length > 0 ? buildPageSchema(entry, manifest) : null;
  const htmlPaths = schema ? collectHtmlPaths(schema) : new Set();
  const data = Object.keys(mock).length > 0 ? buildSentinelData(mock, "", htmlPaths) : {};

  // Wrap data with Proxy to detect schema/component field mismatches
  const accessed = new Set();
  const trackedData = Object.keys(data).length > 0 ? createAccessTracker(data, accessed) : data;

  function LayoutWithOutlet() {
    return createElement(LayoutComponent, null, createElement("seam-outlet", null));
  }
  const html = guardedRender(`layout:${id}`, LayoutWithOutlet, trackedData, i18nValue, ctx);

  const fieldWarnings = checkFieldAccess(accessed, schema, `layout:${id}`);
  for (const w of fieldWarnings) {
    const msg = `[seam] warning: ${w}`;
    if (!ctx.seenWarnings.has(msg)) {
      ctx.seenWarnings.add(msg);
      ctx.buildWarnings.push(msg);
    }
  }

  return html;
}

/** Flatten routes, annotating each leaf with its parent layout id */
function flattenRoutes(routes, currentLayout) {
  const leaves = [];
  for (const route of routes) {
    if (route.layout && route.children) {
      leaves.push(...flattenRoutes(route.children, toLayoutId(route.path)));
    } else if (route.children) {
      leaves.push(...flattenRoutes(route.children, currentLayout));
    } else {
      if (currentLayout) route._layoutId = currentLayout;
      leaves.push(route);
    }
  }
  return leaves;
}

export { toLayoutId, extractLayouts, resolveLayoutMock, renderLayout, flattenRoutes };
