/* examples/fs-router-demo/src/server/router.ts */

import { createRouter } from "@canmi/seam-server";
import type { RouterOptions } from "@canmi/seam-server";
import { getPageData, getBlogPost, getSession } from "./procedures.js";

export const procedures = { getPageData, getBlogPost, getSession };

export function buildRouter(opts?: RouterOptions) {
  return createRouter(procedures, opts);
}

export const router = buildRouter();
