/* packages/cli/core/src/build/types.rs */

// Shared types for the build pipeline.

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

/// Vite dev server info, threaded through the build pipeline to replace
/// static asset references with Vite-served modules.
#[derive(Debug, Clone)]
pub struct ViteDevInfo {
  pub origin: String,
  pub entry: String,
}

pub fn read_bundle_manifest(path: &Path) -> Result<AssetFiles> {
  let content = std::fs::read_to_string(path)
    .with_context(|| format!("failed to read bundle manifest at {}", path.display()))?;
  let manifest: SeamManifest =
    serde_json::from_str(&content).context("failed to parse bundle manifest")?;
  Ok(manifest.into())
}
