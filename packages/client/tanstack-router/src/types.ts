/* packages/client/tanstack-router/src/types.ts */

import type { ComponentType } from "react";
import type { RouteDef } from "@canmi/seam-react";

export interface SeamRouteDef extends RouteDef {
  children?: SeamRouteDef[];
  clientLoader?: ClientLoaderFn;
}

export type ClientLoaderFn = (ctx: {
  params: Record<string, string>;
  seamRpc: (procedure: string, input?: unknown) => Promise<unknown>;
}) => Promise<unknown>;

export interface SeamRouterOptions {
  routes: SeamRouteDef[];
  /** Runtime-only page components keyed by route path (e.g. "/dashboard/:username") */
  pages?: Record<string, ComponentType>;
  defaultStaleTime?: number;
  basePath?: string;
  dataId?: string;
}

export interface HydrateOptions extends SeamRouterOptions {
  root: HTMLElement;
  strict?: boolean;
}

/** Parsed i18n metadata from initial __SEAM_DATA__._i18n */
export interface SeamI18nMeta {
  locale: string;
  messages: Record<string, string>;
  hash?: string;
  /** Content hash router table (present when cache is enabled) */
  router?: Record<string, Record<string, string>>;
}

/** Shared context passed to TanStack Router loaders via router.context */
export interface SeamRouterContext {
  seamRpc: (procedure: string, input?: unknown) => Promise<unknown>;
  _seamInitial: SeamInitialData | null;
  _seamI18n?: SeamI18nMeta | null;
  /** All leaf route patterns (seam format: /user/:id) for SPA route matching */
  _seamLeafPaths?: string[];
}

export interface SeamInitialData {
  path: string | null;
  params: Record<string, string>;
  data: Record<string, unknown>;
  layouts: Record<string, Record<string, unknown>>;
  consumed: boolean;
  consumedLayouts: Set<string>;
}
