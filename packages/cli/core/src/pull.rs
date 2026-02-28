/* packages/cli/core/src/pull.rs */

use std::path::Path;

use anyhow::{Context, Result};

use crate::manifest::{Manifest, ProcedureType};
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
  let mut commands = 0u32;
  let mut subscriptions = 0u32;
  for proc in manifest.procedures.values() {
    match proc.proc_type {
      ProcedureType::Query => queries += 1,
      ProcedureType::Command => commands += 1,
      ProcedureType::Subscription => subscriptions += 1,
    }
  }

  let mut parts = Vec::new();
  if queries > 0 {
    parts.push(format!("{queries} {}", if queries == 1 { "query" } else { "queries" }));
  }
  if commands > 0 {
    parts.push(format!("{commands} {}", if commands == 1 { "command" } else { "commands" }));
  }
  if subscriptions > 0 {
    parts.push(format!(
      "{subscriptions} {}",
      if subscriptions == 1 { "subscription" } else { "subscriptions" }
    ));
  }

  let breakdown =
    if parts.is_empty() { String::new() } else { format!(" \u{2014} {}", parts.join(", ")) };

  let channel_count = manifest.channels.len();
  let channel_suffix = if channel_count > 0 {
    let names: Vec<&str> = manifest.channels.keys().map(|s| s.as_str()).collect();
    format!(
      " + {} {} ({})",
      channel_count,
      if channel_count == 1 { "channel" } else { "channels" },
      names.join(", ")
    )
  } else {
    String::new()
  };

  ui::ok(&format!("{total} procedures{breakdown}{channel_suffix}"));

  let json = serde_json::to_string_pretty(&manifest)?;
  std::fs::write(out, json).with_context(|| format!("failed to write {}", out.display()))?;

  ui::ok(&format!("saved {}", out.display()));
  Ok(())
}
