/* packages/server/core/typescript/src/page/handler.ts */

import { inject, escapeHtml } from "@canmi/seam-injector";
import { SeamError } from "../errors.js";
import type { InternalProcedure } from "../procedure.js";
import type { PageDef, LoaderFn } from "./index.js";

export interface PageTiming {
  /** Procedure execution time in milliseconds */
  dataFetch: number;
  /** Template injection time in milliseconds */
  inject: number;
}

export interface HandlePageResult {
  status: number;
  html: string;
  timing?: PageTiming;
}

/** Flatten keyed loader results: spread object values into a flat map for slot resolution */
function flattenForSlots(keyed: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...keyed };
  for (const value of Object.values(keyed)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(merged, value as Record<string, unknown>);
    }
  }
  return merged;
}

/** Execute loaders, returning keyed results */
async function executeLoaders(
  loaders: Record<string, LoaderFn>,
  params: Record<string, string>,
  procedures: Map<string, InternalProcedure>,
): Promise<Record<string, unknown>> {
  const entries = Object.entries(loaders);
  const results = await Promise.all(
    entries.map(async ([key, loader]) => {
      const { procedure, input } = loader(params);
      const proc = procedures.get(procedure);
      if (!proc) throw new SeamError("INTERNAL_ERROR", `Procedure '${procedure}' not found`);
      // Skip JTD validation -- loader input is trusted server-side code
      const result = await proc.handler({ input });
      return [key, result] as const;
    }),
  );
  return Object.fromEntries(results);
}

/** Split-inject a layout template around its outlet marker */
function injectLayout(template: string, data: Record<string, unknown>, inner: string): string {
  const outletMarker = "<!--seam:outlet-->";
  const outletIdx = template.indexOf(outletMarker);
  if (outletIdx === -1) {
    return inject(template, data, { skipDataScript: true });
  }
  const before = template.slice(0, outletIdx);
  const after = template.slice(outletIdx + outletMarker.length);
  const injectedBefore = inject(before, data, { skipDataScript: true });
  const injectedAfter = inject(after, data, { skipDataScript: true });
  return injectedBefore + inner + injectedAfter;
}

export async function handlePageRequest(
  page: PageDef,
  params: Record<string, string>,
  procedures: Map<string, InternalProcedure>,
): Promise<HandlePageResult> {
  try {
    const t0 = performance.now();

    // Execute all loaders (layout chain + page) in parallel
    const loaderResults = await Promise.all([
      ...page.layoutChain.map((layout) => executeLoaders(layout.loaders, params, procedures)),
      executeLoaders(page.loaders, params, procedures),
    ]);

    const t1 = performance.now();

    // Partition: first N results are layout, last is page
    const layoutResults = loaderResults.slice(0, page.layoutChain.length);
    const pageKeyed = loaderResults[loaderResults.length - 1];

    // Inject page template
    let innerContent = inject(page.template, flattenForSlots(pageKeyed), { skipDataScript: true });

    // Compose layouts from innermost to outermost
    const layoutKeyed: Record<string, Record<string, unknown>> = {};
    for (let i = page.layoutChain.length - 1; i >= 0; i--) {
      const layout = page.layoutChain[i];
      const data = layoutResults[i];
      layoutKeyed[layout.id] = data;
      innerContent = injectLayout(layout.template, flattenForSlots(data), innerContent);
    }

    // Build __SEAM_DATA__: page data at top level, layout data under _layouts
    const seamData: Record<string, unknown> = { ...pageKeyed };
    if (Object.keys(layoutKeyed).length > 0) {
      seamData._layouts = layoutKeyed;
    }

    const script = `<script id="__SEAM_DATA__" type="application/json">${JSON.stringify(seamData)}</script>`;
    const bodyClose = innerContent.lastIndexOf("</body>");
    let html: string;
    if (bodyClose !== -1) {
      html = innerContent.slice(0, bodyClose) + script + innerContent.slice(bodyClose);
    } else {
      html = innerContent + script;
    }

    const t2 = performance.now();

    return {
      status: 200,
      html,
      timing: { dataFetch: t1 - t0, inject: t2 - t1 },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      status: 500,
      html: `<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1><p>${escapeHtml(message)}</p></body></html>`,
    };
  }
}
