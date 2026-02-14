/* packages/cli/core/src/pull.rs */

use std::path::Path;

use anyhow::{Context, Result};

use crate::manifest::Manifest;

pub async fn pull_manifest(base_url: &str, out: &Path) -> Result<()> {
  let url = format!("{}/_seam/manifest.json", base_url.trim_end_matches('/'));
  let resp =
    reqwest::get(&url).await.with_context(|| format!("failed to fetch manifest from {url}"))?;

  let status = resp.status();
  if !status.is_success() {
    anyhow::bail!("server returned HTTP {status}");
  }

  let manifest: Manifest = resp.json().await.context("failed to parse manifest JSON")?;

  let json = serde_json::to_string_pretty(&manifest)?;
  std::fs::write(out, json).with_context(|| format!("failed to write {}", out.display()))?;

  println!("manifest saved to {}", out.display());
  Ok(())
}
