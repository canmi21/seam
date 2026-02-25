/* packages/cli/core/src/build/config.rs */

use anyhow::{bail, Result};

use crate::config::{I18nSection, SeamConfig};

#[derive(Debug, Clone)]
pub enum BundlerMode {
  BuiltIn { entry: String },
  Custom { command: String },
}

#[derive(Debug, Clone)]
pub struct BuildConfig {
  pub bundler_mode: BundlerMode,
  pub bundler_manifest: String,
  pub routes: String,
  pub out_dir: String,
  pub renderer: String,
  pub backend_build_command: Option<String>,
  pub router_file: Option<String>,
  pub typecheck_command: Option<String>,
  pub is_fullstack: bool,
  pub obfuscate: bool,
  pub sourcemap: bool,
  pub type_hint: bool,
  pub hash_length: usize,
  pub rpc_salt: Option<String>,
  pub root_id: String,
  pub data_id: String,
  pub i18n: Option<I18nSection>,
}

impl BuildConfig {
  pub fn from_seam_config(config: &SeamConfig) -> Result<Self> {
    let build = &config.build;

    let routes = match &build.routes {
      Some(r) => r.clone(),
      None => bail!("build.routes is required in seam.toml"),
    };

    let out_dir = build
      .out_dir
      .clone()
      .or_else(|| config.frontend.out_dir.clone())
      .unwrap_or_else(|| "dist".to_string());

    // Bundler mode: explicit command takes priority, then built-in via frontend.entry
    let (bundler_mode, bundler_manifest) = if let Some(cmd) =
      build.bundler_command.clone().or_else(|| config.frontend.build_command.clone())
    {
      let manifest = match &build.bundler_manifest {
        Some(m) => m.clone(),
        None => bail!("build.bundler_manifest is required when using a custom bundler command"),
      };
      (BundlerMode::Custom { command: cmd }, manifest)
    } else if let Some(entry) = config.frontend.entry.clone() {
      (BundlerMode::BuiltIn { entry }, "dist/.seam/manifest.json".to_string())
    } else {
      bail!(
        "set frontend.entry for the built-in bundler, or build.bundler_command for a custom bundler"
      );
    };

    let renderer = build.renderer.clone().unwrap_or_else(|| "react".to_string());
    if renderer != "react" {
      bail!("unsupported renderer '{}' (only 'react' is currently supported)", renderer);
    }
    let backend_build_command = build.backend_build_command.clone();
    let router_file = build.router_file.clone();
    let typecheck_command = build.typecheck_command.clone();
    let is_fullstack = backend_build_command.is_some();
    let obfuscate = build.obfuscate.unwrap_or(true);
    let sourcemap = build.sourcemap.unwrap_or(false);
    let type_hint = build.type_hint.unwrap_or(true);
    let hash_length = build.hash_length.unwrap_or(12) as usize;
    if !(4..=64).contains(&hash_length) {
      bail!("hash_length must be between 4 and 64 (got {hash_length})");
    }

    let root_id = config.frontend.root_id.clone();
    let data_id = config.frontend.data_id.clone();
    let i18n = config.i18n.clone();

    Ok(Self {
      bundler_mode,
      bundler_manifest,
      routes,
      out_dir,
      renderer,
      backend_build_command,
      router_file,
      typecheck_command,
      is_fullstack,
      obfuscate,
      sourcemap,
      type_hint,
      hash_length,
      rpc_salt: None,
      root_id,
      data_id,
      i18n,
    })
  }

