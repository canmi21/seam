/* packages/cli/core/src/build/run/fullstack.rs */

use std::path::Path;
use std::time::Instant;

use anyhow::{Context, Result};

use super::super::config::BuildConfig;
use super::super::route::generate_types;
use super::super::route::{
  export_i18n_messages, package_static_assets, print_asset_files, print_procedure_breakdown,
  process_routes, read_i18n_messages, run_skeleton_renderer, run_typecheck,
  validate_procedure_references,
};
use super::super::types::{read_bundle_manifest, AssetFiles};
use super::helpers::{
  dispatch_extract_manifest, maybe_generate_rpc_hashes, print_cache_stats, run_bundler,
  vite_info_from_config,
};
use super::rebuild::copy_wasm_binary;
use crate::config::SeamConfig;
use crate::shell::{resolve_node_module, run_command};
use crate::ui::{self, RESET, YELLOW};

// -- Fullstack build (7 phases) --

#[allow(clippy::too_many_lines)]
pub(super) fn run_fullstack_build(
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

  ui::banner("build", Some(&config.project.name));

  // [1] Compile backend
  step_num += 1;
  ui::step(step_num, total, "Compiling backend");
  run_command(
    base_dir,
    build_config.backend_build_command.as_deref().unwrap(),
    "backend build",
    &[],
  )?;

  // Copy WASM binary next to bundled server output so runtime readFileSync resolves correctly.
  // The bundled injector code does: resolve(__dirname, "../pkg/seam_injector_wasm_bg.wasm")
  // which, from {out_dir}/server/index.js, resolves to {out_dir}/pkg/.
  copy_wasm_binary(base_dir, &out_dir)?;
  ui::blank();

  // [2] Extract procedure manifest
  step_num += 1;
  ui::step(step_num, total, "Extracting procedure manifest");
  let manifest = dispatch_extract_manifest(build_config, base_dir, &out_dir)?;
  print_procedure_breakdown(&manifest);
  ui::blank();

  let rpc_hashes = maybe_generate_rpc_hashes(build_config, &manifest, &out_dir)?;

  // [3] Generate client types
  step_num += 1;
  ui::step(step_num, total, "Generating client types");
  generate_types(&manifest, config, rpc_hashes.as_ref())?;
  ui::blank();

  // [4] Bundle frontend
  step_num += 1;
  ui::step(step_num, total, "Bundling frontend");
  let hash_length_str = build_config.hash_length.to_string();
  let rpc_map_path_str = if rpc_hashes.is_some() {
    out_dir.join("rpc-hash-map.json").to_string_lossy().to_string()
  } else {
    String::new()
  };
  let bundler_env: Vec<(&str, &str)> = vec![
    ("SEAM_OBFUSCATE", if build_config.obfuscate { "1" } else { "0" }),
    ("SEAM_SOURCEMAP", if build_config.sourcemap { "1" } else { "0" }),
    ("SEAM_TYPE_HINT", if build_config.type_hint { "1" } else { "0" }),
    ("SEAM_HASH_LENGTH", &hash_length_str),
    ("SEAM_RPC_MAP_PATH", &rpc_map_path_str),
  ];
  run_bundler(base_dir, &build_config.bundler_mode, &bundler_env)?;
  let manifest_path = base_dir.join(&build_config.bundler_manifest);
  let assets = read_bundle_manifest(&manifest_path)?;
  print_asset_files(base_dir, build_config.dist_dir(), &assets);
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
    ui::detail(&format!("{YELLOW}warning{RESET}: {w}"));
  }
  print_cache_stats(&skeleton_output.cache);
  validate_procedure_references(&manifest, &skeleton_output)?;

  let templates_dir = out_dir.join("templates");
  std::fs::create_dir_all(&templates_dir)
    .with_context(|| format!("failed to create {}", templates_dir.display()))?;
  let i18n_messages = match &build_config.i18n {
    Some(cfg) => Some(read_i18n_messages(base_dir, cfg)?),
    None => None,
  };
  let route_manifest = process_routes(
    &skeleton_output.layouts,
    &skeleton_output.routes,
    &templates_dir,
    &assets,
    false,
    None,
    &build_config.root_id,
    &build_config.data_id,
    build_config.i18n.as_ref(),
    i18n_messages.as_ref(),
  )?;
  if let Some(ref msgs) = i18n_messages {
    export_i18n_messages(&out_dir, msgs)?;
  }

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
  package_static_assets(base_dir, &assets, &out_dir, build_config.dist_dir())?;
  ui::blank();

  // Summary
  let elapsed = started.elapsed().as_secs_f64();
  let proc_count = manifest.procedures.len();
  let template_count = skeleton_output.routes.len();
  let asset_count = assets.js.len() + assets.css.len();
  ui::ok(&format!("build complete in {elapsed:.1}s"));
  ui::detail(&format!(
    "{proc_count} procedures \u{00b7} {template_count} templates \u{00b7} {asset_count} assets \u{00b7} {}",
    build_config.renderer,
  ));

  Ok(())
}

