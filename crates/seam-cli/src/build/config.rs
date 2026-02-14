/* crates/seam-cli/src/build/config.rs */

use std::path::Path;

use anyhow::{Context, Result};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct BuildConfig {
  pub bundler: BundlerConfig,
  pub routes: String,
  #[serde(rename = "outDir")]
  pub out_dir: String,
  // Kept for future use; framework renderer type (e.g. "react")
  #[allow(dead_code)]
  pub renderer: String,
}

#[derive(Debug, Deserialize)]
pub struct BundlerConfig {
  pub command: String,
  // Kept for future use; Vite outDir config
  #[allow(dead_code)]
  #[serde(rename = "outDir")]
  pub out_dir: String,
  #[serde(rename = "manifestFile")]
  pub manifest_file: String,
}

pub fn load_config(path: &Path) -> Result<BuildConfig> {
  let content =
    std::fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
  let config: BuildConfig = serde_json::from_str(&content)
    .with_context(|| format!("failed to parse {}", path.display()))?;
  Ok(config)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parse_valid_config() {
    let json = r#"{
            "bundler": {
                "command": "npx vite build",
                "outDir": "dist",
                "manifestFile": "dist/.vite/manifest.json"
            },
            "routes": "./src/routes.ts",
            "outDir": "dist",
            "renderer": "react"
        }"#;
    let config: BuildConfig = serde_json::from_str(json).unwrap();
    assert_eq!(config.bundler.command, "npx vite build");
    assert_eq!(config.routes, "./src/routes.ts");
    assert_eq!(config.out_dir, "dist");
    assert_eq!(config.renderer, "react");
  }

  #[test]
  fn missing_field_errors() {
    let json = r#"{ "routes": "./src/routes.ts" }"#;
    let result = serde_json::from_str::<BuildConfig>(json);
    assert!(result.is_err());
  }
}
