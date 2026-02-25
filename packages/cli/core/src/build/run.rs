/* packages/cli/core/src/build/run.rs */

// Build orchestrator: dispatches frontend-only (4 steps) or fullstack (7 steps) builds.

use std::path::Path;
use std::time::Instant;

use anyhow::{bail, Context, Result};

use super::config::{BuildConfig, BundlerMode};
use super::route::{
  extract_manifest, extract_manifest_command, generate_types, package_static_assets,
  print_asset_files, print_procedure_breakdown, process_routes, run_skeleton_renderer,
  run_typecheck, validate_procedure_references, CacheStats,
};
use super::types::{read_bundle_manifest, AssetFiles, ViteDevInfo};
use crate::config::SeamConfig;
use crate::shell::{run_builtin_bundler, run_command};
use crate::ui::{self, RESET, YELLOW};

#[derive(Debug, Clone, Copy)]
pub enum RebuildMode {
  /// src/server/** changed — full rebuild (manifest + codegen + bundle + skeletons + assets)
  Full,
  /// src/client/** or shared/** changed — frontend only (bundle + skeletons + assets)
  FrontendOnly,
}

/// Dispatch bundler based on mode
fn run_bundler(base_dir: &Path, mode: &BundlerMode, env: &[(&str, &str)]) -> Result<()> {
  match mode {
    BundlerMode::BuiltIn { entry } => run_builtin_bundler(base_dir, entry, "dist", env),
    BundlerMode::Custom { command } => run_command(base_dir, command, "bundler", env),
  }
}

/// Generate RPC hash map when obfuscation is enabled, write to out_dir
fn maybe_generate_rpc_hashes(
  build_config: &BuildConfig,
  manifest: &crate::manifest::Manifest,
  out_dir: &Path,
) -> Result<Option<super::rpc_hash::RpcHashMap>> {
  if !build_config.obfuscate {
    return Ok(None);
  }
  let names: Vec<&str> = manifest.procedures.keys().map(|s| s.as_str()).collect();
  let salt = build_config
    .rpc_salt
    .as_deref()
    .map(|s| s.to_string())
    .unwrap_or_else(super::rpc_hash::generate_random_salt);
  let map = super::rpc_hash::generate_rpc_hash_map(
    &names,
    &salt,
    build_config.hash_length,
    build_config.type_hint,
  )?;
  let path = out_dir.join("rpc-hash-map.json");
  std::fs::write(&path, serde_json::to_string_pretty(&map)?)?;
  ui::detail_ok("rpc-hash-map.json");
  Ok(Some(map))
}

/// Dispatch manifest extraction: manifest_command for non-JS backends, router_file for JS/TS
fn dispatch_extract_manifest(
  build_config: &BuildConfig,
  base_dir: &Path,
  out_dir: &Path,
) -> Result<crate::manifest::Manifest> {
  if let Some(cmd) = &build_config.manifest_command {
    extract_manifest_command(base_dir, cmd, out_dir)
  } else {
    let router_file = build_config
      .router_file
      .as_deref()
      .context("either router_file or manifest_command is required")?;
    extract_manifest(base_dir, router_file, out_dir)
  }
}

/// Public wrapper for workspace module access
pub fn maybe_generate_rpc_hashes_pub(
  build_config: &BuildConfig,
  manifest: &crate::manifest::Manifest,
  out_dir: &std::path::Path,
) -> Result<Option<super::rpc_hash::RpcHashMap>> {
  maybe_generate_rpc_hashes(build_config, manifest, out_dir)
}

/// Public wrapper for workspace module access
pub fn copy_wasm_binary_pub(base_dir: &Path, out_dir: &Path) -> Result<()> {
  copy_wasm_binary(base_dir, out_dir)
}

/// Construct ViteDevInfo when vite_port is configured
fn vite_info_from_config(config: &SeamConfig) -> Option<ViteDevInfo> {
  config.dev.vite_port.map(|port| ViteDevInfo {
    origin: format!("http://localhost:{port}"),
    entry: config
      .frontend
      .entry
      .clone()
      .expect("frontend.entry is required when dev.vite_port is set"),
  })
}

