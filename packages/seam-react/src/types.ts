import type { ComponentType } from "react";

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
  component: ComponentType<any>;
  loaders: Record<string, LoaderDef>;
  mock: Record<string, unknown>;
  nullable?: string[];
}
