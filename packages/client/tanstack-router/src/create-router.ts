/* packages/client/tanstack-router/src/create-router.ts */

import {
  createRouter as createTanStackRouter,
  createRootRoute,
  createRoute,
} from "@tanstack/react-router";
import { seamRpc } from "@canmi/seam-client";
import { parseSeamData } from "@canmi/seam-react";
import { SeamOutlet } from "./seam-outlet.js";
import { convertPath } from "./convert-routes.js";
import { createLoaderFromDefs } from "./create-loader.js";
import { matchSeamRoute } from "./route-matcher.js";
import { SeamDataBridge } from "./seam-data-bridge.js";
import type { SeamRouterOptions, SeamRouterContext } from "./types.js";

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
      const matched = matchSeamRoute(
        routes.map((r) => r.path),
        window.location.pathname,
      );
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

  const childRoutes = routes.map((def) => {
    const tanstackPath = convertPath(def.path);

    return createRoute({
      getParentRoute: () => rootRoute,
      path: tanstackPath,
      component: pages?.[def.path] ?? def.component,
      loader: def.clientLoader
        ? ({ params, context }) =>
            def.clientLoader!({
              params,
              seamRpc: (context as SeamRouterContext).seamRpc,
            })
        : createLoaderFromDefs(def.loaders, def.path),
    });
  });

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