fn print_cache_stats(cache: &Option<CacheStats>) {
  if let Some(stats) = cache {
    ui::detail(&format!("skeleton cache: {} hit, {} miss", stats.hits, stats.misses));
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

  ui::banner("build", None);

  // [1/4] Bundle frontend
  ui::step(1, 4, "Bundling frontend");
  run_bundler(base_dir, &build_config.bundler_mode, &[])?;

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
  let skeleton_output = run_skeleton_renderer(
    &script_path,
    &routes_path,
    none_path,
    base_dir,
    build_config.i18n.as_ref(),
  )?;
  for w in &skeleton_output.warnings {
    ui::detail(&format!("{YELLOW}warning{RESET}: {w}"));
  }
  print_cache_stats(&skeleton_output.cache);
  ui::detail_ok(&format!("{} routes found", skeleton_output.routes.len()));
  ui::blank();

  // [3/4] Generate skeletons
  ui::step(3, 4, "Generating skeletons");
  let out_dir = base_dir.join(&build_config.out_dir);
  let templates_dir = out_dir.join("templates");
  std::fs::create_dir_all(&templates_dir)
    .with_context(|| format!("failed to create {}", templates_dir.display()))?;
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
  )?;
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
    "{template_count} templates \u{00b7} {asset_count} assets \u{00b7} {} \u{00b7} route-manifest.json",
    build_config.renderer,
  ));

  Ok(())
}

// -- Fullstack build (7 phases) --

#[allow(clippy::too_many_lines)]
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
  )?;

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
    print_asset_files(base_dir, "dist", &a);
    ui::blank();
    a
  };

  // [N] Generate skeletons
  step_num += 1;
  ui::step(step_num, total, "Generating skeletons");
  let script_path = base_dir.join("node_modules/@canmi/seam-react/scripts/build-skeletons.mjs");
  if !script_path.exists() {
    bail!("build-skeletons.mjs not found at {}", script_path.display());
  }
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
  )?;

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
    package_static_assets(base_dir, &assets, &out_dir)?;
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

/// Incremental rebuild for dev mode — skips banner/summary to keep output compact.
/// In Vite mode, skips bundler + manifest read + asset packaging (Vite serves assets directly).
pub fn run_incremental_rebuild(
  config: &SeamConfig,
  build_config: &BuildConfig,
  base_dir: &Path,
  mode: RebuildMode,
) -> Result<()> {
  let out_dir = base_dir.join(&build_config.out_dir);
  let vite = vite_info_from_config(config);
  let is_vite = vite.is_some();

  // Full mode reruns manifest extraction + codegen before frontend steps
  if matches!(mode, RebuildMode::Full) {
    let manifest = dispatch_extract_manifest(build_config, base_dir, &out_dir)?;

    let rpc_hashes = maybe_generate_rpc_hashes(build_config, &manifest, &out_dir)?;

    generate_types(&manifest, config, rpc_hashes.as_ref())?;
    copy_wasm_binary(base_dir, &out_dir)?;
  }

  // Frontend steps: bundle + skeletons + assets (bundle/assets skipped in Vite mode)
  let hash_length_str = build_config.hash_length.to_string();
  let rpc_map_path = out_dir.join("rpc-hash-map.json");
  let rpc_map_path_str =
    if rpc_map_path.exists() { rpc_map_path.to_string_lossy().to_string() } else { String::new() };
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
    run_bundler(base_dir, &build_config.bundler_mode, &bundler_env)?;
    let manifest_path = base_dir.join(&build_config.bundler_manifest);
    read_bundle_manifest(&manifest_path)?
  };

  let script_path = base_dir.join("node_modules/@canmi/seam-react/scripts/build-skeletons.mjs");
  if !script_path.exists() {
    bail!("build-skeletons.mjs not found at {}", script_path.display());
  }
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

  let manifest_str = std::fs::read_to_string(&manifest_json_path)
    .with_context(|| format!("failed to read {}", manifest_json_path.display()))?;
  let manifest: crate::manifest::Manifest = serde_json::from_str(&manifest_str)
    .with_context(|| format!("failed to parse {}", manifest_json_path.display()))?;
  validate_procedure_references(&manifest, &skeleton_output)?;

  let templates_dir = out_dir.join("templates");
  std::fs::create_dir_all(&templates_dir)
    .with_context(|| format!("failed to create {}", templates_dir.display()))?;
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
  )?;

  let route_manifest_path = out_dir.join("route-manifest.json");
  let route_manifest_json = serde_json::to_string_pretty(&route_manifest)?;
  std::fs::write(&route_manifest_path, &route_manifest_json)
    .with_context(|| format!("failed to write {}", route_manifest_path.display()))?;

  if !is_vite {
    package_static_assets(base_dir, &assets, &out_dir)?;
  }

  Ok(())
}

