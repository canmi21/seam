/* src/server/core/rust/src/page.rs */

use std::collections::HashMap;
use std::sync::Arc;

pub type LoaderInputFn = Arc<dyn Fn(&HashMap<String, String>) -> serde_json::Value + Send + Sync>;

pub struct LoaderDef {
  pub data_key: String,
  pub procedure: String,
  pub input_fn: LoaderInputFn,
}

/// One entry in a layout chain (outer to inner order).
/// Each layout owns a set of loader data keys.
pub struct LayoutChainEntry {
  pub id: String,
  pub loader_keys: Vec<String>,
}

pub struct PageDef {
  /// Axum route syntax, e.g. "/user/{id}"
  pub route: String,
  pub template: String,
  /// Per-locale pre-resolved templates (layout chain already applied). Keyed by locale.
  pub locale_templates: Option<HashMap<String, String>>,
  pub loaders: Vec<LoaderDef>,
  /// Script ID for the injected data JSON. Defaults to "__data".
  pub data_id: String,
  /// Layout chain from outer to inner. Each entry records which loader keys belong to that layout.
  pub layout_chain: Vec<LayoutChainEntry>,
  /// Data keys from page-level loaders (not layout). Used to split data in the data script.
  pub page_loader_keys: Vec<String>,
  /// Merged i18n keys from route + layout chain. Empty means include all keys.
  pub i18n_keys: Vec<String>,
}

/// Runtime i18n configuration loaded from build output.
#[derive(Clone)]
pub struct I18nConfig {
  pub locales: Vec<String>,
  pub default: String,
  pub mode: String,
  pub cache: bool,
  /// Route pattern -> route hash (8 hex)
  pub route_hashes: HashMap<String, String>,
  /// Route hash -> { locale -> content hash (4 hex) }
  pub content_hashes: HashMap<String, HashMap<String, String>>,
  /// Memory mode: locale -> routeHash -> messages
  pub messages: HashMap<String, HashMap<String, serde_json::Value>>,
  /// Paged mode: base directory for on-demand reads
  pub dist_dir: Option<std::path::PathBuf>,
}
