/* tests/e2e/fixture/src/server/procedures.ts */

import { t } from "@canmi/seam-server";
import type { ProcedureDef } from "@canmi/seam-server";

export const getHomeData: ProcedureDef = {
  input: t.object({}),
  output: t.object({
    title: t.string(),
    message: t.string(),
  }),
  handler: () => ({
    title: "E2E Fixture",
    message: "Hydration test page.",
  }),
};

export const getReact19Data: ProcedureDef = {
  input: t.object({}),
  output: t.object({
    heading: t.string(),
    description: t.string(),
  }),
  handler: () => ({
    heading: "React 19 Features",
    description: "Demonstrating useId, Suspense, useState, useRef, useMemo, and metadata hoisting.",
  }),
};
