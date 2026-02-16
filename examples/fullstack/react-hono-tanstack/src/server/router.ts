/* examples/fullstack/react-hono-tanstack/src/server/router.ts */

import { createRouter } from "@canmi/seam-server";
import type { RouterOptions } from "@canmi/seam-server";
import {
  getMessages,
  addMessage,
  getAboutData,
  getPosts,
  getReact19Data,
  getPageData,
} from "./procedures.js";
import { onMessage } from "./subscriptions.js";

export const procedures = {
  getMessages,
  addMessage,
  getAboutData,
  getPosts,
  getReact19Data,
  getPageData,
  onMessage,
};

export function buildRouter(opts?: RouterOptions) {
  return createRouter(procedures, opts);
}

// Default router without pages (used by manifest extraction)
export const router = buildRouter();
