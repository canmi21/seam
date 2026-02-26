/* packages/server/engine/js/src/wasm-bridge.ts */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  __wbg_set_wasm,
  __wbindgen_init_externref_table,
  render_page as wasmRenderPage,
  parse_build_output as wasmParseBuildOutput,
  parse_i18n_config as wasmParseI18nConfig,
  parse_rpc_hash_map as wasmParseRpcHashMap,
  ascii_escape_json as wasmAsciiEscapeJson,
  i18n_query as wasmI18nQuery,
  inject as wasmInject,
  inject_no_script as wasmInjectNoScript,
} from "../pkg/engine.js";

export interface InjectOptions {
  skipDataScript?: boolean;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(__dirname, "../pkg/engine.wasm");
const wasmBytes = readFileSync(wasmPath);

const wasmModule = new WebAssembly.Module(wasmBytes);
const wasmInstance = new WebAssembly.Instance(wasmModule, {
  "./seam_engine_wasm_bg.js": {
    __wbindgen_init_externref_table,
  },
});
__wbg_set_wasm(wasmInstance.exports);
const start = wasmInstance.exports.__wbindgen_start as () => void;
start();

// --- Engine functions ---

export function renderPage(
  template: string,
  loaderDataJson: string,
  configJson: string,
  i18nOptsJson?: string,
): string {
  return wasmRenderPage(template, loaderDataJson, configJson, i18nOptsJson ?? "");
}

export function parseBuildOutput(manifestJson: string): string {
  return wasmParseBuildOutput(manifestJson);
}

export function parseI18nConfig(manifestJson: string): string {
  return wasmParseI18nConfig(manifestJson);
}

export function parseRpcHashMap(hashMapJson: string): string {
  return wasmParseRpcHashMap(hashMapJson);
}

export function asciiEscapeJson(json: string): string {
  return wasmAsciiEscapeJson(json);
}

export function i18nQuery(
  keysJson: string,
  locale: string,
  defaultLocale: string,
  messagesJson: string,
): string {
  return wasmI18nQuery(keysJson, locale, defaultLocale, messagesJson);
}

// --- Injector functions (re-exported for convenience) ---

export function inject(
  template: string,
  data: Record<string, unknown>,
  options?: InjectOptions,
): string {
  const json = JSON.stringify(data);
  if (options?.skipDataScript) {
    return wasmInjectNoScript(template, json);
  }
  return wasmInject(template, json);
}

export function injectNoScript(template: string, dataJson: string): string {
  return wasmInjectNoScript(template, dataJson);
}
