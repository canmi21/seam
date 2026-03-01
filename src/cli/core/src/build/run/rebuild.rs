/* src/cli/core/src/build/run/rebuild.rs */

use std::path::Path;

use anyhow::{Context, Result};

use super::super::config::BuildConfig;
use super::super::route::generate_types;
use super::super::route::{
  export_i18n, package_static_assets, process_routes, read_i18n_messages, run_skeleton_renderer,
  validate_procedure_references,
};
use super::super::types::{AssetFiles, read_bundle_manifest};
use super::helpers::{
  RebuildMode, dispatch_extract_manifest, maybe_generate_rpc_hashes, print_cache_stats,
  run_bundler, vite_info_from_config,
};
use crate::config::SeamConfig;
use crate::shell::resolve_node_module;
use crate::ui::{self, RESET, YELLOW};

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
    run_bundler(base_dir, &build_config.bundler_mode, &dist_dir_str, &bundler_env)?;
    let manifest_path = base_dir.join(&build_config.bundler_manifest);
    read_bundle_manifest(&manifest_path)?
  };

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

  let manifest_str = std::fs::read_to_string(&manifest_json_path)
    .with_context(|| format!("failed to read {}", manifest_json_path.display()))?;
  let manifest: seam_codegen::Manifest = serde_json::from_str(&manifest_str)
    .with_context(|| format!("failed to parse {}", manifest_json_path.display()))?;
  validate_procedure_references(&manifest, &skeleton_output)?;

  let templates_dir = out_dir.join("templates");
  std::fs::create_dir_all(&templates_dir)
    .with_context(|| format!("failed to create {}", templates_dir.display()))?;
  let i18n_messages = match &build_config.i18n {
    Some(cfg) => Some(read_i18n_messages(base_dir, cfg)?),
    None => None,
  };
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
  )?;
  if let (Some(msgs), Some(cfg)) = (&i18n_messages, &build_config.i18n) {
    export_i18n(&out_dir, msgs, &mut route_manifest, cfg)?;
  }

  let route_manifest_path = out_dir.join("route-manifest.json");
  let route_manifest_json = serde_json::to_string_pretty(&route_manifest)?;
  std::fs::write(&route_manifest_path, &route_manifest_json)
    .with_context(|| format!("failed to write {}", route_manifest_path.display()))?;

  if !is_vite {
    package_static_assets(base_dir, &assets, &out_dir, build_config.dist_dir())?;
  }

  Ok(())
}

/// WASM binaries to copy: (filename, npm package path, workspace source path)
const WASM_BINARIES: &[(&str, &str, &str)] = &[
  ("injector.wasm", "@canmi/seam-injector/pkg", "src/server/injector/js/pkg"),
  ("engine.wasm", "@canmi/seam-engine/pkg", "src/server/engine/js/pkg"),
];

/// Search for WASM binaries (injector + engine) and copy them to {out_dir}/pkg/.
/// Checks workspace source first, then node_modules.
pub(super) fn copy_wasm_binary(base_dir: &Path, out_dir: &Path) -> Result<()> {
  for &(filename, npm_path, workspace_path) in WASM_BINARIES {
    let candidates: Vec<std::path::PathBuf> = [
      // node_modules (npm/pnpm install)
      Some(base_dir.join("node_modules").join(npm_path).join(filename)),
      // Workspace source (bun workspace — no node_modules symlink)
      find_workspace_wasm(base_dir, workspace_path, filename),
    ]
    .into_iter()
    .flatten()
    .collect();

    for src in candidates {
      if src.exists() {
        let dest_dir = out_dir.join("pkg");
        std::fs::create_dir_all(&dest_dir)
          .with_context(|| format!("failed to create {}", dest_dir.display()))?;
        std::fs::copy(&src, dest_dir.join(filename))
          .with_context(|| format!("failed to copy WASM binary from {}", src.display()))?;
        break;
      }
    }
  }
  Ok(())
}

/// Public wrapper for workspace module access
pub fn copy_wasm_binary_pub(base_dir: &Path, out_dir: &Path) -> Result<()> {
  copy_wasm_binary(base_dir, out_dir)
}

/// Walk up from base_dir looking for {workspace_path}/{filename}.
fn find_workspace_wasm(
  base_dir: &Path,
  workspace_path: &str,
  filename: &str,
) -> Option<std::path::PathBuf> {
  let mut dir = base_dir.to_path_buf();
  for _ in 0..5 {
    let candidate = dir.join(workspace_path).join(filename);
    if candidate.exists() {
      return Some(candidate);
    }
    if !dir.pop() {
      break;
    }
  }
  None
}
