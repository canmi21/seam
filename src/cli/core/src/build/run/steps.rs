/* src/cli/core/src/build/run/steps.rs */

// Shared build step helpers: bundler env, skeleton rendering, frontend bundling.
// Extracted from fullstack, frontend, rebuild, and workspace builds.

use std::path::Path;

use anyhow::{Context, Result};

use super::super::config::BuildConfig;
use super::super::route::{
	BundleContext, ProcedureRefGraph, RenderContext, RouteManifest, SkeletonOutput, export_i18n,
	inject_route_procedures, inject_route_projections, process_routes, read_i18n_messages,
	report_narrowing_savings, run_skeleton_renderer,
};
use super::super::types::{AssetFiles, read_bundle_manifest};
use super::helpers::{print_cache_stats, run_bundler};
use crate::shell::resolve_node_module;
use crate::ui::{self, DIM, RESET, StepTracker, col};

pub(crate) type EnvPairs = Vec<(String, String)>;

/// Shared bundler environment variables derived from build config.
/// Returns owned pairs for lifetime independence. Callers may extend
/// with extra entries (e.g. SEAM_ROUTES_FILE) before passing to `bundle_frontend`.
pub(crate) fn build_bundler_env(build_config: &BuildConfig, rpc_map_path: &str) -> EnvPairs {
	let mut env = vec![
		("SEAM_OBFUSCATE".into(), if build_config.obfuscate { "1" } else { "0" }.into()),
		("SEAM_SOURCEMAP".into(), if build_config.sourcemap { "1" } else { "0" }.into()),
		("SEAM_TYPE_HINT".into(), if build_config.type_hint { "1" } else { "0" }.into()),
		("SEAM_HASH_LENGTH".into(), build_config.hash_length.to_string()),
		("SEAM_RPC_MAP_PATH".into(), rpc_map_path.into()),
		("SEAM_DIST_DIR".into(), build_config.dist_dir().to_string()),
	];
	if let Some(ref entry) = build_config.entry {
		env.push(("SEAM_ENTRY".into(), entry.clone()));
	}
	if let Some(ref path) = build_config.config_path {
		env.push(("SEAM_CONFIG_PATH".into(), path.clone()));
	}
	if let Some(ref vite) = build_config.vite
		&& let Ok(json) = serde_json::to_string(vite)
	{
		env.push(("SEAM_VITE_CONFIG".into(), json));
	}
	env
}

/// Render skeletons via `@canmi/seam-react` build script. Resolves the script
/// from node_modules, invokes the renderer, and prints warnings + cache stats.
pub(crate) fn render_skeletons(
	build_config: &BuildConfig,
	base_dir: &Path,
	manifest_json_path: &Path,
) -> Result<SkeletonOutput> {
	let script_path = resolve_node_module(base_dir, "@canmi/seam-react/scripts/build-skeletons.mjs")
		.ok_or_else(|| anyhow::anyhow!("build-skeletons.mjs not found -- install @canmi/seam-react"))?;
	let routes_path = base_dir.join(&build_config.routes);
	let output = run_skeleton_renderer(
		&script_path,
		&routes_path,
		manifest_json_path,
		base_dir,
		build_config.i18n.as_ref(),
	)?;
	for w in &output.warnings {
		ui::detail_warn(w);
	}
	print_cache_stats(&output.cache);
	Ok(output)
}

/// Run the bundler and parse the resulting asset manifest.
pub(crate) fn bundle_frontend(
	build_config: &BuildConfig,
	base_dir: &Path,
	env: &EnvPairs,
) -> Result<AssetFiles> {
	let dist_dir = build_config.dist_dir().to_string();
	let env_refs: Vec<(&str, &str)> = env.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
	run_bundler(base_dir, &build_config.bundler_mode, &dist_dir, &env_refs)?;
	read_bundle_manifest(&base_dir.join(&build_config.bundler_manifest))
}

/// Write route-manifest.json to the output directory.
pub(crate) fn write_route_manifest(out_dir: &Path, route_manifest: &RouteManifest) -> Result<()> {
	let path = out_dir.join("route-manifest.json");
	let json = serde_json::to_string_pretty(route_manifest)?;
	std::fs::write(&path, &json).with_context(|| format!("failed to write {}", path.display()))?;
	ui::detail_ok(&format!("{}route-manifest.json{}", col(DIM), col(RESET)));
	Ok(())
}

/// Inputs for the shared route processing + i18n export pipeline.
pub(crate) struct RouteStepInput<'a> {
	pub skeleton: &'a SkeletonOutput,
	pub base_dir: &'a Path,
	pub out_dir: &'a Path,
	pub assets: &'a AssetFiles,
	pub render: &'a RenderContext<'a>,
	pub bundle: &'a BundleContext<'a>,
	pub build_config: &'a BuildConfig,
	pub ref_graph: Option<&'a ProcedureRefGraph>,
}

/// Execute the "process routes" and "export i18n" build steps, writing
/// route-manifest.json and updating the tracker along the way.
pub(crate) fn execute_route_steps(
	input: &RouteStepInput<'_>,
	tracker: &mut StepTracker,
) -> Result<()> {
	let t = tracker.begin();
	let templates_dir = input.out_dir.join("templates");
	std::fs::create_dir_all(&templates_dir)
		.with_context(|| format!("failed to create {}", templates_dir.display()))?;

	let mut route_manifest = process_routes(
		&input.skeleton.layouts,
		&input.skeleton.routes,
		&templates_dir,
		input.assets,
		input.render,
		input.build_config.i18n.as_ref(),
		input.bundle,
	)?;

	if let Some(graph) = input.ref_graph {
		inject_route_procedures(&mut route_manifest, graph);
	}

	inject_route_projections(&mut route_manifest, input.out_dir)?;
	report_narrowing_savings(&route_manifest);

	if input.build_config.i18n.is_none() {
		write_route_manifest(input.out_dir, &route_manifest)?;
	}

	let route_count = input.skeleton.routes.len();
	let layout_count = input.skeleton.layouts.len();
	if layout_count > 0 {
		tracker.end_with(t, &format!("{route_count} routes, {layout_count} layouts"));
	} else {
		tracker.end_with(t, &format!("{route_count} routes"));
	}

	// i18n export (conditional)
	if let Some(cfg) = &input.build_config.i18n {
		let i18n_messages = read_i18n_messages(input.base_dir, cfg)?;
		let t = tracker.begin();
		export_i18n(input.out_dir, &i18n_messages, &mut route_manifest, cfg)?;
		write_route_manifest(input.out_dir, &route_manifest)?;
		tracker.end(t);
	}

	Ok(())
}
