/* packages/server/engine/js/pkg/seam_engine_wasm.js */

import * as wasm from "./seam_engine_wasm_bg.wasm";
import { __wbg_set_wasm } from "./seam_engine_wasm_bg.js";
__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
  ascii_escape_json,
  i18n_query,
  inject,
  inject_no_script,
  parse_build_output,
  parse_i18n_config,
  parse_rpc_hash_map,
  render_page,
} from "./seam_engine_wasm_bg.js";
