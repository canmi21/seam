/* packages/client/react/scripts/skeleton/schema.mjs */

import { buildSentinelData } from "@canmi/seam-react";
import {
  collectStructuralAxes,
  cartesianProduct,
  buildVariantSentinel,
} from "../variant-generator.mjs";
import {
  generateMockFromSchema,
  flattenLoaderMock,
  deepMerge,
  collectHtmlPaths,
  createAccessTracker,
  checkFieldAccess,
} from "../mock-generator.mjs";
import { SeamBuildError, guardedRender, stripResourceHints } from "./render.mjs";

/**
 * Merge loader procedure schemas from manifest into a combined page schema.
 * Each loader contributes its output schema fields to the top-level properties.
 */
function buildPageSchema(route, manifest) {
  if (!manifest) return null;

  const properties = {};

  for (const [loaderKey, loaderDef] of Object.entries(route.loaders || {})) {
    const procName = loaderDef.procedure;
    const proc = manifest.procedures?.[procName];
    if (!proc?.output) continue;

    // Always nest under the loader key so axis paths (e.g. "user.bio")
    // align with sentinel data paths built from mock (e.g. sentinel.user.bio).
    properties[loaderKey] = proc.output;
  }

  const result = {};
  if (Object.keys(properties).length > 0) result.properties = properties;
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Resolve mock data for a route: auto-generate from schema when available,
 * then deep-merge any user-provided partial mock on top.
 */
function resolveRouteMock(route, manifest) {
  const pageSchema = buildPageSchema(route, manifest);

  if (pageSchema) {
    const keyedMock = generateMockFromSchema(pageSchema);
    const autoMock = flattenLoaderMock(keyedMock);
    return route.mock ? deepMerge(autoMock, route.mock) : autoMock;
  }

  // No manifest (frontend-only mode) — mock is required
  if (route.mock) return route.mock;

  throw new SeamBuildError(
    `[seam] error: Mock data required for route "${route.path}"\n\n` +
      "  No procedure manifest found \u2014 cannot auto-generate mock data.\n" +
      "  Provide mock data in your route definition:\n\n" +
      "    defineRoutes([{\n" +
      `      path: "${route.path}",\n` +
      "      component: YourComponent,\n" +
      '      mock: { user: { name: "..." }, repos: [...] }\n' +
      "    }])\n\n" +
      "  Or switch to fullstack mode with typed Procedures\n" +
      "  to enable automatic mock generation from schema.",
  );
}

/**
 * Render a route: generate variants from structural axes, plus a mock-data render for CTR check.
 * @param {{ buildWarnings: string[], seenWarnings: Set<string> }} ctx - shared warning state
 */
function renderRoute(route, manifest, i18nValue, ctx) {
  const mock = resolveRouteMock(route, manifest);
  const pageSchema = buildPageSchema(route, manifest);
  const htmlPaths = pageSchema ? collectHtmlPaths(pageSchema) : new Set();
  const baseSentinel = buildSentinelData(mock, "", htmlPaths);
  const axes = pageSchema ? collectStructuralAxes(pageSchema, mock) : [];
  const combos = cartesianProduct(axes);

  const variants = combos.map((variant) => {
    const sentinel = buildVariantSentinel(baseSentinel, mock, variant);
    const html = guardedRender(route.path, route.component, sentinel, i18nValue, ctx);
    return { variant, html };
  });

  // Render with real mock data for CTR equivalence check.
  // Wrap mock with Proxy to track field accesses and detect schema mismatches.
  const accessed = new Set();
  const trackedMock = createAccessTracker(mock, accessed);
  const mockHtml = stripResourceHints(
    guardedRender(route.path, route.component, trackedMock, i18nValue, ctx),
  );

  const fieldWarnings = checkFieldAccess(accessed, pageSchema, route.path);
  for (const w of fieldWarnings) {
    const msg = `[seam] warning: ${w}`;
    if (!ctx.seenWarnings.has(msg)) {
      ctx.seenWarnings.add(msg);
      ctx.buildWarnings.push(msg);
    }
  }

  return {
    path: route.path,
    loaders: route.loaders,
    layout: route._layoutId || undefined,
    axes,
    variants,
    mockHtml,
    mock,
    pageSchema,
  };
}

export { buildPageSchema, resolveRouteMock, renderRoute };
