/* src/client/tanstack-router/src/create-router.ts */

import {
  createRouter as createTanStackRouter,
  createRootRouteWithContext,
  createRoute,
} from "@tanstack/react-router";
import type { AnyRoute } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { seamRpc } from "@canmi/seam-client";
import type { RouteDef } from "@canmi/seam-react";
import { parseSeamData } from "@canmi/seam-react";
import { SeamOutlet, createLayoutWrapper, createPageWrapper } from "./seam-outlet.js";
import { convertPath } from "./convert-routes.js";
import { createLoaderFromDefs } from "./create-loader.js";
import { matchSeamRoute } from "./route-matcher.js";
import { SeamCoreBridge } from "./seam-core-bridge.js";
import type { SeamRouteDef, SeamRouterOptions, SeamRouterContext, SeamI18nMeta } from "./types.js";

/** Extract all leaf paths from a potentially nested route tree */
function collectLeafPaths(defs: RouteDef[]): string[] {
  const paths: string[] = [];
  for (const d of defs) {
    if (d.children) paths.push(...collectLeafPaths(d.children));
    else paths.push(d.path);
  }
  return paths;
}

/** Recursively build TanStack Router route tree from SeamJS route definitions */
function buildRoutes(
  defs: SeamRouteDef[],
  parent: AnyRoute,
  pages?: Record<string, ComponentType>,
): AnyRoute[] {
  return defs.map((def) => {
    if (def.layout && def.children) {
      // Layout node — pathless route that wraps children.
      // ID must not end with "/" to avoid colliding with index child route
      // after TanStack Router's joinPaths + cleanPath normalization.
      const segment =
        def.path === "/" ? "root" : def.path.replace(/^\/|\/$/g, "").replace(/\//g, "-");
      const layoutId = `_layout_${segment}`;
      const hasLoaders = def.loaders && Object.keys(def.loaders).length > 0;
      const layoutRoute = createRoute({
        getParentRoute: () => parent,
        id: layoutId,
        component: createLayoutWrapper(def.layout, hasLoaders),
        loader: hasLoaders ? createLoaderFromDefs(def.loaders!, def.path, layoutId) : undefined,
        staleTime: def.staleTime,
      });
      const children = buildRoutes(def.children, layoutRoute, pages);
      return layoutRoute.addChildren(children);
    }

    // Leaf node — page route, wrapped with SeamDataProvider for scoped useSeamData()
    const pageComponent = pages?.[def.path] ?? (def.component as ComponentType);
    return createRoute({
      getParentRoute: () => parent,
      path: convertPath(def.path),
      component: createPageWrapper(pageComponent),
      loader: def.clientLoader
        ? ({ params, context }: { params: Record<string, string>; context: unknown }) => {
            const ctx = context as SeamRouterContext;
            return def.clientLoader!({ params, seamRpc: ctx.seamRpc });
          }
        : createLoaderFromDefs(def.loaders ?? {}, def.path),
      staleTime: def.staleTime,
    });
  });
}

export function createSeamRouter(opts: SeamRouterOptions) {
  const { routes, pages, defaultStaleTime = 30_000, dataId, cleanLocaleQuery } = opts;

  // Parse initial data from __data (browser only)
  let initialData: Record<string, unknown> | null = null;
  let initialLayouts: Record<string, Record<string, unknown>> = {};
  let initialPath: string | null = null;
  let initialParams: Record<string, string> = {};
  let initialI18n: SeamI18nMeta | null = null;

  // Detect locale prefix from URL (e.g. /zh/about -> locale "zh", bare "/about")
  let localeBasePath = "";

  if (typeof document !== "undefined") {
    try {
      const raw = parseSeamData(dataId);
      // Extract layout data stored under _layouts key
      if (raw._layouts && typeof raw._layouts === "object") {
        initialLayouts = raw._layouts as Record<string, Record<string, unknown>>;
      }
      // Page data is everything except _layouts and _i18n
      const { _layouts: _, _i18n: rawI18n, ...pageData } = raw;
      initialI18n = (rawI18n as SeamI18nMeta) ?? null;
      // Unwrap: single "page" loader gets flattened
      initialData = (pageData.page ?? pageData) as Record<string, unknown>;

      // Detect locale prefix: if URL starts with /{locale}/ and i18n data is present
      if (initialI18n) {
        const prefix = `/${initialI18n.locale}`;
        const pathname = window.location.pathname;
        if (pathname === prefix || pathname.startsWith(prefix + "/")) {
          localeBasePath = prefix;
        }
      }

      // Strip locale prefix before matching routes
      let matchPathname = window.location.pathname;
      if (localeBasePath) {
        matchPathname = matchPathname.slice(localeBasePath.length) || "/";
      }
      const matched = matchSeamRoute(collectLeafPaths(routes), matchPathname);
      if (matched) {
        initialPath = matched.path;
        initialParams = matched.params;
      }
    } catch {
      // No __data — not a CTR page
    }
  }

  // SeamOutlet skips the <Suspense> wrapper that standard Outlet adds for root
  // routes — CTR HTML has no Suspense markers so the wrapper causes hydration mismatch.
  const rootRoute = createRootRouteWithContext<SeamRouterContext>()({
    component: SeamOutlet,
  });

  const childRoutes = buildRoutes(routes, rootRoute, pages);
  const routeTree = rootRoute.addChildren(childRoutes);

  const leafPaths = collectLeafPaths(routes);

  const context: SeamRouterContext = {
    seamRpc,
    _seamInitial: initialData
      ? {
          path: initialPath,
          params: initialParams,
          data: initialData,
          layouts: initialLayouts,
          consumed: false,
          consumedLayouts: new Set(),
        }
      : null,
    _seamI18n: initialI18n,
    _seamLeafPaths: leafPaths,
    _cleanLocaleQuery:
      cleanLocaleQuery === true
        ? "lang"
        : cleanLocaleQuery === false || cleanLocaleQuery === undefined
          ? false
          : cleanLocaleQuery,
  };

  const router = createTanStackRouter({
    routeTree,
    defaultStaleTime,
    context,
    basepath: localeBasePath || undefined,
    InnerWrap: opts.i18nBridge ?? SeamCoreBridge,
  });

  // Bypass Suspense in <Matches> — CTR HTML has no Suspense markers
  (router as unknown as { ssr: unknown }).ssr = { manifest: undefined };

  return router;
}
