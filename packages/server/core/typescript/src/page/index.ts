/* packages/server/core/typescript/src/page/index.ts */

export interface LoaderResult {
  procedure: string;
  input: unknown;
}

export type LoaderFn = (params: Record<string, string>) => LoaderResult;

export interface PageDef {
  template: string;
  loaders: Record<string, LoaderFn>;
}

export function definePage(config: PageDef): PageDef {
  return config;
}
