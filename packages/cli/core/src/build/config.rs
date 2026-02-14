/* packages/cli/core/src/build/config.rs */

use anyhow::{bail, Result};

use crate::config::SeamConfig;

#[derive(Debug)]
pub struct BuildConfig {
  pub bundler_command: String,
  pub bundler_manifest: String,
  pub routes: String,
  pub out_dir: String,
  pub renderer: String,
}

impl BuildConfig {
  pub fn from_seam_config(config: &SeamConfig) -> Result<Self> {
    let build = &config.build;

    let bundler_command = build
      .bundler_command
      .clone()
      .or_else(|| config.frontend.build_command.clone())
      .unwrap_or_else(|| "npx vite build".to_string());

    let bundler_manifest = match &build.bundler_manifest {
      Some(m) => m.clone(),
      None => bail!("build.bundler_manifest is required in seam.toml"),
    };

    let routes = match &build.routes {
      Some(r) => r.clone(),
      None => bail!("build.routes is required in seam.toml"),
    };

    let out_dir = build
      .out_dir
      .clone()
      .or_else(|| config.frontend.out_dir.clone())
      .unwrap_or_else(|| "dist".to_string());

    let renderer = build.renderer.clone().unwrap_or_else(|| "react".to_string());

    Ok(Self { bundler_command, bundler_manifest, routes, out_dir, renderer })
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
  fn from_seam_config_full() {
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
    assert_eq!(build.bundler_command, "npx vite build");
    assert_eq!(build.routes, "./src/routes.ts");
    assert_eq!(build.out_dir, "dist");
    assert_eq!(build.renderer, "react");
  }

  #[test]
  fn from_seam_config_inherits_frontend() {
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
    assert_eq!(build.bundler_command, "bun run build");
    assert_eq!(build.out_dir, "output");
  }

  #[test]
  fn missing_required_fields_errors() {
    let config = parse_config(
      r#"
[project]
name = "test"
"#,
    );
    let result = BuildConfig::from_seam_config(&config);
    assert!(result.is_err());
  }
}
