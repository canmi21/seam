/* examples/i18n-demo/seam-app/src/server/router.ts */

import { createRouter, t } from "@canmi/seam-server";
import type { ProcedureDef, RouterOptions } from "@canmi/seam-server";

const getContent: ProcedureDef = {
  input: t.object({}),
  output: t.object({ mode: t.string() }),
  handler: () => ({ mode: "prefix" }),
};

export const procedures = { getContent };

export function buildRouter(opts?: RouterOptions) {
  return createRouter(procedures, opts);
}

export const router = buildRouter();
