/* src/client/react/src/types.ts */

import type { ComponentType, ReactNode } from "react";

export interface ParamMapping {
  from: "route";
  type?: "string" | "int";
}

export interface LoaderDef {
  procedure: string;
  params?: Record<string, ParamMapping>;
}

/** Lazy component loader returned by dynamic import (per-page splitting) */
export type LazyComponentLoader = () => Promise<{
  default: ComponentType<Record<string, unknown>>;
  [key: string]: unknown;
}>;

export interface RouteDef {
  path: string;
  component?: ComponentType<Record<string, unknown>> | LazyComponentLoader;
  layout?: ComponentType<{ children: ReactNode }>;
  children?: RouteDef[];
  loaders?: Record<string, LoaderDef>;
  mock?: Record<string, unknown>;
  nullable?: string[];
  staleTime?: number;
}
