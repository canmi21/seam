/* src/cli/core/src/build/run/fullstack.rs */

use std::path::Path;
use std::time::Instant;

use anyhow::{Context, Result};

use super::super::config::BuildConfig;
use super::super::route::export_i18n;
use super::super::route::generate_types;
use super::super::route::{
  package_static_assets, print_asset_files, print_procedure_breakdown, process_routes,
  read_i18n_messages, run_skeleton_renderer, run_typecheck, validate_procedure_references,
};
use super::super::types::{AssetFiles, read_bundle_manifest, read_bundle_manifest_extended};
use super::helpers::{
  dispatch_extract_manifest, maybe_generate_rpc_hashes, print_cache_stats, run_bundler,
  vite_info_from_config,
};
use super::rebuild::copy_wasm_binary;
use crate::config::SeamConfig;
use crate::shell::{resolve_node_module, run_command};
use crate::ui::{self, BRIGHT_CYAN, BRIGHT_GREEN, RESET, StepTracker, col};

// -- Step registry --

fn fullstack_steps(build_config: &BuildConfig) -> Vec<&'static str> {
  let mut steps = vec!["Compiling backend", "Extracting procedure manifest"];
  if build_config.obfuscate {
    steps.push("Generating RPC hash map");
  }
  steps.push("Generating client types");
  steps.push("Bundling frontend");
  if build_config.typecheck_command.is_some() {
    steps.push("Type checking");
  }
  steps.push("Rendering skeletons");
  steps.push("Processing routes");
  if build_config.i18n.is_some() {
    steps.push("Exporting i18n");
  }
  steps.push("Packaging output");
  steps
}

fn dev_steps(build_config: &BuildConfig, is_vite: bool) -> Vec<&'static str> {
  let mut steps = vec!["Extracting procedure manifest"];
  if build_config.obfuscate {
    steps.push("Generating RPC hash map");
  }
  steps.push("Generating client types");
  if !is_vite {
    steps.push("Bundling frontend");
  }
  steps.push("Rendering skeletons");
  steps.push("Processing routes");
  if build_config.i18n.is_some() {
    steps.push("Exporting i18n");
  }
  if !is_vite {
    steps.push("Packaging output");
  }
  steps
}

// -- Fullstack build --

