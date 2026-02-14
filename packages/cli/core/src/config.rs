/* packages/cli/core/src/config.rs */

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct SeamConfig {
  pub project: ProjectConfig,
  #[serde(default)]
  pub backend: BackendConfig,
  #[serde(default)]
  pub frontend: FrontendConfig,
  #[serde(default)]
  pub build: BuildSection,
  #[serde(default)]
  pub generate: GenerateSection,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ProjectConfig {
  pub name: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct BackendConfig {
  #[serde(default = "default_lang")]
  pub lang: String,
  pub dev_command: Option<String>,
  #[serde(default = "default_port")]
  pub port: u16,
}

impl Default for BackendConfig {
  fn default() -> Self {
    Self { lang: default_lang(), dev_command: None, port: default_port() }
  }
}

#[derive(Debug, Default, Deserialize)]
pub struct FrontendConfig {
  pub dev_command: Option<String>,
  pub dev_port: Option<u16>,
  pub build_command: Option<String>,
  pub out_dir: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct BuildSection {
  pub routes: Option<String>,
  pub out_dir: Option<String>,
  pub bundler_command: Option<String>,
  pub bundler_manifest: Option<String>,
  pub renderer: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct GenerateSection {
  pub out_dir: Option<String>,
}

fn default_lang() -> String {
  "typescript".to_string()
}

fn default_port() -> u16 {
  3000
}

/// Walk upward from `start` to find `seam.toml`, like Cargo.toml discovery
pub fn find_seam_config(start: &Path) -> Result<PathBuf> {
  let mut dir =
    start.canonicalize().with_context(|| format!("failed to canonicalize {}", start.display()))?;
  loop {
    let candidate = dir.join("seam.toml");
    if candidate.is_file() {
      return Ok(candidate);
    }
    if !dir.pop() {
      bail!("seam.toml not found (searched upward from {})", start.display());
    }
  }
}

pub fn load_seam_config(path: &Path) -> Result<SeamConfig> {
  let content =
    std::fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
  let config: SeamConfig =
    toml::from_str(&content).with_context(|| format!("failed to parse {}", path.display()))?;
  Ok(config)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parse_minimal_config() {
    let toml_str = r#"
[project]
name = "my-app"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(config.project.name, "my-app");
    assert_eq!(config.backend.port, 3000);
    assert_eq!(config.backend.lang, "typescript");
    assert!(config.backend.dev_command.is_none());
    assert!(config.frontend.dev_command.is_none());
  }

  #[test]
  fn parse_full_config() {
    let toml_str = r#"
[project]
name = "full-app"

[backend]
lang = "rust"
dev_command = "cargo watch -x run"
port = 8080

[frontend]
dev_command = "vite dev"
dev_port = 5173
build_command = "vite build"
out_dir = "dist"

[build]
routes = "./src/routes.ts"
out_dir = "dist"
bundler_command = "npx vite build"
bundler_manifest = "dist/.vite/manifest.json"
renderer = "react"

[generate]
out_dir = "src/generated"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(config.project.name, "full-app");
    assert_eq!(config.backend.lang, "rust");
    assert_eq!(config.backend.port, 8080);
    assert_eq!(config.backend.dev_command.as_deref(), Some("cargo watch -x run"));
    assert_eq!(config.frontend.dev_port, Some(5173));
    assert_eq!(config.build.renderer.as_deref(), Some("react"));
    assert_eq!(config.generate.out_dir.as_deref(), Some("src/generated"));
  }

  #[test]
  fn missing_project_errors() {
    let toml_str = r#"
[backend]
port = 3000
"#;
    let result = toml::from_str::<SeamConfig>(toml_str);
    assert!(result.is_err());
  }
}
