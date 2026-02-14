/* packages/seam-react/src/index.ts */

export { defineRoutes } from "./define-routes.js";
export { useSeamData, setSSRData, clearSSRData } from "./use-seam-data.js";
export { buildSentinelData } from "./sentinel.js";

export type { RouteDef, LoaderDef, ParamMapping } from "./types.js";