#[allow(clippy::too_many_lines)]
pub(super) fn run_fullstack_build(
  config: &SeamConfig,
  build_config: &BuildConfig,
  base_dir: &Path,
) -> Result<()> {
  let started = Instant::now();
  let out_dir = base_dir.join(&build_config.out_dir);
  let manifest_path = base_dir.join(&build_config.bundler_manifest);

  ui::banner("build", Some(&config.project.name));

  let mut tracker = StepTracker::new(fullstack_steps(build_config));

  // -- Compiling backend --
  let t = tracker.begin();
  run_command(
    base_dir,
    build_config.backend_build_command.as_deref().unwrap(),
    "backend build",
    &[],
  )?;
  copy_wasm_binary(base_dir, &out_dir)?;
  tracker.end(t);

  // -- Extracting procedure manifest --
  let t = tracker.begin();
  let manifest = dispatch_extract_manifest(build_config, base_dir, &out_dir)?;
  print_procedure_breakdown(&manifest);
  tracker.end(t);

  // -- Generating RPC hash map (conditional) --
  let rpc_hashes = if build_config.obfuscate {
    let t = tracker.begin();
    let h = maybe_generate_rpc_hashes(build_config, &manifest, &out_dir)?;
    tracker.end(t);
    h
  } else {
    None
  };

  // -- Generating client types --
  let t = tracker.begin();
  generate_types(&manifest, config, rpc_hashes.as_ref())?;
  tracker.end(t);

  // -- Bundling frontend --
  let t = tracker.begin();
  let hash_length_str = build_config.hash_length.to_string();
  let rpc_map_path_str = if rpc_hashes.is_some() {
    out_dir.join("rpc-hash-map.json").to_string_lossy().to_string()
  } else {
    String::new()
  };
  let dist_dir_str = build_config.dist_dir().to_string();
  let routes_path_str = base_dir.join(&build_config.routes).to_string_lossy().to_string();
  let bundler_env: Vec<(&str, &str)> = vec![
    ("SEAM_OBFUSCATE", if build_config.obfuscate { "1" } else { "0" }),
    ("SEAM_SOURCEMAP", if build_config.sourcemap { "1" } else { "0" }),
    ("SEAM_TYPE_HINT", if build_config.type_hint { "1" } else { "0" }),
    ("SEAM_HASH_LENGTH", &hash_length_str),
    ("SEAM_RPC_MAP_PATH", &rpc_map_path_str),
    ("SEAM_DIST_DIR", &dist_dir_str),
    ("SEAM_ROUTES_FILE", &routes_path_str),
  ];
  run_bundler(base_dir, &build_config.bundler_mode, &dist_dir_str, &bundler_env)?;
  let assets = read_bundle_manifest(&manifest_path)?;
  print_asset_files(base_dir, build_config.dist_dir(), &assets);
  tracker.end(t);

  // -- Type checking (conditional) --
  if let Some(cmd) = &build_config.typecheck_command {
    let t = tracker.begin();
    run_typecheck(base_dir, cmd)?;
    tracker.end(t);
  }

  // -- Rendering skeletons --
  let t = tracker.begin();
  let script_path = resolve_node_module(base_dir, "@canmi/seam-react/scripts/build-skeletons.mjs")
    .ok_or_else(|| anyhow::anyhow!("build-skeletons.mjs not found -- install @canmi/seam-react"))?;
  let routes_path = base_dir.join(&build_config.routes);
  let manifest_json_path = out_dir.join("seam-manifest.json");
  let skeleton_output = run_skeleton_renderer(
    &script_path,
    &routes_path,
    &manifest_json_path,
    base_dir,
    build_config.i18n.as_ref(),
  )?;
  for w in &skeleton_output.warnings {
    ui::detail_warn(w);
  }
  print_cache_stats(&skeleton_output.cache);
  validate_procedure_references(&manifest, &skeleton_output)?;
  tracker.end(t);

  // -- Processing routes --
  let t = tracker.begin();
  let templates_dir = out_dir.join("templates");
  std::fs::create_dir_all(&templates_dir)
    .with_context(|| format!("failed to create {}", templates_dir.display()))?;
  let i18n_messages = match &build_config.i18n {
    Some(cfg) => Some(read_i18n_messages(base_dir, cfg)?),
    None => None,
  };

  // When sourceFileMap is available, parse extended manifest for per-page splitting.
  let bundle_manifest = if skeleton_output.source_file_map.is_some() {
    let vite_path = manifest_path.with_file_name("vite-manifest.json");
    read_bundle_manifest_extended(&vite_path)
      .or_else(|_| read_bundle_manifest_extended(&manifest_path))
      .ok()
  } else {
    None
  };

  // When splitting is active: template gets only main entry assets,
  // packaging gets all assets (including shared chunks and page entries).
  let (template_assets, package_assets) = match &bundle_manifest {
    Some(bm) => (&bm.template, &bm.global),
    None => (&assets, &assets),
  };

  let mut route_manifest = process_routes(
    &skeleton_output.layouts,
    &skeleton_output.routes,
    &templates_dir,
    template_assets,
    false,
    None,
    &build_config.root_id,
    &build_config.data_id,
    build_config.i18n.as_ref(),
    bundle_manifest.as_ref(),
    skeleton_output.source_file_map.as_ref(),
  )?;

  // Write route-manifest.json now if no i18n step follows, otherwise defer
  if build_config.i18n.is_none() {
    write_route_manifest(&out_dir, &route_manifest)?;
  }
  tracker.end(t);

  // -- Exporting i18n (conditional) --
  if let (Some(msgs), Some(cfg)) = (&i18n_messages, &build_config.i18n) {
    let t = tracker.begin();
    export_i18n(&out_dir, msgs, &mut route_manifest, cfg)?;
    write_route_manifest(&out_dir, &route_manifest)?;
    tracker.end(t);
  }

  // -- Packaging output --
  let t = tracker.begin();
  package_static_assets(base_dir, package_assets, &out_dir, build_config.dist_dir())?;
  tracker.end(t);

  // Summary
  let elapsed = started.elapsed().as_secs_f64();
  let proc_count = manifest.procedures.len();
  let template_count = skeleton_output.routes.len();
  let asset_count = package_assets.js.len() + package_assets.css.len();
  let (bg, bc, r) = (col(BRIGHT_GREEN), col(BRIGHT_CYAN), col(RESET));
  ui::ok(&format!("build complete in {bc}{elapsed:.1}s{r}"));
  ui::detail(&format!(
    "{bg}{proc_count}{r} procedures \u{00b7} {bg}{template_count}{r} templates \u{00b7} {bg}{asset_count}{r} assets \u{00b7} {}",
    build_config.renderer,
  ));

  Ok(())
}

// -- Dev build --

