/* src/cli/core/src/build/run/steps.rs */

// Shared build step helpers: bundler env, skeleton rendering, frontend bundling.
// Extracted from fullstack, frontend, rebuild, and workspace builds.

use std::path::Path;

use anyhow::{Context, Result};

use super::super::config::BuildConfig;
use super::super::route::{
	BundleContext, ManifestMeta, ProcedureRefGraph, RenderContext, RouteManifest, SkeletonOutput,
	apply_output_mode, build_manifest_meta, export_i18n, inject_route_procedures,
	inject_route_projections, process_routes, read_i18n_messages, report_narrowing_savings,
	run_skeleton_renderer,
};
use super::super::types::{AssetFiles, read_bundle_manifest};
use super::helpers::print_cache_stats;
use crate::config::OutputMode;
use crate::shell::{resolve_node_module, run_builtin_bundler, which_exists};
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
	env.push(("SEAM_ENTRY".into(), build_config.entry.clone()));
	if let Some(ref path) = build_config.config_path {
		env.push(("SEAM_CONFIG_PATH".into(), path.clone()));
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

/// Run the built-in bundler and parse the resulting asset manifest.
pub(crate) fn bundle_frontend(
	build_config: &BuildConfig,
	base_dir: &Path,
	env: &EnvPairs,
) -> Result<AssetFiles> {
	let dist_dir = build_config.dist_dir().to_string();
	let env_refs: Vec<(&str, &str)> = env.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
	run_builtin_bundler(base_dir, &build_config.entry, &dist_dir, &env_refs)?;
	read_bundle_manifest(&base_dir.join(build_config.bundler_manifest()))
}

/// Write route-manifest.json to the output directory, optionally embedding `_meta`.
pub(crate) fn write_route_manifest(
	out_dir: &Path,
	route_manifest: &mut RouteManifest,
	meta: Option<ManifestMeta>,
) -> Result<()> {
	route_manifest._meta = meta;
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

	// Apply output mode behavior matrix (static/server/hybrid → effective prerender)
	apply_output_mode(&mut route_manifest, input.build_config.output);

	if let Some(graph) = input.ref_graph {
		inject_route_procedures(&mut route_manifest, graph);
	}

	inject_route_projections(&mut route_manifest, input.out_dir)?;
	report_narrowing_savings(&route_manifest);

	if input.build_config.i18n.is_none() {
		let meta = Some(build_manifest_meta(input.build_config));
		write_route_manifest(input.out_dir, &mut route_manifest, meta)?;
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
		let meta = Some(build_manifest_meta(input.build_config));
		write_route_manifest(input.out_dir, &mut route_manifest, meta)?;
		tracker.end(t);
	}

	Ok(())
}

/// Check whether the build has any effective prerender routes.
pub(crate) fn has_prerender_routes(skeleton: &SkeletonOutput, output: OutputMode) -> bool {
	match output {
		OutputMode::Static => true,
		OutputMode::Server => false,
		OutputMode::Hybrid => skeleton.routes.iter().any(|r| r.prerender == Some(true)),
	}
}

/// SSG output from the render script.
#[derive(serde::Deserialize)]
pub(crate) struct SsgOutput {
	pub pages: usize,
	pub paths: Vec<String>,
}

/// Pre-render static pages via `@canmi/seam-react` SSG script.
pub(crate) fn render_static_pages(
	build_config: &BuildConfig,
	base_dir: &Path,
	out_dir: &Path,
) -> Result<SsgOutput> {
	let script_path = resolve_node_module(base_dir, "@canmi/seam-react/scripts/ssg-render.mjs")
		.ok_or_else(|| anyhow::anyhow!("ssg-render.mjs not found -- install @canmi/seam-react"))?;

	let static_dir = base_dir.join(".seam/static");
	let routes_path = base_dir.join(&build_config.routes);
	let runtime = if which_exists("bun") { "bun" } else { "node" };

	let output = std::process::Command::new(runtime)
		.arg(&script_path)
		.arg("--out-dir")
		.arg(out_dir)
		.arg("--static-dir")
		.arg(&static_dir)
		.arg("--routes-file")
		.arg(&routes_path)
		.arg("--output-mode")
		.arg(match build_config.output {
			OutputMode::Static => "static",
			OutputMode::Server => "server",
			OutputMode::Hybrid => "hybrid",
		})
		.current_dir(base_dir)
		.output()
		.context("failed to spawn SSG renderer")?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		anyhow::bail!("SSG rendering failed:\n{stderr}");
	}

	let stdout = String::from_utf8(output.stdout).context("invalid UTF-8 from SSG renderer")?;
	serde_json::from_str(&stdout).context("failed to parse SSG output JSON")
}

/// Package SSG output for full static deployment (`output: 'static'`).
/// Copies bundled assets and __data.json files into .seam/static/ for CDN serving.
pub(crate) fn package_ssg_output(
	base_dir: &Path,
	ssg: &SsgOutput,
	dist_dir: &str,
) -> Result<usize> {
	let static_dir = base_dir.join(".seam/static");
	let source_dist = base_dir.join(dist_dir);

	// Copy JS/CSS bundles to .seam/static/_seam/static/
	let target_assets = static_dir.join("_seam/static");
	if source_dist.is_dir() {
		copy_dir_recursive(&source_dist, &target_assets)?;
	}

	// Copy __data.json files to .seam/static/_seam/data/{path}/index.json
	let mut data_count = 0;
	for path in &ssg.paths {
		let sub = path.strip_prefix('/').unwrap_or(path);
		let src = if sub.is_empty() {
			static_dir.join("__data.json")
		} else {
			static_dir.join(sub).join("__data.json")
		};
		if src.is_file() {
			let target = if sub.is_empty() {
				static_dir.join("_seam/data/index.json")
			} else {
				static_dir.join("_seam/data").join(sub).join("index.json")
			};
			if let Some(parent) = target.parent() {
				std::fs::create_dir_all(parent)?;
			}
			std::fs::copy(&src, &target)?;
			data_count += 1;
		}
	}

	Ok(data_count)
}

/// Recursively copy a directory tree.
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
	std::fs::create_dir_all(dst)?;
	for entry in std::fs::read_dir(src)? {
		let entry = entry?;
		let ty = entry.file_type()?;
		let target = dst.join(entry.file_name());
		if ty.is_dir() {
			copy_dir_recursive(&entry.path(), &target)?;
		} else {
			std::fs::copy(entry.path(), &target)?;
		}
	}
	Ok(())
}
