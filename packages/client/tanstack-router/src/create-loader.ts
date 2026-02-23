/* packages/client/tanstack-router/src/create-loader.ts */

import type { LoaderDef } from "@canmi/seam-react";
import type { SeamRouterContext } from "./types.js";

/** Build RPC input from loader definition and route params */
export function buildInput(
  def: LoaderDef,
  params: Record<string, string>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (def.params) {
    for (const [key, mapping] of Object.entries(def.params)) {
      const raw = params[key];
      input[key] = mapping.type === "int" ? Number(raw) : raw;
    }
  }
  return input;
}

/**
 * Create a TanStack Router loader function from declarative loader definitions.
 * On first load, returns data from __SEAM_DATA__ synchronously.
 * On SPA navigation, calls RPC endpoints in parallel.
 *
 * When layoutId is set, first-load uses _seamInitial.layouts[layoutId]
 * instead of _seamInitial.data (page-level data).
 */
export function createLoaderFromDefs(
  loaderDefs: Record<string, LoaderDef>,
  seamPath: string,
  layoutId?: string,
) {
  return async (ctx: { params: Record<string, string>; context: SeamRouterContext }) => {
    const initial = ctx.context._seamInitial;

    // First-load short-circuit: use __SEAM_DATA__ if available
    if (initial && layoutId) {
      // Layout loader: consume layout data once
      if (!initial.consumedLayouts.has(layoutId) && initial.layouts[layoutId]) {
        initial.consumedLayouts.add(layoutId);
        return initial.layouts[layoutId];
      }
    } else if (initial && !initial.consumed && initial.path === seamPath) {
      // Page loader: consume page data once
      initial.consumed = true;
      return initial.data;
    }

    // SPA navigation: call RPC for each loader in parallel
    const entries = Object.entries(loaderDefs);
    const results = await Promise.all(
      entries.map(async ([key, def]) => {
        const input = buildInput(def, ctx.params);
        const result = await ctx.context.seamRpc(def.procedure, input);
        return [key, result] as const;
      }),
    );

    return Object.fromEntries(results);
  };
}
