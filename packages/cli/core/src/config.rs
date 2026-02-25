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
  #[serde(default)]
  pub i18n: Option<I18nSection>,
  #[serde(default)]
  pub workspace: Option<WorkspaceSection>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkspaceSection {
  pub members: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct I18nSection {
  pub locales: Vec<String>,
  #[serde(default = "default_i18n_default")]
  pub default: String,
  #[serde(default = "default_messages_dir")]
  pub messages_dir: String,
}

impl I18nSection {
  pub fn validate(&self) -> Result<()> {
    if self.locales.is_empty() {
      bail!("i18n.locales must not be empty");
    }
    if !self.locales.contains(&self.default) {
      bail!("i18n.default \"{}\" is not in i18n.locales {:?}", self.default, self.locales);
    }
    Ok(())
  }
}

fn default_i18n_default() -> String {
  "origin".to_string()
}

fn default_messages_dir() -> String {
  "locales".to_string()
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

#[derive(Debug, Clone, Deserialize)]
pub struct FrontendConfig {
  pub entry: Option<String>,
  pub dev_command: Option<String>,
  pub dev_port: Option<u16>,
  pub build_command: Option<String>,
  pub out_dir: Option<String>,
  #[serde(default = "default_root_id")]
  pub root_id: String,
  #[serde(default = "default_data_id")]
  pub data_id: String,
}

impl Default for FrontendConfig {
  fn default() -> Self {
    Self {
      entry: None,
      dev_command: None,
      dev_port: None,
      build_command: None,
      out_dir: None,
      root_id: default_root_id(),
      data_id: default_data_id(),
    }
  }
}

fn default_root_id() -> String {
  "__seam".to_string()
}

fn default_data_id() -> String {
  "__SEAM_DATA__".to_string()
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
  pub manifest_command: Option<String>,
  pub typecheck_command: Option<String>,
  #[serde(default)]
  pub obfuscate: Option<bool>,
  #[serde(default)]
  pub sourcemap: Option<bool>,
  #[serde(default)]
  pub type_hint: Option<bool>,
  #[serde(default)]
  pub hash_length: Option<u32>,
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
  #[serde(default)]
  pub type_hint: Option<bool>,
  #[serde(default)]
  pub hash_length: Option<u32>,
}

impl Default for DevSection {
  fn default() -> Self {
    Self {
      port: default_dev_port(),
      vite_port: None,
      obfuscate: None,
      sourcemap: None,
      type_hint: None,
      hash_length: None,
    }
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
  if let Some(ref i18n) = config.i18n {
    i18n.validate()?;
  }
  Ok(config)
}

impl SeamConfig {
  pub fn is_workspace(&self) -> bool {
    self.workspace.as_ref().is_some_and(|w| !w.members.is_empty())
  }

  pub fn member_paths(&self) -> &[String] {
    match &self.workspace {
      Some(w) => &w.members,
      None => &[],
    }
  }
}

/// Load and merge root + member config.
/// Member overrides: [backend], [build].{backend_build_command, router_file, manifest_command, out_dir}
/// Root provides: [project], [frontend], [build] (shared fields), [i18n], [dev], [generate]
pub fn resolve_member_config(root: &SeamConfig, member_dir: &Path) -> Result<SeamConfig> {
  let member_toml = member_dir.join("seam.toml");
  let content = std::fs::read_to_string(&member_toml)
    .with_context(|| format!("failed to read {}", member_toml.display()))?;
  let member: SeamConfig = toml::from_str(&content)
    .with_context(|| format!("failed to parse {}", member_toml.display()))?;

  let mut merged = root.clone();

  // Backend entirely from member
  merged.backend = member.backend;

  // Build: member overrides backend-specific fields only
  if member.build.backend_build_command.is_some() {
    merged.build.backend_build_command = member.build.backend_build_command;
  }
  if member.build.router_file.is_some() {
    merged.build.router_file = member.build.router_file;
  }
  if member.build.manifest_command.is_some() {
    merged.build.manifest_command = member.build.manifest_command;
  }
  if member.build.out_dir.is_some() {
    merged.build.out_dir = member.build.out_dir;
  }

  // Strip workspace section from merged config (members are not workspaces)
  merged.workspace = None;

  Ok(merged)
}

/// Validate workspace: member dirs exist, contain seam.toml, no duplicates,
/// each member has either router_file or manifest_command.
pub fn validate_workspace(config: &SeamConfig, base_dir: &Path) -> Result<()> {
  let members = config.member_paths();
  if members.is_empty() {
    bail!("workspace.members must not be empty");
  }

  let mut seen_names = std::collections::HashSet::new();
  for member_path in members {
    let dir = base_dir.join(member_path);
    if !dir.is_dir() {
      bail!("workspace member directory not found: {}", dir.display());
    }
    let toml_path = dir.join("seam.toml");
    if !toml_path.is_file() {
      bail!("workspace member missing seam.toml: {}", toml_path.display());
    }

    // Extract basename for duplicate check
    let name = Path::new(member_path).file_name().and_then(|n| n.to_str()).unwrap_or(member_path);
    if !seen_names.insert(name.to_string()) {
      bail!("duplicate workspace member name: {name}");
    }

    // Load and check manifest extraction method
    let member_config = resolve_member_config(config, &dir)?;
    if member_config.build.router_file.is_none() && member_config.build.manifest_command.is_none() {
      bail!(
        "workspace member \"{member_path}\" must have either build.router_file or build.manifest_command"
      );
    }
  }

  Ok(())
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
  fn parse_type_hint_config() {
    // Explicit values
    let toml_str = r#"
[project]
name = "my-app"

[build]
type_hint = false

[dev]
type_hint = true
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(config.build.type_hint, Some(false));
    assert_eq!(config.dev.type_hint, Some(true));

    // Defaults to None when omitted
    let toml_str = r#"
[project]
name = "my-app"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert!(config.build.type_hint.is_none());
    assert!(config.dev.type_hint.is_none());
  }

  #[test]
  fn parse_hash_length_config() {
    // Explicit values
    let toml_str = r#"
[project]
name = "my-app"

[build]
hash_length = 20

[dev]
hash_length = 8
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(config.build.hash_length, Some(20));
    assert_eq!(config.dev.hash_length, Some(8));

    // Defaults to None when omitted
    let toml_str = r#"
[project]
name = "my-app"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert!(config.build.hash_length.is_none());
    assert!(config.dev.hash_length.is_none());
  }

  #[test]
  fn parse_root_id_default() {
    let toml_str = r#"
[project]
name = "my-app"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(config.frontend.root_id, "__seam");
  }

  #[test]
  fn parse_root_id_explicit() {
    let toml_str = r#"
[project]
name = "my-app"

[frontend]
root_id = "app"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(config.frontend.root_id, "app");
  }

  #[test]
  fn parse_data_id_default() {
    let toml_str = r#"
[project]
name = "my-app"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(config.frontend.data_id, "__SEAM_DATA__");
  }

  #[test]
  fn parse_data_id_explicit() {
    let toml_str = r#"
[project]
name = "my-app"

[frontend]
data_id = "__sd"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(config.frontend.data_id, "__sd");
  }

  #[test]
  fn parse_workspace_config() {
    let toml_str = r#"
[project]
name = "github-dashboard"

[workspace]
members = ["backends/ts-hono", "backends/rust-axum", "backends/go-gin"]
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert!(config.is_workspace());
    assert_eq!(
      config.member_paths(),
      &["backends/ts-hono", "backends/rust-axum", "backends/go-gin"]
    );
  }

  #[test]
  fn parse_no_workspace() {
    let toml_str = r#"
[project]
name = "my-app"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert!(!config.is_workspace());
    assert!(config.member_paths().is_empty());
  }

  #[test]
  fn parse_manifest_command() {
    let toml_str = r#"
[project]
name = "my-app"

[build]
manifest_command = "cargo run --release -- --manifest"
backend_build_command = "cargo build --release"
routes = "frontend/src/client/routes.ts"
bundler_command = "cd frontend && bunx vite build"
bundler_manifest = "frontend/dist/.vite/manifest.json"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(config.build.manifest_command.as_deref(), Some("cargo run --release -- --manifest"));
    assert!(config.build.router_file.is_none());
  }

  #[test]
  fn workspace_member_config_merge() {
    use std::io::Write;

    let tmp = std::env::temp_dir().join("seam-test-workspace-merge");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(tmp.join("backends/ts-hono")).unwrap();

    // Write member seam.toml
    let mut f = std::fs::File::create(tmp.join("backends/ts-hono/seam.toml")).unwrap();
    writeln!(
      f,
      r#"[project]
name = "ignored"

[backend]
lang = "typescript"
dev_command = "bun --watch src/index.ts"
port = 4000

[build]
backend_build_command = "bun build src/index.ts"
router_file = "src/router.ts"
"#
    )
    .unwrap();

    // Root config
    let root: SeamConfig = toml::from_str(
      r#"
[project]
name = "github-dashboard"

[frontend]
entry = "frontend/src/client/main.tsx"

[build]
routes = "frontend/src/client/routes.ts"
bundler_command = "cd frontend && bunx vite build"
bundler_manifest = "frontend/dist/.vite/manifest.json"
out_dir = ".seam/output"

[workspace]
members = ["backends/ts-hono"]
"#,
    )
    .unwrap();

    let merged = resolve_member_config(&root, &tmp.join("backends/ts-hono")).unwrap();

    // Project from root
    assert_eq!(merged.project.name, "github-dashboard");
    // Backend from member
    assert_eq!(merged.backend.lang, "typescript");
    assert_eq!(merged.backend.port, 4000);
    assert_eq!(merged.backend.dev_command.as_deref(), Some("bun --watch src/index.ts"));
    // Build: shared fields from root
    assert_eq!(merged.build.routes.as_deref(), Some("frontend/src/client/routes.ts"));
    assert_eq!(merged.build.bundler_command.as_deref(), Some("cd frontend && bunx vite build"));
    // Build: overridden fields from member
    assert_eq!(merged.build.backend_build_command.as_deref(), Some("bun build src/index.ts"));
    assert_eq!(merged.build.router_file.as_deref(), Some("src/router.ts"));
    // Workspace stripped from merged
    assert!(!merged.is_workspace());

    let _ = std::fs::remove_dir_all(&tmp);
  }

  #[test]
  fn workspace_validation_missing_dir() {
    let tmp = std::env::temp_dir().join("seam-test-ws-missing-dir");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();

    let config: SeamConfig = toml::from_str(
      r#"
[project]
name = "test"

[workspace]
members = ["nonexistent"]
"#,
    )
    .unwrap();

    let err = validate_workspace(&config, &tmp).unwrap_err();
    assert!(err.to_string().contains("not found"));

    let _ = std::fs::remove_dir_all(&tmp);
  }

  #[test]
  fn workspace_validation_missing_toml() {
    let tmp = std::env::temp_dir().join("seam-test-ws-missing-toml");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(tmp.join("member-a")).unwrap();

    let config: SeamConfig = toml::from_str(
      r#"
[project]
name = "test"

[workspace]
members = ["member-a"]
"#,
    )
    .unwrap();

    let err = validate_workspace(&config, &tmp).unwrap_err();
    assert!(err.to_string().contains("missing seam.toml"));

    let _ = std::fs::remove_dir_all(&tmp);
  }

  #[test]
  fn workspace_validation_duplicate_names() {
    use std::io::Write;

    let tmp = std::env::temp_dir().join("seam-test-ws-dup-names");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(tmp.join("a/hono")).unwrap();
    std::fs::create_dir_all(tmp.join("b/hono")).unwrap();

    for dir in ["a/hono", "b/hono"] {
      let mut f = std::fs::File::create(tmp.join(dir).join("seam.toml")).unwrap();
      writeln!(
        f,
        r#"[project]
name = "x"

[build]
router_file = "src/router.ts"
"#
      )
      .unwrap();
    }

    let config: SeamConfig = toml::from_str(
      r#"
[project]
name = "test"

[build]
routes = "routes.ts"
bundler_command = "vite build"
bundler_manifest = "dist/manifest.json"

[workspace]
members = ["a/hono", "b/hono"]
"#,
    )
    .unwrap();

    let err = validate_workspace(&config, &tmp).unwrap_err();
    assert!(err.to_string().contains("duplicate"));

    let _ = std::fs::remove_dir_all(&tmp);
  }

  #[test]
  fn workspace_validation_no_manifest_method() {
    use std::io::Write;

    let tmp = std::env::temp_dir().join("seam-test-ws-no-manifest");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(tmp.join("member")).unwrap();

    let mut f = std::fs::File::create(tmp.join("member/seam.toml")).unwrap();
    writeln!(
      f,
      r#"[project]
name = "x"

[backend]
lang = "rust"
"#
    )
    .unwrap();

    let config: SeamConfig = toml::from_str(
      r#"
[project]
name = "test"

[build]
routes = "routes.ts"
bundler_command = "vite build"
bundler_manifest = "dist/manifest.json"

[workspace]
members = ["member"]
"#,
    )
    .unwrap();

    let err = validate_workspace(&config, &tmp).unwrap_err();
    assert!(err.to_string().contains("router_file or build.manifest_command"));

    let _ = std::fs::remove_dir_all(&tmp);
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

  #[test]
  fn parse_i18n_section() {
    let toml_str = r#"
[project]
name = "my-app"

[i18n]
locales = ["origin", "zh"]
default = "zh"
messages_dir = "translations"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    let i18n = config.i18n.unwrap();
    assert_eq!(i18n.locales, vec!["origin", "zh"]);
    assert_eq!(i18n.default, "zh");
    assert_eq!(i18n.messages_dir, "translations");
    assert!(i18n.validate().is_ok());
  }

  #[test]
  fn parse_i18n_default_values() {
    let toml_str = r#"
[project]
name = "my-app"

[i18n]
locales = ["origin", "zh"]
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    let i18n = config.i18n.unwrap();
    assert_eq!(i18n.locales, vec!["origin", "zh"]);
    assert_eq!(i18n.default, "origin");
    assert_eq!(i18n.messages_dir, "locales");
  }

  #[test]
  fn parse_no_i18n() {
    let toml_str = r#"
[project]
name = "my-app"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert!(config.i18n.is_none());
  }

  #[test]
  fn parse_i18n_validation_default_not_in_locales() {
    let toml_str = r#"
[project]
name = "my-app"

[i18n]
locales = ["origin", "zh"]
default = "ja"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    let i18n = config.i18n.unwrap();
    let err = i18n.validate().unwrap_err();
    assert!(err.to_string().contains("\"ja\""));
    assert!(err.to_string().contains("not in"));
  }

  #[test]
  fn parse_i18n_validation_empty_locales() {
    let toml_str = r#"
[project]
name = "my-app"

[i18n]
locales = []
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    let i18n = config.i18n.unwrap();
    let err = i18n.validate().unwrap_err();
    assert!(err.to_string().contains("must not be empty"));
  }
}
