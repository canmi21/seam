/* src/server/core/rust/src/build_loader/types.rs */

use std::collections::HashMap;

use serde::Deserialize;

#[derive(Deserialize)]
#[allow(dead_code)]
pub(super) struct RouteManifest {
  #[serde(default)]
  pub(super) layouts: HashMap<String, LayoutEntry>,
  pub(super) routes: HashMap<String, RouteEntry>,
  #[serde(default)]
  pub(super) data_id: Option<String>,
  #[serde(default)]
  pub(super) i18n: Option<I18nManifest>,
}

#[derive(Deserialize)]
pub(super) struct I18nManifest {
  #[serde(default)]
  pub(super) locales: Vec<String>,
  #[serde(default)]
  pub(super) default: String,
  #[serde(default)]
  pub(super) mode: Option<String>,
  #[serde(default)]
  pub(super) cache: bool,
  #[serde(default)]
  pub(super) route_hashes: HashMap<String, String>,
  #[serde(default)]
  pub(super) content_hashes: HashMap<String, HashMap<String, String>>,
}

#[derive(Deserialize)]
pub(super) struct LayoutEntry {
  pub(super) template: Option<String>,
  #[serde(default)]
  pub(super) templates: Option<HashMap<String, String>>,
  #[serde(default)]
  pub(super) loaders: serde_json::Value,
  #[serde(default)]
  pub(super) parent: Option<String>,
  #[serde(default)]
  pub(super) i18n_keys: Vec<String>,
}

#[derive(Deserialize)]
pub(super) struct RouteEntry {
  pub(super) template: Option<String>,
  #[serde(default)]
  pub(super) templates: Option<HashMap<String, String>>,
  #[serde(default)]
  pub(super) layout: Option<String>,
  #[serde(default)]
  pub(super) loaders: serde_json::Value,
  #[serde(default)]
  pub(super) head_meta: Option<String>,
  #[serde(default)]
  pub(super) i18n_keys: Vec<String>,
}

/// Pick a template path: prefer singular `template`, fall back to default locale or first value.
pub(super) fn pick_template(
  single: &Option<String>,
  multi: &Option<HashMap<String, String>>,
  default_locale: Option<&str>,
) -> Option<String> {
  if let Some(t) = single {
    return Some(t.clone());
  }
  if let Some(map) = multi {
    // Prefer the default locale from manifest
    if let Some(loc) = default_locale
      && let Some(t) = map.get(loc)
    {
      return Some(t.clone());
    }
    return map.values().next().cloned();
  }
  None
}

#[derive(Deserialize)]
pub(super) struct LoaderConfig {
  pub(super) procedure: String,
  #[serde(default)]
  pub(super) params: HashMap<String, ParamConfig>,
}

#[derive(Deserialize)]
pub(super) struct ParamConfig {
  pub(super) from: String,
  #[serde(rename = "type", default = "default_type")]
  pub(super) param_type: String,
}

pub(super) fn default_type() -> String {
  "string".to_string()
}

/// RPC hash map loaded from build output. Maps hashed names back to original procedure names.
#[derive(Deserialize, Clone, Debug)]
pub struct RpcHashMap {
  pub salt: String,
  pub batch: String,
  pub procedures: HashMap<String, String>,
}

impl RpcHashMap {
  /// Build a reverse lookup: hash -> original name
  pub fn reverse_lookup(&self) -> HashMap<String, String> {
    self.procedures.iter().map(|(name, hash)| (hash.clone(), name.clone())).collect()
  }
}
