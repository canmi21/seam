/* packages/cli/core/src/pull.rs */

use std::path::Path;

use anyhow::{Context, Result};

use crate::manifest::Manifest;
use crate::ui;

pub async fn pull_manifest(base_url: &str, out: &Path) -> Result<()> {
  let url = format!("{}/_seam/manifest.json", base_url.trim_end_matches('/'));

  ui::arrow(&url);

  let resp =
    reqwest::get(&url).await.with_context(|| format!("failed to fetch manifest from {url}"))?;

  let status = resp.status();
  if !status.is_success() {
    anyhow::bail!("server returned HTTP {status}");
  }

  let manifest: Manifest = resp.json().await.context("failed to parse manifest JSON")?;

  let total = manifest.procedures.len();

  // Group by procedure type
  let mut queries = 0u32;
  let mut mutations = 0u32;
  let mut subscriptions = 0u32;
  for proc in manifest.procedures.values() {
    match proc.proc_type.as_str() {
      "query" => queries += 1,
      "mutation" => mutations += 1,
      "subscription" => subscriptions += 1,
      _ => queries += 1,
    }
  }

  let mut parts = Vec::new();
  if queries > 0 {
    parts.push(format!("{queries} {}", if queries == 1 { "query" } else { "queries" }));
  }
  if mutations > 0 {
    parts.push(format!("{mutations} {}", if mutations == 1 { "mutation" } else { "mutations" }));
  }
  if subscriptions > 0 {
    parts.push(format!(
      "{subscriptions} {}",
      if subscriptions == 1 { "subscription" } else { "subscriptions" }
    ));
  }

  let breakdown =
    if parts.is_empty() { String::new() } else { format!(" \u{2014} {}", parts.join(", ")) };

  ui::ok(&format!("{total} procedures{breakdown}"));

  let json = serde_json::to_string_pretty(&manifest)?;
  std::fs::write(out, json).with_context(|| format!("failed to write {}", out.display()))?;

  ui::ok(&format!("saved {}", out.display()));
  Ok(())
}
