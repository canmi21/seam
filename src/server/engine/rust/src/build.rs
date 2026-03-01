/* src/server/engine/rust/src/build.rs */

//! Build output parsing: manifest + templates -> page definitions.
//! Pure functions operating on JSON strings, no filesystem I/O.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::page::LayoutChainEntry;

// --- Manifest types ---

#[derive(Deserialize)]
struct RouteManifest {
  #[serde(default)]
  layouts: HashMap<String, LayoutEntry>,
  routes: HashMap<String, RouteEntry>,
  #[serde(default)]
  data_id: Option<String>,
  #[serde(default)]
  i18n: Option<I18nManifest>,
}

#[derive(Deserialize)]
struct I18nManifest {
  #[serde(default)]
  locales: Vec<String>,
  #[serde(default)]
  default: String,
}

#[derive(Deserialize)]
struct LayoutEntry {
  #[serde(default)]
  loaders: serde_json::Value,
  #[serde(default)]
  parent: Option<String>,
  #[serde(default)]
  i18n_keys: Vec<String>,
}

#[derive(Deserialize)]
struct RouteEntry {
  #[serde(default)]
  layout: Option<String>,
  #[serde(default)]
  loaders: serde_json::Value,
  #[serde(default)]
  head_meta: Option<String>,
  #[serde(default)]
  i18n_keys: Vec<String>,
}

// --- Output types ---

/// Page definition produced by parse_build_output.
#[derive(Debug, Clone, Serialize)]
pub struct PageDefOutput {
  pub route: String,
  pub data_id: String,
  pub layout_chain: Vec<LayoutChainEntry>,
  pub page_loader_keys: Vec<String>,
  pub i18n_keys: Vec<String>,
  pub head_meta: Option<String>,
}

/// Parse route-manifest.json and produce per-page definitions with
/// layout chains, loader key assignments, and merged i18n_keys.
///
/// This replaces the layout-chain walking logic duplicated across
/// Rust/TS/Go build loaders with a single source of truth.
pub fn parse_build_output(manifest_json: &str) -> Result<Vec<PageDefOutput>, String> {
  let manifest: RouteManifest =
    serde_json::from_str(manifest_json).map_err(|e| format!("parse manifest: {e}"))?;

  let data_id = manifest.data_id.unwrap_or_else(|| "__data".to_string());

  let mut pages = Vec::new();
  for (route_path, entry) in &manifest.routes {
    // Build layout chain with loader key assignments
    let layout_chain = if let Some(ref layout_id) = entry.layout {
      build_layout_chain(layout_id, &manifest.layouts)
    } else {
      vec![]
    };

    // Page loader keys: extract data_key from route's loaders
    let page_loader_keys = extract_loader_keys(&entry.loaders);

    // Merge i18n_keys: layout chain (outer->inner) + route
    let mut i18n_keys = Vec::new();
    for lce in &layout_chain {
      if let Some(layout_entry) = manifest.layouts.get(&lce.id) {
        i18n_keys.extend(layout_entry.i18n_keys.iter().cloned());
      }
    }
    i18n_keys.extend(entry.i18n_keys.iter().cloned());

    pages.push(PageDefOutput {
      route: route_path.clone(),
      data_id: data_id.clone(),
      layout_chain,
      page_loader_keys,
      i18n_keys,
      head_meta: entry.head_meta.clone(),
    });
  }

  Ok(pages)
}

/// Walk the layout chain from inner to outer, then reverse to get outer->inner order.
/// Each entry records which loader data keys belong to that layout.
fn build_layout_chain(
  layout_id: &str,
  layouts: &HashMap<String, LayoutEntry>,
) -> Vec<LayoutChainEntry> {
  let mut chain = Vec::new();
  let mut current = Some(layout_id.to_string());

  while let Some(id) = current {
    if let Some(entry) = layouts.get(&id) {
      let loader_keys = extract_loader_keys(&entry.loaders);
      chain.push(LayoutChainEntry { id, loader_keys });
      current = entry.parent.clone();
    } else {
      break;
    }
  }

  // Walked inner->outer; reverse to outer->inner (matching TS)
  chain.reverse();
  chain
}

/// Extract data keys from a loaders JSON object.
fn extract_loader_keys(loaders: &serde_json::Value) -> Vec<String> {
  loaders.as_object().map(|obj| obj.keys().cloned().collect()).unwrap_or_default()
}

