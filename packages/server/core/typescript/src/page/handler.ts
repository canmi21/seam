/* packages/server/core/typescript/src/page/handler.ts */

import { inject, escapeHtml } from "@canmi/seam-injector";
import { SeamError } from "../errors.js";
import type { InternalProcedure } from "../procedure.js";
import type { PageDef, LayoutDef } from "./index.js";

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

export async function handlePageRequest(
  page: PageDef,
  params: Record<string, string>,
  procedures: Map<string, InternalProcedure>,
): Promise<HandlePageResult> {
  try {
    const t0 = performance.now();

    // Collect all loaders from layout chain + page, execute in parallel
    const layoutEntries: { layout: LayoutDef; entries: [string, unknown][] }[] = [];
    const allPromises: Promise<{ source: "layout"; layoutIdx: number; key: string; result: unknown } | { source: "page"; key: string; result: unknown }>[] = [];

    for (let i = 0; i < page.layoutChain.length; i++) {
      const layout = page.layoutChain[i];
      layoutEntries.push({ layout, entries: [] });
      for (const [key, loader] of Object.entries(layout.loaders)) {
        const { procedure, input } = loader(params);
        const proc = procedures.get(procedure);
        if (!proc) throw new SeamError("INTERNAL_ERROR", `Procedure '${procedure}' not found`);
        allPromises.push(
          proc.handler({ input }).then((result) => ({ source: "layout" as const, layoutIdx: i, key, result })),
        );
      }
    }

    for (const [key, loader] of Object.entries(page.loaders)) {
      const { procedure, input } = loader(params);
      const proc = procedures.get(procedure);
      if (!proc) throw new SeamError("INTERNAL_ERROR", `Procedure '${procedure}' not found`);
      allPromises.push(
        proc.handler({ input }).then((result) => ({ source: "page" as const, key, result })),
      );
    }

    const results = await Promise.all(allPromises);

    const t1 = performance.now();

    // Partition results into layout-keyed and page-keyed
    const layoutKeyed: Record<string, Record<string, unknown>> = {};
    const pageKeyed: Record<string, unknown> = {};

    for (const r of results) {
      if (r.source === "layout") {
        const layoutId = page.layoutChain[r.layoutIdx].id;
        if (!layoutKeyed[layoutId]) layoutKeyed[layoutId] = {};
        layoutKeyed[layoutId][r.key] = r.result;
      } else {
        pageKeyed[r.key] = r.result;
      }
    }

    // Inject page template with page merged data
    const pageMerged: Record<string, unknown> = { ...pageKeyed };
    for (const value of Object.values(pageKeyed)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        Object.assign(pageMerged, value as Record<string, unknown>);
      }
    }
    let innerContent = inject(page.template, pageMerged, { skipDataScript: true });

    // Compose layouts from innermost to outermost
    for (let i = page.layoutChain.length - 1; i >= 0; i--) {
      const layout = page.layoutChain[i];
      const layoutData = layoutKeyed[layout.id] ?? {};

      // Flatten layout data for slot resolution
      const layoutMerged: Record<string, unknown> = { ...layoutData };
      for (const value of Object.values(layoutData)) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          Object.assign(layoutMerged, value as Record<string, unknown>);
        }
      }

      // Split template on <!--seam:outlet--> to avoid inject eating the marker
      const outletMarker = "<!--seam:outlet-->";
      const outletIdx = layout.template.indexOf(outletMarker);
      if (outletIdx === -1) {
        // No outlet — inject the whole template (unusual but safe)
        innerContent = inject(layout.template, layoutMerged, { skipDataScript: true });
      } else {
        const before = layout.template.slice(0, outletIdx);
        const after = layout.template.slice(outletIdx + outletMarker.length);
        const injectedBefore = inject(before, layoutMerged, { skipDataScript: true });
        const injectedAfter = inject(after, layoutMerged, { skipDataScript: true });
        innerContent = injectedBefore + innerContent + injectedAfter;
      }
    }

    // Build __SEAM_DATA__: layout data under _layouts key, page data at top level
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
