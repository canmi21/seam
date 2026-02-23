/* packages/client/tanstack-router/src/create-router.ts */

import {
  createRouter as createTanStackRouter,
  createRootRoute,
  createRoute,
} from "@tanstack/react-router";
import type { AnyRoute } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { seamRpc } from "@canmi/seam-client";
import type { RouteDef } from "@canmi/seam-react";
import { parseSeamData } from "@canmi/seam-react";
import { SeamOutlet, createLayoutWrapper } from "./seam-outlet.js";
import { convertPath } from "./convert-routes.js";
import { createLoaderFromDefs } from "./create-loader.js";
import { matchSeamRoute } from "./route-matcher.js";
import { SeamDataBridge } from "./seam-data-bridge.js";
import type { SeamRouteDef, SeamRouterOptions, SeamRouterContext } from "./types.js";

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
      // Layout node — pathless route that wraps children
      const layoutRoute = createRoute({
        getParentRoute: () => parent,
        id: `_layout_${def.path}`,
        component: createLayoutWrapper(def.layout),
      });
      const children = buildRoutes(def.children, layoutRoute, pages);
      return layoutRoute.addChildren(children);
    }

    // Leaf node — page route
    return createRoute({
      getParentRoute: () => parent,
      path: convertPath(def.path),
      component: pages?.[def.path] ?? (def.component as ComponentType),
      loader: def.clientLoader
        ? ({ params, context }) =>
            def.clientLoader!({
              params,
              seamRpc: (context as SeamRouterContext).seamRpc,
            })
        : createLoaderFromDefs(def.loaders ?? {}, def.path),
    });
  });
}

export function createSeamRouter(opts: SeamRouterOptions) {
  const { routes, pages, defaultStaleTime = 30_000 } = opts;

  // Parse initial data from __SEAM_DATA__ (browser only)
  let initialData: Record<string, unknown> | null = null;
  let initialPath: string | null = null;
  let initialParams: Record<string, string> = {};

  if (typeof document !== "undefined") {
    try {
      const raw = parseSeamData();
      // Unwrap: single "page" loader gets flattened
      initialData = raw.page ?? raw;
      const matched = matchSeamRoute(collectLeafPaths(routes), window.location.pathname);
      if (matched) {
        initialPath = matched.path;
        initialParams = matched.params;
      }
    } catch {
      // No __SEAM_DATA__ — not a CTR page
    }
  }

  // SeamOutlet skips the <Suspense> wrapper that standard Outlet adds for root
  // routes — CTR HTML has no Suspense markers so the wrapper causes hydration mismatch.
  const rootRoute = createRootRoute({
    component: SeamOutlet,
  });

  const childRoutes = buildRoutes(routes, rootRoute, pages);
  const routeTree = rootRoute.addChildren(childRoutes);

  const context: SeamRouterContext = {
    seamRpc,
    _seamInitial: initialData
      ? { path: initialPath, params: initialParams, data: initialData, consumed: false }
      : null,
  };

  const router = createTanStackRouter({
    routeTree,
    defaultStaleTime,
    context: context as Record<string, unknown>,
    InnerWrap: SeamDataBridge,
  });

  // Bypass Suspense in <Matches> — CTR HTML has no Suspense markers
  (router as unknown as { ssr: unknown }).ssr = { manifest: undefined };

  return router;
}
