/* packages/server/injector/wasm/src/lib.rs */

use serde_json::Value;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn inject(template: &str, data_json: &str) -> String {
  let data: Value = serde_json::from_str(data_json).unwrap_or(Value::Null);
  seam_injector::inject(template, &data)
}

#[wasm_bindgen]
pub fn inject_no_script(template: &str, data_json: &str) -> String {
  let data: Value = serde_json::from_str(data_json).unwrap_or(Value::Null);
  seam_injector::inject_no_script(template, &data)
}
