/* examples/github-dashboard/seam-app/src/server/router.ts */

import { createRouter } from "@canmi/seam-server";
import type { RouterOptions } from "@canmi/seam-server";
import { getHomeData, getUser, getUserRepos } from "./procedures.js";

export const procedures = { getHomeData, getUser, getUserRepos };

export function buildRouter(opts?: RouterOptions) {
  return createRouter(procedures, opts);
}

// Default router without pages (used by manifest extraction)
export const router = buildRouter();