const WASM_FILENAME: &str = "seam_injector_wasm_bg.wasm";

/// Search for the injector WASM binary and copy it to {out_dir}/pkg/.
/// Checks workspace source first, then node_modules.
fn copy_wasm_binary(base_dir: &Path, out_dir: &Path) -> Result<()> {
  let candidates: Vec<std::path::PathBuf> = [
    // node_modules (npm/pnpm install)
    Some(base_dir.join("node_modules/@canmi/seam-injector/pkg").join(WASM_FILENAME)),
    // Workspace source (bun workspace — no node_modules symlink)
    find_workspace_wasm(base_dir),
  ]
  .into_iter()
  .flatten()
  .collect();

  for src in candidates {
    if src.exists() {
      let dest_dir = out_dir.join("pkg");
      std::fs::create_dir_all(&dest_dir)
        .with_context(|| format!("failed to create {}", dest_dir.display()))?;
      std::fs::copy(&src, dest_dir.join(WASM_FILENAME))
        .with_context(|| format!("failed to copy WASM binary from {}", src.display()))?;
      return Ok(());
    }
  }
  Ok(())
}

/// Walk up from base_dir looking for packages/server/injector/js/pkg/{WASM_FILENAME}.
fn find_workspace_wasm(base_dir: &Path) -> Option<std::path::PathBuf> {
  let mut dir = base_dir.to_path_buf();
  for _ in 0..5 {
    let candidate = dir.join("packages/server/injector/js/pkg").join(WASM_FILENAME);
    if candidate.exists() {
      return Some(candidate);
    }
    if !dir.pop() {
      break;
    }
  }
  None
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

  #[test]
  fn read_vite_manifest() {
    let dir = std::env::temp_dir().join("seam-test-vite-manifest");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("manifest.json");
    std::fs::write(
      &path,
      r#"{
        "src/client/main.tsx": {
          "file": "assets/main-abc123.js",
          "css": ["assets/main-def456.css"],
          "isEntry": true,
          "src": "src/client/main.tsx"
        }
      }"#,
    )
    .unwrap();
    let assets = read_bundle_manifest(&path).unwrap();
    assert_eq!(assets.js, vec!["assets/main-abc123.js"]);
    assert_eq!(assets.css, vec!["assets/main-def456.css"]);
    std::fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn read_vite_manifest_multiple_entries() {
    let dir = std::env::temp_dir().join("seam-test-vite-multi");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("manifest.json");
    std::fs::write(
      &path,
      r#"{
        "src/client/main.tsx": {
          "file": "assets/main-111.js",
          "css": ["assets/main-222.css"],
          "isEntry": true
        },
        "src/client/vendor.ts": {
          "file": "assets/vendor-333.js",
          "css": [],
          "isEntry": false
        }
      }"#,
    )
    .unwrap();
    let assets = read_bundle_manifest(&path).unwrap();
    assert_eq!(assets.js, vec!["assets/main-111.js"]);
    assert_eq!(assets.css, vec!["assets/main-222.css"]);
    std::fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn read_seam_manifest_not_confused_with_vite() {
    let dir = std::env::temp_dir().join("seam-test-no-confusion");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("manifest.json");
    std::fs::write(&path, r#"{"js":["assets/app.js"],"css":["assets/app.css"]}"#).unwrap();
    let assets = read_bundle_manifest(&path).unwrap();
    assert_eq!(assets.js, vec!["assets/app.js"]);
    assert_eq!(assets.css, vec!["assets/app.css"]);
    std::fs::remove_dir_all(&dir).ok();
  }
}
