/* tests/e2e/fixture/src/server/router.ts */

import { createRouter } from "@canmi/seam-server";
import type { RouterOptions } from "@canmi/seam-server";
import { getHomeData, getReact19Data } from "./procedures.js";

export const procedures = { getHomeData, getReact19Data };

export function buildRouter(opts?: RouterOptions) {
  return createRouter(procedures, opts);
}

// Default router without pages (used by manifest extraction)
export const router = buildRouter();
