/* packages/server/injector/js/src/wasm-bridge.ts */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  __wbg_set_wasm,
  __wbindgen_init_externref_table,
  inject as wasmInject,
  inject_no_script as wasmInjectNoScript,
} from "../pkg/seam_injector_wasm_bg.js";

export interface InjectOptions {
  skipDataScript?: boolean;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(__dirname, "../pkg/seam_injector_wasm_bg.wasm");
const wasmBytes = readFileSync(wasmPath);

const wasmModule = new WebAssembly.Module(wasmBytes);
const wasmInstance = new WebAssembly.Instance(wasmModule, {
  "./seam_injector_wasm_bg.js": {
    __wbindgen_init_externref_table,
  },
});
__wbg_set_wasm(wasmInstance.exports);
const start = wasmInstance.exports.__wbindgen_start as () => void;
start();

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
