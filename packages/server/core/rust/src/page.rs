/* packages/server/core/rust/src/page.rs */

use std::collections::HashMap;
use std::sync::Arc;

pub type LoaderInputFn = Arc<dyn Fn(&HashMap<String, String>) -> serde_json::Value + Send + Sync>;

pub struct LoaderDef {
  pub data_key: String,
  pub procedure: String,
  pub input_fn: LoaderInputFn,
}

pub struct PageDef {
  /// Axum route syntax, e.g. "/user/{id}"
  pub route: String,
  pub template: String,
  pub loaders: Vec<LoaderDef>,
  /// Script ID for the injected data JSON. Defaults to "__SEAM_DATA__".
  pub data_id: String,
  /// Layout ID this page belongs to. Layout loaders stored under `_layouts.{id}` in data script.
  pub layout_id: Option<String>,
  /// Data keys from page-level loaders (not layout). Used to split data in the data script.
  pub page_loader_keys: Vec<String>,
}
