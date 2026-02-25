/* examples/github-dashboard/backends/ts-hono/src/router.ts */

import { createRouter } from "@canmi/seam-server";
import type { RouterOptions } from "@canmi/seam-server";
import { getSession, getHomeData, getUser, getUserRepos } from "./procedures.js";

export const procedures = { getSession, getHomeData, getUser, getUserRepos };

export function buildRouter(opts?: RouterOptions) {
  return createRouter(procedures, opts);
}

// Default router without pages (used by manifest extraction)
export const router = buildRouter();
