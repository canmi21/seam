/* packages/cli/core/src/build/route/helpers.rs */

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};

use super::super::types::AssetFiles;
use crate::config::I18nSection;
use crate::ui::{self, DIM, RESET};

/// Read i18n message files from disk, keyed by locale.
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
    messages.insert(locale.clone(), parsed);
  }
  Ok(messages)
}

/// Export i18n messages as separate JSON files in {out_dir}/locales/{locale}.json.
/// The server reads these at startup to inject _i18n into page data at request time.
pub(crate) fn export_i18n_messages(
  out_dir: &Path,
  messages: &BTreeMap<String, serde_json::Value>,
) -> Result<()> {
  let locales_dir = out_dir.join("locales");
  std::fs::create_dir_all(&locales_dir)
    .with_context(|| format!("failed to create {}", locales_dir.display()))?;
  for (locale, data) in messages {
    let path = locales_dir.join(format!("{locale}.json"));
    let json = serde_json::to_string_pretty(data)
      .with_context(|| format!("i18n: failed to serialize {locale}"))?;
    std::fs::write(&path, json)
      .with_context(|| format!("i18n: failed to write {}", path.display()))?;
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

/// Sort i18n source files alphabetically by key, writing back only if changed.
pub(crate) fn sort_i18n_source_files(base_dir: &Path, i18n: &I18nSection) -> Result<()> {
  for locale in &i18n.locales {
    let path = base_dir.join(&i18n.messages_dir).join(format!("{locale}.json"));
    let content = std::fs::read_to_string(&path)
      .with_context(|| format!("i18n: failed to read {}", path.display()))?;
    let sorted: BTreeMap<String, serde_json::Value> = serde_json::from_str(&content)
      .with_context(|| format!("i18n: invalid JSON in {}", path.display()))?;
    let mut new_content = serde_json::to_string_pretty(&sorted)
      .with_context(|| format!("i18n: failed to serialize {locale}"))?;
    new_content.push('\n');
    if new_content != content {
      std::fs::write(&path, &new_content)
        .with_context(|| format!("i18n: failed to write {}", path.display()))?;
    }
  }
  Ok(())
}

/// Compute a per-locale content hash (first 8 bytes of SHA-256, hex-encoded).
pub(crate) fn compute_i18n_versions(
  messages: &BTreeMap<String, serde_json::Value>,
) -> BTreeMap<String, String> {
  let mut versions = BTreeMap::new();
  for (locale, value) in messages {
    // Re-parse as BTreeMap to normalize key order
    let normalized: BTreeMap<String, serde_json::Value> =
      serde_json::from_value(value.clone()).unwrap_or_default();
    let json = serde_json::to_string(&normalized).unwrap_or_default();
    let hash = Sha256::digest(json.as_bytes());
    versions.insert(locale.clone(), hex::encode(&hash[..8]));
  }
  versions
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
