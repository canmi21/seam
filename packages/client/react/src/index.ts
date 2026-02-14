/* packages/client/react/src/index.ts */

export { defineRoutes } from "./define-routes.js";
export { useSeamData, setSSRData, clearSSRData } from "./use-seam-data.js";
export { buildSentinelData } from "./sentinel.js";
export { useSeamSubscription } from "./use-seam-subscription.js";

export type { RouteDef, LoaderDef, ParamMapping } from "./types.js";
export type { UseSeamSubscriptionResult, SubscriptionStatus } from "./use-seam-subscription.js";
