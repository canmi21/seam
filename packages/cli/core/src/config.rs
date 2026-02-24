/* packages/cli/core/src/config.rs */

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
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
  #[serde(default)]
  pub dev: DevSection,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProjectConfig {
  pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
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

#[derive(Debug, Clone, Default, Deserialize)]
pub struct FrontendConfig {
  pub entry: Option<String>,
  pub dev_command: Option<String>,
  pub dev_port: Option<u16>,
  pub build_command: Option<String>,
  pub out_dir: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct BuildSection {
  pub routes: Option<String>,
  pub out_dir: Option<String>,
  pub bundler_command: Option<String>,
  pub bundler_manifest: Option<String>,
  pub renderer: Option<String>,
  pub backend_build_command: Option<String>,
  pub router_file: Option<String>,
  pub typecheck_command: Option<String>,
  #[serde(default)]
  pub obfuscate: Option<bool>,
  #[serde(default)]
  pub sourcemap: Option<bool>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct GenerateSection {
  pub out_dir: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DevSection {
  #[serde(default = "default_dev_port")]
  pub port: u16,
  pub vite_port: Option<u16>,
  #[serde(default)]
  pub obfuscate: Option<bool>,
  #[serde(default)]
  pub sourcemap: Option<bool>,
}

impl Default for DevSection {
  fn default() -> Self {
    Self { port: default_dev_port(), vite_port: None, obfuscate: None, sourcemap: None }
  }
}

fn default_dev_port() -> u16 {
  80
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
  fn parse_fullstack_build_config() {
    let toml_str = r#"
[project]
name = "fullstack-app"

[build]
routes = "./src/routes.ts"
bundler_command = "bunx vite build"
bundler_manifest = "dist/.vite/manifest.json"
out_dir = ".seam/output"
backend_build_command = "bun build src/server/index.ts --target=bun --outdir=.seam/output/server"
router_file = "src/server/router.ts"
typecheck_command = "bunx tsc --noEmit"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(
      config.build.backend_build_command.as_deref(),
      Some("bun build src/server/index.ts --target=bun --outdir=.seam/output/server")
    );
    assert_eq!(config.build.router_file.as_deref(), Some("src/server/router.ts"));
    assert_eq!(config.build.typecheck_command.as_deref(), Some("bunx tsc --noEmit"));
  }

  #[test]
  fn parse_builtin_bundler_config() {
    let toml_str = r#"
[project]
name = "builtin-app"

[frontend]
entry = "src/client/main.tsx"
dev_port = 5173

[build]
routes = "./src/routes.ts"
out_dir = ".seam/output"
backend_build_command = "bun build src/server/index.ts --target=bun --outdir=.seam/output/server"
router_file = "src/server/router.ts"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(config.frontend.entry.as_deref(), Some("src/client/main.tsx"));
    assert!(config.build.bundler_command.is_none());
    assert!(config.build.bundler_manifest.is_none());
  }

  #[test]
  fn parse_dev_section_defaults() {
    let toml_str = r#"
[project]
name = "my-app"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(config.dev.port, 80);
  }

  #[test]
  fn parse_dev_section_explicit() {
    let toml_str = r#"
[project]
name = "my-app"

[dev]
port = 3000
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(config.dev.port, 3000);
  }

  #[test]
  fn parse_dev_section_with_vite_port() {
    let toml_str = r#"
[project]
name = "my-app"

[dev]
port = 3000
vite_port = 5173
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(config.dev.port, 3000);
    assert_eq!(config.dev.vite_port, Some(5173));
  }

  #[test]
  fn parse_dev_section_vite_port_defaults_to_none() {
    let toml_str = r#"
[project]
name = "my-app"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert!(config.dev.vite_port.is_none());
  }

  #[test]
  fn parse_obfuscate_config() {
    // Explicit values
    let toml_str = r#"
[project]
name = "my-app"

[build]
obfuscate = false
sourcemap = true

[dev]
obfuscate = true
sourcemap = false
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(config.build.obfuscate, Some(false));
    assert_eq!(config.build.sourcemap, Some(true));
    assert_eq!(config.dev.obfuscate, Some(true));
    assert_eq!(config.dev.sourcemap, Some(false));

    // Defaults to None when omitted
    let toml_str = r#"
[project]
name = "my-app"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert!(config.build.obfuscate.is_none());
    assert!(config.build.sourcemap.is_none());
    assert!(config.dev.obfuscate.is_none());
    assert!(config.dev.sourcemap.is_none());
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
