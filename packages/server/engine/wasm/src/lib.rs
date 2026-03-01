/* packages/server/engine/wasm/src/lib.rs */

use serde_json::Value;
use wasm_bindgen::prelude::*;

// --- Engine functions ---

#[wasm_bindgen]
pub fn render_page(
  template: &str,
  loader_data_json: &str,
  config_json: &str,
  i18n_opts_json: &str,
) -> String {
  let i18n = if i18n_opts_json.is_empty() { None } else { Some(i18n_opts_json) };
  seam_engine::render_page(template, loader_data_json, config_json, i18n)
}

#[wasm_bindgen]
pub fn parse_build_output(manifest_json: &str) -> String {
  match seam_engine::parse_build_output(manifest_json) {
    Ok(pages) => serde_json::to_string(&pages).unwrap_or_else(|_| "[]".to_string()),
    Err(e) => format!(r#"{{"error":"{}"}}"#, e),
  }
}

#[wasm_bindgen]
pub fn parse_i18n_config(manifest_json: &str) -> String {
  match seam_engine::parse_i18n_config(manifest_json) {
    Some(config) => serde_json::to_string(&config).unwrap_or_else(|_| "null".to_string()),
    None => "null".to_string(),
  }
}

#[wasm_bindgen]
pub fn parse_rpc_hash_map(hash_map_json: &str) -> String {
  match seam_engine::parse_rpc_hash_map(hash_map_json) {
    Ok(result) => serde_json::to_string(&result).unwrap_or_else(|_| "null".to_string()),
    Err(e) => format!(r#"{{"error":"{}"}}"#, e),
  }
}

#[wasm_bindgen]
pub fn ascii_escape_json(json: &str) -> String {
  seam_engine::ascii_escape_json(json)
}

#[wasm_bindgen]
pub fn i18n_query(
  keys_json: &str,
  locale: &str,
  default_locale: &str,
  messages_json: &str,
) -> String {
  let keys: Vec<String> = serde_json::from_str(keys_json).unwrap_or_default();
  let messages: Value = serde_json::from_str(messages_json).unwrap_or(Value::Null);
  let result = seam_engine::i18n_query(&keys, locale, default_locale, &messages);
  serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
}

// --- Re-exported injector functions (engine WASM is a superset) ---

#[wasm_bindgen]
pub fn inject(template: &str, data_json: &str, data_id: &str) -> String {
  let data: Value = serde_json::from_str(data_json).unwrap_or(Value::Null);
  seam_injector::inject(template, &data, data_id)
}

#[wasm_bindgen]
pub fn inject_no_script(template: &str, data_json: &str) -> String {
  let data: Value = serde_json::from_str(data_json).unwrap_or(Value::Null);
  seam_injector::inject_no_script(template, &data)
}
