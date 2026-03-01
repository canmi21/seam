/* src/cli/core/src/build/types.rs */

// Shared types for the build pipeline.

use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct SeamManifest {
  pub js: Vec<String>,
  pub css: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct AssetFiles {
  pub css: Vec<String>,
  pub js: Vec<String>,
}

impl From<SeamManifest> for AssetFiles {
  fn from(m: SeamManifest) -> Self {
    Self { css: m.css, js: m.js }
  }
}

/// Single entry in Vite's `.vite/manifest.json`.
#[derive(Debug, Deserialize)]
struct ViteManifestEntry {
  file: String,
  #[serde(default)]
  css: Vec<String>,
  #[serde(default, rename = "isEntry")]
  is_entry: bool,
}

pub use seam_skeleton::ViteDevInfo;

pub fn read_bundle_manifest(path: &Path) -> Result<AssetFiles> {
  let content = std::fs::read_to_string(path)
    .with_context(|| format!("failed to read bundle manifest at {}", path.display()))?;

  // Try Vite format: { "src/...": { file, css, isEntry } }
  if let Ok(vite) = serde_json::from_str::<HashMap<String, ViteManifestEntry>>(&content)
    && vite.values().any(|e| e.is_entry)
  {
    let mut js = vec![];
    let mut css = vec![];
    for entry in vite.values() {
      if entry.is_entry {
        js.push(entry.file.clone());
        css.extend(entry.css.iter().cloned());
      }
    }
    return Ok(AssetFiles { js, css });
  }

  // Fallback: Seam format { js: [], css: [] }
  let manifest: SeamManifest =
    serde_json::from_str(&content).context("failed to parse bundle manifest")?;
  Ok(manifest.into())
}
