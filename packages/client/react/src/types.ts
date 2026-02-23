/* packages/client/react/src/types.ts */

import type { ComponentType, ReactNode } from "react";

export interface ParamMapping {
  from: "route";
  type?: "string" | "int";
}

export interface LoaderDef {
  procedure: string;
  params?: Record<string, ParamMapping>;
}

export interface RouteDef {
  path: string;
  component?: ComponentType<Record<string, unknown>>;
  layout?: ComponentType<{ children: ReactNode }>;
  children?: RouteDef[];
  loaders?: Record<string, LoaderDef>;
  mock?: Record<string, unknown>;
  nullable?: string[];
}
