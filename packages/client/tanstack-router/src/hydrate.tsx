/* packages/client/tanstack-router/src/hydrate.tsx */

import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { createSeamRouter } from "./create-router.js";
import type { HydrateOptions } from "./types.js";

export function seamHydrate(opts: HydrateOptions) {
  const { root, strict = true, ...routerOpts } = opts;
  const router = createSeamRouter(routerOpts);

  const app = <RouterProvider router={router} />;

  hydrateRoot(root, strict ? <StrictMode>{app}</StrictMode> : app);

  return router;
}