// -- Dev build (5 phases, skips backend compile + typecheck) --

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

  // Vite mode: 3 steps (manifest + codegen + skeletons), no bundler/packaging
  // Normal mode: 5 steps (manifest + codegen + bundle + skeletons + package)
  let total: u32 = if is_vite { 3 } else { 5 };
  let mut step_num: u32 = 0;

  ui::banner("dev build", Some(&config.project.name));

  // [1] Extract procedure manifest
  step_num += 1;
  ui::step(step_num, total, "Extracting procedure manifest");
  let manifest = dispatch_extract_manifest(build_config, base_dir, &out_dir)?;
  print_procedure_breakdown(&manifest);
  copy_wasm_binary(base_dir, &out_dir)?;
  ui::blank();

  let rpc_hashes = maybe_generate_rpc_hashes(build_config, &manifest, &out_dir)?;

  // [2] Generate client types
  step_num += 1;
  ui::step(step_num, total, "Generating client types");
  generate_types(&manifest, config, rpc_hashes.as_ref())?;
  ui::blank();

  // [3] Bundle frontend (skipped in Vite mode — Vite serves assets directly)
  let hash_length_str = build_config.hash_length.to_string();
  let rpc_map_path_str = if rpc_hashes.is_some() {
    out_dir.join("rpc-hash-map.json").to_string_lossy().to_string()
  } else {
    String::new()
  };
  let bundler_env: Vec<(&str, &str)> = vec![
    ("SEAM_OBFUSCATE", if build_config.obfuscate { "1" } else { "0" }),
    ("SEAM_SOURCEMAP", if build_config.sourcemap { "1" } else { "0" }),
    ("SEAM_TYPE_HINT", if build_config.type_hint { "1" } else { "0" }),
    ("SEAM_HASH_LENGTH", &hash_length_str),
    ("SEAM_RPC_MAP_PATH", &rpc_map_path_str),
  ];
  let assets = if is_vite {
    AssetFiles { css: vec![], js: vec![] }
  } else {
    step_num += 1;
    ui::step(step_num, total, "Bundling frontend");
    run_bundler(base_dir, &build_config.bundler_mode, &bundler_env)?;
    let manifest_path = base_dir.join(&build_config.bundler_manifest);
    let a = read_bundle_manifest(&manifest_path)?;
    print_asset_files(base_dir, build_config.dist_dir(), &a);
    ui::blank();
    a
  };

  // [N] Generate skeletons
  step_num += 1;
  ui::step(step_num, total, "Generating skeletons");
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
    ui::detail(&format!("{YELLOW}warning{RESET}: {w}"));
  }
  print_cache_stats(&skeleton_output.cache);
  validate_procedure_references(&manifest, &skeleton_output)?;

  let templates_dir = out_dir.join("templates");
  std::fs::create_dir_all(&templates_dir)
    .with_context(|| format!("failed to create {}", templates_dir.display()))?;
  let i18n_messages = match &build_config.i18n {
    Some(cfg) => Some(read_i18n_messages(base_dir, cfg)?),
    None => None,
  };
  let route_manifest = process_routes(
    &skeleton_output.layouts,
    &skeleton_output.routes,
    &templates_dir,
    &assets,
    true,
    vite.as_ref(),
    &build_config.root_id,
    &build_config.data_id,
    build_config.i18n.as_ref(),
    i18n_messages.as_ref(),
  )?;
  if let Some(ref msgs) = i18n_messages {
    export_i18n_messages(&out_dir, msgs)?;
  }

  let route_manifest_path = out_dir.join("route-manifest.json");
  let route_manifest_json = serde_json::to_string_pretty(&route_manifest)?;
  std::fs::write(&route_manifest_path, &route_manifest_json)
    .with_context(|| format!("failed to write {}", route_manifest_path.display()))?;
  ui::detail_ok("route-manifest.json");
  ui::blank();

  // [N] Package output (skipped in Vite mode)
  if !is_vite {
    step_num += 1;
    ui::step(step_num, total, "Packaging output");
    package_static_assets(base_dir, &assets, &out_dir, build_config.dist_dir())?;
    ui::blank();
  }

  // Summary
  let elapsed = started.elapsed().as_secs_f64();
  let proc_count = manifest.procedures.len();
  let template_count = skeleton_output.routes.len();
  let asset_count = assets.js.len() + assets.css.len();
  ui::ok(&format!("dev build complete in {elapsed:.1}s"));
  if is_vite {
    ui::detail(&format!(
      "{proc_count} procedures \u{00b7} {template_count} templates \u{00b7} vite mode \u{00b7} {}",
      build_config.renderer,
    ));
  } else {
    ui::detail(&format!(
      "{proc_count} procedures \u{00b7} {template_count} templates \u{00b7} {asset_count} assets \u{00b7} {}",
      build_config.renderer,
    ));
  }

  Ok(())
}
