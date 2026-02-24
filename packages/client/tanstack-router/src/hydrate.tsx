/* packages/client/tanstack-router/src/hydrate.tsx */

import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { configureRpcMap } from "@canmi/seam-client";
import { createSeamRouter } from "./create-router.js";
import { setupLinkInterception } from "./link-interceptor.js";
import type { HydrateOptions } from "./types.js";

export async function seamHydrate(opts: HydrateOptions) {
  const { root, strict = true, ...routerOpts } = opts;

  // Auto-configure RPC hash map from build-time embedded data
  if (typeof document !== "undefined") {
    const el = document.getElementById("__SEAM_RPC_MAP__");
    if (el?.textContent) {
      const map = JSON.parse(el.textContent) as {
        procedures: Record<string, string>;
        batch: string;
      };
      configureRpcMap({ ...map.procedures, _batch: map.batch });
    }
  }

  const router = createSeamRouter(routerOpts);

  setupLinkInterception(router);

  // SSR hack prevents RouterProvider from calling router.load() automatically,
  // so we must load before hydration to populate route matches.
  await router.load();

  const app = <RouterProvider router={router} />;

  hydrateRoot(root, strict ? <StrictMode>{app}</StrictMode> : app);

  return router;
}
