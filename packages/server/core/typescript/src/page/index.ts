/* packages/server/core/typescript/src/page/index.ts */

export interface LoaderResult {
  procedure: string;
  input: unknown;
}

export type LoaderFn = (params: Record<string, string>) => LoaderResult;

export interface LayoutDef {
  id: string;
  template: string;
  localeTemplates?: Record<string, string>;
  loaders: Record<string, LoaderFn>;
  i18nKeys?: string[];
}

export interface PageDef {
  template: string;
  localeTemplates?: Record<string, string>;
  loaders: Record<string, LoaderFn>;
  layoutChain?: LayoutDef[];
  headMeta?: string;
  dataId?: string;
  i18nKeys?: string[];
}

export interface I18nConfig {
  locales: string[];
  default: string;
  messages: Record<string, Record<string, string>>;
  versions?: Record<string, string>;
}

export function definePage(config: PageDef): PageDef {
  return { ...config, layoutChain: config.layoutChain ?? [] };
}
