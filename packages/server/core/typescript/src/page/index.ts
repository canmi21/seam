/* packages/server/core/typescript/src/page/index.ts */

export interface LoaderResult {
  procedure: string;
  input: unknown;
}

export type LoaderFn = (params: Record<string, string>) => LoaderResult;

export interface LayoutDef {
  id: string;
  template: string;
  loaders: Record<string, LoaderFn>;
}

export interface PageDef {
  template: string;
  loaders: Record<string, LoaderFn>;
  layoutChain?: LayoutDef[];
  headMeta?: string;
}

export function definePage(config: PageDef): PageDef {
  return { ...config, layoutChain: config.layoutChain ?? [] };
}
