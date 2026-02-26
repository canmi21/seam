/* packages/server/engine/js/pkg/engine.wasm.d.ts */

/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const ascii_escape_json: (a: number, b: number) => [number, number];
export const i18n_query: (
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
  g: number,
  h: number,
) => [number, number];
export const inject: (a: number, b: number, c: number, d: number) => [number, number];
export const inject_no_script: (a: number, b: number, c: number, d: number) => [number, number];
export const parse_build_output: (a: number, b: number) => [number, number];
export const parse_i18n_config: (a: number, b: number) => [number, number];
export const parse_rpc_hash_map: (a: number, b: number) => [number, number];
export const render_page: (
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
  g: number,
  h: number,
) => [number, number];
export const __wbindgen_externrefs: WebAssembly.Table;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_start: () => void;
