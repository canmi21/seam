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
}

export interface HydrateOptions extends SeamRouterOptions {
  root: HTMLElement;
  strict?: boolean;
}

/** Shared context passed to TanStack Router loaders via router.context */
export interface SeamRouterContext {
  seamRpc: (procedure: string, input?: unknown) => Promise<unknown>;
  _seamInitial: SeamInitialData | null;
}

export interface SeamInitialData {
  path: string | null;
  params: Record<string, string>;
  data: Record<string, unknown>;
  layouts: Record<string, Record<string, unknown>>;
  consumed: boolean;
  consumedLayouts: Set<string>;
}
