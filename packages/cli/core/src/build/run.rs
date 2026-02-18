/* packages/cli/core/src/build/run.rs */

// Build orchestrator: dispatches frontend-only (4 steps) or fullstack (7 steps) builds.

use std::path::Path;
use std::time::Instant;

use anyhow::{bail, Context, Result};

use super::config::{BuildConfig, BundlerMode};
use super::route::{
  extract_manifest, generate_types, package_static_assets, print_asset_files,
  print_procedure_breakdown, process_routes, run_skeleton_renderer, run_typecheck,
};
use super::types::read_bundle_manifest;
use crate::config::SeamConfig;
use crate::shell::{run_builtin_bundler, run_command};
use crate::ui::{self, RESET, YELLOW};

/// Dispatch bundler based on mode
fn run_bundler(base_dir: &Path, mode: &BundlerMode) -> Result<()> {
  match mode {
    BundlerMode::BuiltIn { entry } => run_builtin_bundler(base_dir, entry, "dist"),
    BundlerMode::Custom { command } => run_command(base_dir, command, "bundler"),
  }
}

// -- Entry point --

pub fn run_build(config: &SeamConfig, base_dir: &Path) -> Result<()> {
  let build_config = BuildConfig::from_seam_config(config)?;
  if build_config.is_fullstack {
    run_fullstack_build(config, &build_config, base_dir)
  } else {
    run_frontend_build(&build_config, base_dir)
  }
}

// -- Frontend-only build (4 steps) --

fn run_frontend_build(build_config: &BuildConfig, base_dir: &Path) -> Result<()> {
  let started = Instant::now();

  ui::banner("build");

  // [1/4] Bundle frontend
  ui::step(1, 4, "Bundling frontend");
  run_bundler(base_dir, &build_config.bundler_mode)?;

  let manifest_path = base_dir.join(&build_config.bundler_manifest);
  let assets = read_bundle_manifest(&manifest_path)?;
  print_asset_files(base_dir, "dist", &assets);
  ui::blank();

  // [2/4] Extract routes
  ui::step(2, 4, "Extracting routes");
  let script_path = base_dir.join("node_modules/@canmi/seam-react/scripts/build-skeletons.mjs");
  if !script_path.exists() {
    bail!("build-skeletons.mjs not found at {}", script_path.display());
  }
  let routes_path = base_dir.join(&build_config.routes);
  let none_path = Path::new("none");
  let skeleton_output = run_skeleton_renderer(&script_path, &routes_path, none_path, base_dir)?;
  for w in &skeleton_output.warnings {
    ui::detail(&format!("{YELLOW}warning{RESET}: {w}"));
  }
  ui::detail_ok(&format!("{} routes found", skeleton_output.routes.len()));
  ui::blank();

  // [3/4] Generate skeletons
  ui::step(3, 4, "Generating skeletons");
  let out_dir = base_dir.join(&build_config.out_dir);
  let templates_dir = out_dir.join("templates");
  std::fs::create_dir_all(&templates_dir)
    .with_context(|| format!("failed to create {}", templates_dir.display()))?;
  let route_manifest = process_routes(&skeleton_output.routes, &templates_dir, &assets)?;
  ui::blank();

  // [4/4] Write route manifest
  ui::step(4, 4, "Writing route manifest");
  let manifest_out = out_dir.join("route-manifest.json");
  let manifest_json = serde_json::to_string_pretty(&route_manifest)?;
  std::fs::write(&manifest_out, &manifest_json)
    .with_context(|| format!("failed to write {}", manifest_out.display()))?;
  ui::detail_ok("route-manifest.json");
  ui::blank();

  // Summary
  let elapsed = started.elapsed().as_secs_f64();
  let template_count = skeleton_output.routes.len();
  let asset_count = assets.js.len() + assets.css.len();
  ui::ok(&format!("build complete in {elapsed:.1}s"));
  ui::detail(&format!(
    "{template_count} templates \u{00b7} {asset_count} assets \u{00b7} route-manifest.json"
  ));

  Ok(())
}

// -- Fullstack build (7 phases) --