  pub fn from_seam_config_dev(config: &SeamConfig) -> Result<Self> {
    let mut bc = Self::from_seam_config(config)?;
    bc.obfuscate = config.dev.obfuscate.unwrap_or(false);
    bc.sourcemap = config.dev.sourcemap.unwrap_or(true);
    bc.type_hint = config.dev.type_hint.unwrap_or(true);
    if let Some(n) = config.dev.hash_length {
      bc.hash_length = n as usize;
    }
    bc.rpc_salt = None;
    Ok(bc)
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::config::SeamConfig;

  fn parse_config(toml_str: &str) -> SeamConfig {
    toml::from_str(toml_str).unwrap()
  }

  #[test]
  fn custom_bundler_with_explicit_command() {
    let config = parse_config(
      r#"
[project]
name = "test"

[build]
routes = "./src/routes.ts"
out_dir = "dist"
bundler_command = "npx vite build"
bundler_manifest = "dist/.vite/manifest.json"
renderer = "react"
"#,
    );
    let build = BuildConfig::from_seam_config(&config).unwrap();
    assert!(
      matches!(build.bundler_mode, BundlerMode::Custom { command } if command == "npx vite build")
    );
    assert_eq!(build.bundler_manifest, "dist/.vite/manifest.json");
    assert_eq!(build.routes, "./src/routes.ts");
    assert_eq!(build.out_dir, "dist");
    assert_eq!(build.renderer, "react");
    assert!(!build.is_fullstack);
  }

  #[test]
  fn builtin_bundler_with_entry() {
    let config = parse_config(
      r#"
[project]
name = "test"

[frontend]
entry = "src/client/main.tsx"

[build]
routes = "./src/routes.ts"
out_dir = ".seam/output"
backend_build_command = "bun build src/server/index.ts --target=bun --outdir=.seam/output/server"
router_file = "src/server/router.ts"
"#,
    );
    let build = BuildConfig::from_seam_config(&config).unwrap();
    assert!(
      matches!(build.bundler_mode, BundlerMode::BuiltIn { entry } if entry == "src/client/main.tsx")
    );
    assert_eq!(build.bundler_manifest, "dist/.seam/manifest.json");
    assert!(build.is_fullstack);
  }

  #[test]
  fn fullstack_custom_bundler() {
    let config = parse_config(
      r#"
[project]
name = "test"

[build]
routes = "./src/routes.ts"
out_dir = ".seam/output"
bundler_command = "bunx vite build"
bundler_manifest = "dist/.vite/manifest.json"
backend_build_command = "bun build src/server/index.ts --target=bun --outdir=.seam/output/server"
router_file = "src/server/router.ts"
typecheck_command = "bunx tsc --noEmit"
"#,
    );
    let build = BuildConfig::from_seam_config(&config).unwrap();
    assert!(matches!(build.bundler_mode, BundlerMode::Custom { .. }));
    assert!(build.is_fullstack);
    assert_eq!(build.typecheck_command.as_deref(), Some("bunx tsc --noEmit"));
  }

  #[test]
  fn inherits_build_command_from_frontend() {
    let config = parse_config(
      r#"
[project]
name = "test"

[frontend]
build_command = "bun run build"
out_dir = "output"

[build]
routes = "./src/routes.ts"
bundler_manifest = "output/.vite/manifest.json"
"#,
    );
    let build = BuildConfig::from_seam_config(&config).unwrap();
    assert!(
      matches!(build.bundler_mode, BundlerMode::Custom { command } if command == "bun run build")
    );
    assert_eq!(build.out_dir, "output");
  }

  #[test]
  fn no_entry_no_command_errors() {
    let config = parse_config(
      r#"
[project]
name = "test"

[build]
routes = "./src/routes.ts"
"#,
    );
    let result = BuildConfig::from_seam_config(&config);
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(msg.contains("frontend.entry"));
  }

  #[test]
  fn build_config_obfuscate_defaults() {
    let config = parse_config(
      r#"
[project]
name = "test"

[frontend]
entry = "src/client/main.tsx"

[build]
routes = "./src/routes.ts"
out_dir = ".seam/output"
backend_build_command = "bun build"
router_file = "src/server/router.ts"
"#,
    );
    let bc = BuildConfig::from_seam_config(&config).unwrap();
    assert!(bc.obfuscate, "build defaults to obfuscate=true");
    assert!(!bc.sourcemap, "build defaults to sourcemap=false");
    assert!(bc.rpc_salt.is_none());
  }

  #[test]
  fn dev_config_obfuscate_defaults() {
    let config = parse_config(
      r#"
[project]
name = "test"

[frontend]
entry = "src/client/main.tsx"

[build]
routes = "./src/routes.ts"
out_dir = ".seam/output"
backend_build_command = "bun build"
router_file = "src/server/router.ts"
"#,
    );
    let bc = BuildConfig::from_seam_config_dev(&config).unwrap();
    assert!(!bc.obfuscate, "dev defaults to obfuscate=false");
    assert!(bc.sourcemap, "dev defaults to sourcemap=true");
  }

  #[test]
  fn explicit_obfuscate_overrides_defaults() {
    let config = parse_config(
      r#"
[project]
name = "test"

[frontend]
entry = "src/client/main.tsx"

[build]
routes = "./src/routes.ts"
out_dir = ".seam/output"
backend_build_command = "bun build"
router_file = "src/server/router.ts"
obfuscate = false
sourcemap = true

[dev]
obfuscate = true
sourcemap = false
"#,
    );
    let bc = BuildConfig::from_seam_config(&config).unwrap();
    assert!(!bc.obfuscate);
    assert!(bc.sourcemap);

    let bc_dev = BuildConfig::from_seam_config_dev(&config).unwrap();
    assert!(bc_dev.obfuscate);
    assert!(!bc_dev.sourcemap);
  }

  #[test]
  fn build_config_type_hint_defaults() {
    let config = parse_config(
      r#"
[project]
name = "test"

[frontend]
entry = "src/client/main.tsx"

[build]
routes = "./src/routes.ts"
out_dir = ".seam/output"
backend_build_command = "bun build"
router_file = "src/server/router.ts"
"#,
    );
    let bc = BuildConfig::from_seam_config(&config).unwrap();
    assert!(bc.type_hint, "build defaults to type_hint=true");

    let bc_dev = BuildConfig::from_seam_config_dev(&config).unwrap();
    assert!(bc_dev.type_hint, "dev defaults to type_hint=true");
  }

  #[test]
  fn explicit_type_hint_overrides() {
    let config = parse_config(
      r#"
[project]
name = "test"

[frontend]
entry = "src/client/main.tsx"

[build]
routes = "./src/routes.ts"
out_dir = ".seam/output"
backend_build_command = "bun build"
router_file = "src/server/router.ts"
type_hint = false

[dev]
type_hint = false
"#,
    );
    let bc = BuildConfig::from_seam_config(&config).unwrap();
    assert!(!bc.type_hint);

    let bc_dev = BuildConfig::from_seam_config_dev(&config).unwrap();
    assert!(!bc_dev.type_hint);
  }

  #[test]
  fn build_config_hash_length_defaults() {
    let config = parse_config(
      r#"
[project]
name = "test"

[frontend]
entry = "src/client/main.tsx"

[build]
routes = "./src/routes.ts"
out_dir = ".seam/output"
backend_build_command = "bun build"
router_file = "src/server/router.ts"
"#,
    );
    let bc = BuildConfig::from_seam_config(&config).unwrap();
    assert_eq!(bc.hash_length, 12, "build defaults to hash_length=12");

    let bc_dev = BuildConfig::from_seam_config_dev(&config).unwrap();
    assert_eq!(bc_dev.hash_length, 12, "dev inherits hash_length from build");
  }

  #[test]
  fn explicit_hash_length_overrides() {
    let config = parse_config(
      r#"
[project]
name = "test"

[frontend]
entry = "src/client/main.tsx"

[build]
routes = "./src/routes.ts"
out_dir = ".seam/output"
backend_build_command = "bun build"
router_file = "src/server/router.ts"
hash_length = 20

[dev]
hash_length = 8
"#,
    );
    let bc = BuildConfig::from_seam_config(&config).unwrap();
    assert_eq!(bc.hash_length, 20);

    let bc_dev = BuildConfig::from_seam_config_dev(&config).unwrap();
    assert_eq!(bc_dev.hash_length, 8);
  }

  #[test]
  fn hash_length_validation() {
    let config = parse_config(
      r#"
[project]
name = "test"

[frontend]
entry = "src/client/main.tsx"

[build]
routes = "./src/routes.ts"
out_dir = ".seam/output"
backend_build_command = "bun build"
router_file = "src/server/router.ts"
hash_length = 3
"#,
    );
    let result = BuildConfig::from_seam_config(&config);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("hash_length"));

    let config = parse_config(
      r#"
[project]
name = "test"

[frontend]
entry = "src/client/main.tsx"

[build]
routes = "./src/routes.ts"
out_dir = ".seam/output"
backend_build_command = "bun build"
router_file = "src/server/router.ts"
hash_length = 65
"#,
    );
    let result = BuildConfig::from_seam_config(&config);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("hash_length"));
  }

  #[test]
  fn custom_bundler_missing_manifest_errors() {
    let config = parse_config(
      r#"
[project]
name = "test"

[build]
routes = "./src/routes.ts"
bundler_command = "npx vite build"
"#,
    );
    let result = BuildConfig::from_seam_config(&config);
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(msg.contains("bundler_manifest"));
  }
}
