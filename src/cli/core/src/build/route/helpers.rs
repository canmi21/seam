/* src/cli/core/src/build/route/helpers.rs */

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{Context, Result};

use super::super::types::AssetFiles;
use crate::config::I18nSection;
use crate::ui::{self, DIM, RESET};

/// Read i18n message files from disk, keyed by locale.
/// Sorts keys alphabetically and writes back to keep source files deterministic.
pub(crate) fn read_i18n_messages(
  base_dir: &Path,
  i18n: &I18nSection,
) -> Result<BTreeMap<String, serde_json::Value>> {
  let mut messages = BTreeMap::new();
  for locale in &i18n.locales {
    let path = base_dir.join(&i18n.messages_dir).join(format!("{locale}.json"));
    let content = std::fs::read_to_string(&path)
      .with_context(|| format!("i18n: failed to read {}", path.display()))?;
    let parsed: serde_json::Value = serde_json::from_str(&content)
      .with_context(|| format!("i18n: invalid JSON in {}", path.display()))?;

    // Sort keys and write back for deterministic source files
    let sorted = sort_json_keys(&parsed);
    let sorted_json = serde_json::to_string_pretty(&sorted)
      .with_context(|| format!("i18n: failed to serialize {locale}"))?;
    let sorted_json = format!("{sorted_json}\n");
    // Only write if content differs to avoid unnecessary file churn
    if sorted_json != content {
      std::fs::write(&path, &sorted_json)
        .with_context(|| format!("i18n: failed to write {}", path.display()))?;
    }

    messages.insert(locale.clone(), sorted);
  }
  Ok(messages)
}

/// Sort JSON object keys alphabetically (shallow — message files are flat).
fn sort_json_keys(value: &serde_json::Value) -> serde_json::Value {
  match value {
    serde_json::Value::Object(obj) => {
      let sorted: serde_json::Map<String, serde_json::Value> =
        obj.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
      serde_json::Value::Object(sorted)
    }
    other => other.clone(),
  }
}

/// Build-time i18n data for all routes in a locale.
/// Maps route_hash -> { key: value, ... }
pub(crate) type LocaleRouteMessages = BTreeMap<String, BTreeMap<String, String>>;

/// Export i18n messages in memory mode: one file per locale containing all routes.
/// Output: `i18n/{locale}.json` → `{ routeHash: { key: value, ... }, ... }`
pub(crate) fn export_i18n_memory(
  out_dir: &Path,
  per_locale: &BTreeMap<String, LocaleRouteMessages>,
) -> Result<()> {
  let i18n_dir = out_dir.join("i18n");
  std::fs::create_dir_all(&i18n_dir)
    .with_context(|| format!("failed to create {}", i18n_dir.display()))?;
  for (locale, route_msgs) in per_locale {
    let path = i18n_dir.join(format!("{locale}.json"));
    let json = serde_json::to_string(route_msgs)
      .with_context(|| format!("i18n: failed to serialize {locale}"))?;
    let json = seam_server::ascii_escape_json(&json);
    std::fs::write(&path, &json)
      .with_context(|| format!("i18n: failed to write {}", path.display()))?;
  }
  Ok(())
}

/// Export i18n messages in paged mode: one file per (route, locale).
/// Output: `i18n/{routeHash}/{locale}.json` → `{ key: value, ... }`
pub(crate) fn export_i18n_paged(
  out_dir: &Path,
  per_locale: &BTreeMap<String, LocaleRouteMessages>,
) -> Result<()> {
  let i18n_dir = out_dir.join("i18n");
  for (locale, route_msgs) in per_locale {
    for (route_hash, msgs) in route_msgs {
      let dir = i18n_dir.join(route_hash);
      std::fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create {}", dir.display()))?;
      let path = dir.join(format!("{locale}.json"));
      let json = serde_json::to_string(msgs)
        .with_context(|| format!("i18n: failed to serialize {locale}/{route_hash}"))?;
      let json = seam_server::ascii_escape_json(&json);
      std::fs::write(&path, &json)
        .with_context(|| format!("i18n: failed to write {}", path.display()))?;
    }
  }
  Ok(())
}

/// Convert route path to filename: `/user/:id` -> `user-id.html`, `/` -> `index.html`
pub(super) fn path_to_filename(path: &str) -> String {
  let trimmed = path.trim_matches('/');
  if trimmed.is_empty() {
    return "index.html".to_string();
  }
  let slug = trimmed.replace('/', "-").replace(':', "");
  format!("{slug}.html")
}

/// Print each asset file with its size from disk
pub(crate) fn print_asset_files(base_dir: &Path, dist_dir: &str, assets: &AssetFiles) {
  let all_files: Vec<&str> =
    assets.js.iter().chain(assets.css.iter()).map(|s| s.as_str()).collect();
  for file in all_files {
    let full_path = base_dir.join(dist_dir).join(file);
    let size = std::fs::metadata(&full_path).map(|m| m.len()).unwrap_or(0);
    ui::detail_ok(&format!("{dist_dir}/{file}  {DIM}({}){RESET}", ui::format_size(size)));
  }
}
