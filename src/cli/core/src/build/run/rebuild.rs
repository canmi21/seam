/* src/cli/core/src/build/run/rebuild.rs */

use std::path::Path;

use anyhow::{Context, Result};

use super::super::config::BuildConfig;
use super::super::route::generate_types;
use super::super::route::{
	BundleContext, RenderContext, build_reference_graph, export_i18n, generate_route_procedures_ts,
	inject_route_procedures, inject_route_projections, package_static_assets, process_routes,
	read_i18n_messages, report_narrowing_savings, validate_handoff_consistency, validate_invalidates,
	validate_procedure_references, warn_unused_queries,
};
use super::super::types::AssetFiles;
use super::helpers;
use super::helpers::{
	RebuildMode, dispatch_extract_manifest, maybe_generate_rpc_hashes, vite_info_from_config,
};
use super::steps;
use crate::config::SeamConfig;

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

	// Regenerate routes from pages dir when configured
	if let Some(pages_dir) = &build_config.pages_dir {
		let output = base_dir.join(".seam/generated/routes.ts");
		helpers::run_fs_router(base_dir, pages_dir, &output)?;
	}

	// Full mode reruns manifest extraction + codegen before frontend steps
	if matches!(mode, RebuildMode::Full) {
		let manifest = dispatch_extract_manifest(build_config, base_dir, &out_dir)?;

		let rpc_hashes = maybe_generate_rpc_hashes(build_config, &manifest, &out_dir)?;

		generate_types(&manifest, config, rpc_hashes.as_ref(), base_dir)?;
		copy_wasm_binary(base_dir, &out_dir)?;
	}

	// Frontend steps: bundle + skeletons + assets (bundle/assets skipped in Vite mode)
	let rpc_map_path = out_dir.join("rpc-hash-map.json");
	let rpc_map_path_str =
		if rpc_map_path.exists() { rpc_map_path.to_string_lossy().to_string() } else { String::new() };
	let bundler_env = steps::build_bundler_env(build_config, &rpc_map_path_str);
	let assets = if is_vite {
		AssetFiles { css: vec![], js: vec![] }
	} else {
		steps::bundle_frontend(build_config, base_dir, &bundler_env)?
	};

	let skeleton_output =
		steps::render_skeletons(build_config, base_dir, &out_dir.join("seam-manifest.json"))?;

	let manifest_json_path = out_dir.join("seam-manifest.json");
	let manifest_str = std::fs::read_to_string(&manifest_json_path)
		.with_context(|| format!("failed to read {}", manifest_json_path.display()))?;
	let manifest: seam_codegen::Manifest = serde_json::from_str(&manifest_str)
		.with_context(|| format!("failed to parse {}", manifest_json_path.display()))?;
	let ref_graph = build_reference_graph(&manifest, &skeleton_output);
	validate_procedure_references(&ref_graph)?;
	validate_invalidates(&manifest)?;
	validate_handoff_consistency(&ref_graph);
	warn_unused_queries(&ref_graph, &manifest);

	let rp_path = base_dir.join(".seam/generated/route-procedures.ts");
	generate_route_procedures_ts(&ref_graph, &manifest, &rp_path)?;

	let templates_dir = out_dir.join("templates");
	std::fs::create_dir_all(&templates_dir)
		.with_context(|| format!("failed to create {}", templates_dir.display()))?;
	let i18n_messages = match &build_config.i18n {
		Some(cfg) => Some(read_i18n_messages(base_dir, cfg)?),
		None => None,
	};
	// Rebuild path: no per-page splitting (dev mode)
	let render = RenderContext {
		root_id: &build_config.root_id,
		data_id: &build_config.data_id,
		dev_mode: true,
		vite: vite.as_ref(),
	};
	let bundle_ctx = BundleContext { manifest: None, source_file_map: None };
	let mut route_manifest = process_routes(
		&skeleton_output.layouts,
		&skeleton_output.routes,
		&templates_dir,
		&assets,
		&render,
		build_config.i18n.as_ref(),
		&bundle_ctx,
	)?;
	inject_route_procedures(&mut route_manifest, &ref_graph);

	inject_route_projections(&mut route_manifest, &out_dir)?;
	report_narrowing_savings(&route_manifest);

	if let (Some(msgs), Some(cfg)) = (&i18n_messages, &build_config.i18n) {
		export_i18n(&out_dir, msgs, &mut route_manifest, cfg)?;
	}

	let meta = Some(super::super::route::build_manifest_meta(build_config));
	steps::write_route_manifest(&out_dir, &mut route_manifest, meta)?;

	if !is_vite {
		package_static_assets(base_dir, &out_dir, build_config.dist_dir())?;
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