#[allow(clippy::too_many_lines)]
pub fn run_dev_build(
  config: &SeamConfig,
  build_config: &BuildConfig,
  base_dir: &Path,
) -> Result<()> {
  let started = Instant::now();
  let out_dir = base_dir.join(&build_config.out_dir);
  let vite = vite_info_from_config(config);
  let is_vite = vite.is_some();

  ui::banner("dev build", Some(&config.project.name));

  let mut tracker = StepTracker::new(dev_steps(build_config, is_vite));

  // -- Extracting procedure manifest --
  let t = tracker.begin();
  let manifest = dispatch_extract_manifest(build_config, base_dir, &out_dir)?;
  print_procedure_breakdown(&manifest);
  copy_wasm_binary(base_dir, &out_dir)?;
  tracker.end(t);

  // -- Generating RPC hash map (conditional) --
  let rpc_hashes = if build_config.obfuscate {
    let t = tracker.begin();
    let h = maybe_generate_rpc_hashes(build_config, &manifest, &out_dir)?;
    tracker.end(t);
    h
  } else {
    None
  };

  // -- Generating client types --
  let t = tracker.begin();
  generate_types(&manifest, config, rpc_hashes.as_ref())?;
  tracker.end(t);

  // -- Bundling frontend (skipped in Vite mode) --
  let hash_length_str = build_config.hash_length.to_string();
  let rpc_map_path_str = if rpc_hashes.is_some() {
    out_dir.join("rpc-hash-map.json").to_string_lossy().to_string()
  } else {
    String::new()
  };
  let dist_dir_str = build_config.dist_dir().to_string();
  let bundler_env: Vec<(&str, &str)> = vec![
    ("SEAM_OBFUSCATE", if build_config.obfuscate { "1" } else { "0" }),
    ("SEAM_SOURCEMAP", if build_config.sourcemap { "1" } else { "0" }),
    ("SEAM_TYPE_HINT", if build_config.type_hint { "1" } else { "0" }),
    ("SEAM_HASH_LENGTH", &hash_length_str),
    ("SEAM_RPC_MAP_PATH", &rpc_map_path_str),
    ("SEAM_DIST_DIR", &dist_dir_str),
  ];
  let assets = if is_vite {
    AssetFiles { css: vec![], js: vec![] }
  } else {
    let t = tracker.begin();
    run_bundler(base_dir, &build_config.bundler_mode, &dist_dir_str, &bundler_env)?;
    let manifest_path = base_dir.join(&build_config.bundler_manifest);
    let a = read_bundle_manifest(&manifest_path)?;
    print_asset_files(base_dir, build_config.dist_dir(), &a);
    tracker.end(t);
    a
  };

  // -- Rendering skeletons --
  let t = tracker.begin();
  let script_path = resolve_node_module(base_dir, "@canmi/seam-react/scripts/build-skeletons.mjs")
    .ok_or_else(|| anyhow::anyhow!("build-skeletons.mjs not found -- install @canmi/seam-react"))?;
  let routes_path = base_dir.join(&build_config.routes);
  let manifest_json_path = out_dir.join("seam-manifest.json");
  let skeleton_output = run_skeleton_renderer(
    &script_path,
    &routes_path,
    &manifest_json_path,
    base_dir,
    build_config.i18n.as_ref(),
  )?;
  for w in &skeleton_output.warnings {
    ui::detail_warn(w);
  }
  print_cache_stats(&skeleton_output.cache);
  validate_procedure_references(&manifest, &skeleton_output)?;
  tracker.end(t);

  // -- Processing routes --
  let t = tracker.begin();
  let templates_dir = out_dir.join("templates");
  std::fs::create_dir_all(&templates_dir)
    .with_context(|| format!("failed to create {}", templates_dir.display()))?;
  let i18n_messages = match &build_config.i18n {
    Some(cfg) => Some(read_i18n_messages(base_dir, cfg)?),
    None => None,
  };
  // Dev mode: no per-page splitting (no extended manifest)
  let mut route_manifest = process_routes(
    &skeleton_output.layouts,
    &skeleton_output.routes,
    &templates_dir,
    &assets,
    true,
    vite.as_ref(),
    &build_config.root_id,
    &build_config.data_id,
    build_config.i18n.as_ref(),
    None,
    None,
  )?;

  if build_config.i18n.is_none() {
    write_route_manifest(&out_dir, &route_manifest)?;
  }
  tracker.end(t);

  // -- Exporting i18n (conditional) --
  if let (Some(msgs), Some(cfg)) = (&i18n_messages, &build_config.i18n) {
    let t = tracker.begin();
    export_i18n(&out_dir, msgs, &mut route_manifest, cfg)?;
    write_route_manifest(&out_dir, &route_manifest)?;
    tracker.end(t);
  }

  // -- Packaging output (skipped in Vite mode) --
  if !is_vite {
    let t = tracker.begin();
    package_static_assets(base_dir, &assets, &out_dir, build_config.dist_dir())?;
    tracker.end(t);
  }

  // Summary
  let elapsed = started.elapsed().as_secs_f64();
  let proc_count = manifest.procedures.len();
  let template_count = skeleton_output.routes.len();
  let asset_count = assets.js.len() + assets.css.len();
  let (bg, bc, r) = (col(BRIGHT_GREEN), col(BRIGHT_CYAN), col(RESET));
  ui::ok(&format!("dev build complete in {bc}{elapsed:.1}s{r}"));
  if is_vite {
    ui::detail(&format!(
      "{bg}{proc_count}{r} procedures \u{00b7} {bg}{template_count}{r} templates \u{00b7} vite mode \u{00b7} {}",
      build_config.renderer,
    ));
  } else {
    ui::detail(&format!(
      "{bg}{proc_count}{r} procedures \u{00b7} {bg}{template_count}{r} templates \u{00b7} {bg}{asset_count}{r} assets \u{00b7} {}",
      build_config.renderer,
    ));
  }

  Ok(())
}

// -- Helpers --

fn write_route_manifest(
  out_dir: &Path,
  route_manifest: &super::super::route::RouteManifest,
) -> Result<()> {
  let path = out_dir.join("route-manifest.json");
  let json = serde_json::to_string_pretty(route_manifest)?;
  std::fs::write(&path, &json).with_context(|| format!("failed to write {}", path.display()))?;
  ui::detail_ok("route-manifest.json");
  Ok(())
}
