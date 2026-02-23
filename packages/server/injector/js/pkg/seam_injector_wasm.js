/* packages/server/injector/wasm/pkg/seam_injector_wasm.js */

import * as wasm from "./seam_injector_wasm_bg.wasm";
import { __wbg_set_wasm } from "./seam_injector_wasm_bg.js";
__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    inject, inject_no_script
} from "./seam_injector_wasm_bg.js";