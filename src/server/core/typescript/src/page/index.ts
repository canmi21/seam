/* src/server/core/typescript/src/page/index.ts */

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
  mode: "memory" | "paged";
  cache: boolean;
  routeHashes: Record<string, string>;
  contentHashes: Record<string, Record<string, string>>;
  /** Memory mode: locale → routeHash → messages */
  messages: Record<string, Record<string, Record<string, string>>>;
  /** Paged mode: base directory for on-demand reads */
  distDir?: string;
}

export function definePage(config: PageDef): PageDef {
  return { ...config, layoutChain: config.layoutChain ?? [] };
}