/// Parse i18n configuration from manifest JSON.
/// Returns a structured JSON for runtime use.
pub fn parse_i18n_config(manifest_json: &str) -> Option<serde_json::Value> {
  let manifest: RouteManifest = serde_json::from_str(manifest_json).ok()?;
  let i18n = manifest.i18n?;
  Some(serde_json::json!({
    "locales": i18n.locales,
    "default": i18n.default,
  }))
}

/// Parse an RPC hash map JSON and produce a reverse lookup (hash -> original name).
pub fn parse_rpc_hash_map(hash_map_json: &str) -> Result<serde_json::Value, String> {
  #[derive(Deserialize)]
  struct RpcHashMap {
    batch: String,
    procedures: HashMap<String, String>,
  }

  let map: RpcHashMap =
    serde_json::from_str(hash_map_json).map_err(|e| format!("parse rpc hash map: {e}"))?;

  let reverse: HashMap<String, String> =
    map.procedures.into_iter().map(|(name, hash)| (hash, name)).collect();

  Ok(serde_json::json!({
    "batch": map.batch,
    "reverse_lookup": reverse,
  }))
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  fn sample_manifest() -> String {
    json!({
      "layouts": {
        "root": {
          "template": "layouts/root.html",
          "loaders": {"nav": {"procedure": "getNav", "params": {}}},
          "i18n_keys": ["nav_title"]
        },
        "sidebar": {
          "template": "layouts/sidebar.html",
          "loaders": {"menu": {"procedure": "getMenu", "params": {}}},
          "parent": "root",
          "i18n_keys": ["menu_label"]
        }
      },
      "routes": {
        "/dashboard": {
          "template": "pages/dashboard.html",
          "layout": "sidebar",
          "loaders": {"stats": {"procedure": "getStats", "params": {}}},
          "head_meta": "<title>Dashboard</title>",
          "i18n_keys": ["page_title"]
        },
        "/about": {
          "template": "pages/about.html",
          "loaders": {}
        }
      },
      "data_id": "__data"
    })
    .to_string()
  }

  #[test]
  fn parse_build_output_layout_chain() {
    let pages = parse_build_output(&sample_manifest()).unwrap();
    let dashboard = pages.iter().find(|p| p.route == "/dashboard").unwrap();

    // Layout chain: outer(root) -> inner(sidebar)
    assert_eq!(dashboard.layout_chain.len(), 2);
    assert_eq!(dashboard.layout_chain[0].id, "root");
    assert_eq!(dashboard.layout_chain[0].loader_keys, vec!["nav"]);
    assert_eq!(dashboard.layout_chain[1].id, "sidebar");
    assert_eq!(dashboard.layout_chain[1].loader_keys, vec!["menu"]);

    // Page loader keys
    assert_eq!(dashboard.page_loader_keys, vec!["stats"]);

    // Merged i18n_keys: root + sidebar + route
    assert!(dashboard.i18n_keys.contains(&"nav_title".to_string()));
    assert!(dashboard.i18n_keys.contains(&"menu_label".to_string()));
    assert!(dashboard.i18n_keys.contains(&"page_title".to_string()));
  }

  #[test]
  fn parse_build_output_no_layout() {
    let pages = parse_build_output(&sample_manifest()).unwrap();
    let about = pages.iter().find(|p| p.route == "/about").unwrap();
    assert!(about.layout_chain.is_empty());
    assert!(about.page_loader_keys.is_empty());
  }

  #[test]
  fn parse_i18n_config_present() {
    let manifest = json!({
      "layouts": {},
      "routes": {},
      "i18n": {"locales": ["en", "zh"], "default": "en"}
    })
    .to_string();
    let config = parse_i18n_config(&manifest).unwrap();
    assert_eq!(config["locales"], json!(["en", "zh"]));
    assert_eq!(config["default"], "en");
  }

  #[test]
  fn parse_i18n_config_absent() {
    let manifest = json!({"layouts": {}, "routes": {}}).to_string();
    assert!(parse_i18n_config(&manifest).is_none());
  }

  #[test]
  fn parse_rpc_hash_map_test() {
    let input = json!({
      "salt": "abc",
      "batch": "hash_batch",
      "procedures": {"getUser": "hash_1", "getStats": "hash_2"}
    })
    .to_string();
    let result = parse_rpc_hash_map(&input).unwrap();
    assert_eq!(result["batch"], "hash_batch");
    let lookup = result["reverse_lookup"].as_object().unwrap();
    assert_eq!(lookup["hash_1"], "getUser");
    assert_eq!(lookup["hash_2"], "getStats");
  }
}
