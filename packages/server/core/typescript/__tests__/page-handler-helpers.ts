/* packages/server/core/typescript/__tests__/page-handler-helpers.ts */

import type { InternalProcedure } from "../src/procedure.js";
import type { PageDef } from "../src/page/index.js";

export function makeProcedures(...entries: [string, InternalProcedure][]) {
  return new Map(entries);
}

export function mockProcedure(handler: InternalProcedure["handler"]): InternalProcedure {
  return { inputSchema: {}, outputSchema: {}, handler };
}

export function simplePage(template: string, loaders: PageDef["loaders"]): PageDef {
  return { template, loaders, layoutChain: [] };
}

/** Extract __SEAM_DATA__ JSON from rendered HTML */
export function extractSeamData(html: string, dataId = "__SEAM_DATA__"): Record<string, unknown> {
  const re = new RegExp(`<script id="${dataId}" type="application/json">(.*?)</script>`);
  const match = html.match(re);
  if (!match) throw new Error(`${dataId} script not found`);
  return JSON.parse(match[1]);
}