fn run_fullstack_build(
  config: &SeamConfig,
  build_config: &BuildConfig,
  base_dir: &Path,
) -> Result<()> {
  let started = Instant::now();
  let out_dir = base_dir.join(&build_config.out_dir);

  // Determine total steps (typecheck is optional)
  let has_typecheck = build_config.typecheck_command.is_some();
  let total: u32 = if has_typecheck { 7 } else { 6 };
  let mut step_num: u32 = 0;

  ui::banner("build");

  // [1] Compile backend
  step_num += 1;
  ui::step(step_num, total, "Compiling backend");
  run_command(base_dir, build_config.backend_build_command.as_deref().unwrap(), "backend build")?;
  ui::blank();

  // [2] Extract procedure manifest
  step_num += 1;
  ui::step(step_num, total, "Extracting procedure manifest");
  let router_file =
    build_config.router_file.as_deref().context("router_file is required for fullstack build")?;
  let manifest = extract_manifest(base_dir, router_file, &out_dir)?;
  print_procedure_breakdown(&manifest);
  ui::blank();

  // [3] Generate client types
  step_num += 1;
  ui::step(step_num, total, "Generating client types");
  generate_types(&manifest, config)?;
  ui::blank();

  // [4] Bundle frontend
  step_num += 1;
  ui::step(step_num, total, "Bundling frontend");
  run_bundler(base_dir, &build_config.bundler_mode)?;
  let manifest_path = base_dir.join(&build_config.bundler_manifest);
  let assets = read_bundle_manifest(&manifest_path)?;
  print_asset_files(base_dir, "dist", &assets);
  ui::blank();

  // [5] Type check (optional)
  if let Some(cmd) = &build_config.typecheck_command {
    step_num += 1;
    ui::step(step_num, total, "Type checking");
    run_typecheck(base_dir, cmd)?;
    ui::blank();
  }

  // [6] Generate skeletons
  step_num += 1;
  ui::step(step_num, total, "Generating skeletons");
  let script_path = base_dir.join("node_modules/@canmi/seam-react/scripts/build-skeletons.mjs");
  if !script_path.exists() {
    bail!("build-skeletons.mjs not found at {}", script_path.display());
  }
  let routes_path = base_dir.join(&build_config.routes);
  let manifest_json_path = out_dir.join("seam-manifest.json");
  let skeleton_output =
    run_skeleton_renderer(&script_path, &routes_path, &manifest_json_path, base_dir)?;
  for w in &skeleton_output.warnings {
    ui::detail(&format!("{YELLOW}warning{RESET}: {w}"));
  }

  let templates_dir = out_dir.join("templates");
  std::fs::create_dir_all(&templates_dir)
    .with_context(|| format!("failed to create {}", templates_dir.display()))?;
  let route_manifest = process_routes(&skeleton_output.routes, &templates_dir, &assets)?;

  // Write route-manifest.json
  let route_manifest_path = out_dir.join("route-manifest.json");
  let route_manifest_json = serde_json::to_string_pretty(&route_manifest)?;
  std::fs::write(&route_manifest_path, &route_manifest_json)
    .with_context(|| format!("failed to write {}", route_manifest_path.display()))?;
  ui::detail_ok("route-manifest.json");
  ui::blank();

  // [7] Package output
  step_num += 1;
  ui::step(step_num, total, "Packaging output");
  package_static_assets(base_dir, &assets, &out_dir)?;
  ui::blank();

  // Summary
  let elapsed = started.elapsed().as_secs_f64();
  let proc_count = manifest.procedures.len();
  let template_count = skeleton_output.routes.len();
  let asset_count = assets.js.len() + assets.css.len();
  ui::ok(&format!("build complete in {elapsed:.1}s"));
  ui::detail(&format!(
    "{proc_count} procedures \u{00b7} {template_count} templates \u{00b7} {asset_count} assets"
  ));

  Ok(())
}

#[cfg(test)]
mod tests {
  use super::super::types::read_bundle_manifest;

  #[test]
  fn read_seam_manifest() {
    let dir = std::env::temp_dir().join("seam-test-manifest");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("manifest.json");
    std::fs::write(&path, r#"{"js":["assets/main-abc123.js"],"css":["assets/style-xyz789.css"]}"#)
      .unwrap();
    let assets = read_bundle_manifest(&path).unwrap();
    assert_eq!(assets.js, vec!["assets/main-abc123.js"]);
    assert_eq!(assets.css, vec!["assets/style-xyz789.css"]);
    std::fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn read_seam_manifest_empty() {
    let dir = std::env::temp_dir().join("seam-test-manifest-empty");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("manifest.json");
    std::fs::write(&path, r#"{"js":[],"css":[]}"#).unwrap();
    let assets = read_bundle_manifest(&path).unwrap();
    assert!(assets.js.is_empty());
    assert!(assets.css.is_empty());
    std::fs::remove_dir_all(&dir).ok();
  }
}
