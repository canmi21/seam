/* src/cli/core/src/build/run/fullstack.rs */

use std::path::Path;
use std::time::Instant;

use anyhow::Result;

use super::super::config::BuildConfig;
use super::super::route::generate_types;
use super::super::route::{
	BundleContext, RenderContext, build_reference_graph, generate_route_procedures_ts,
	package_static_assets, print_asset_files, print_procedure_breakdown, run_typecheck,
	validate_handoff_consistency, validate_invalidates, validate_procedure_references,
	warn_unused_queries,
};
use super::super::types::{AssetFiles, read_bundle_manifest_extended};
use super::helpers;
use super::helpers::{dispatch_extract_manifest, maybe_generate_rpc_hashes, vite_info_from_config};
use super::rebuild::copy_wasm_binary;
use super::steps;
use crate::config::SeamConfig;
use crate::shell::run_command;
use crate::ui::{self, BRIGHT_CYAN, BRIGHT_GREEN, RESET, StepTracker, col};

// -- Step registry --

fn fullstack_steps(build_config: &BuildConfig, has_ssg: bool) -> Vec<&'static str> {
	let mut steps = Vec::new();
	if build_config.pages_dir.is_some() {
		steps.push("Generating routes");
	}
	steps.extend(["Compiling backend", "Extracting procedure manifest"]);
	if build_config.obfuscate {
		steps.push("Generating RPC hash map");
	}
	steps.push("Generating client types");
	steps.push("Rendering skeletons");
	steps.push("Generating route procedures");
	steps.push("Bundling frontend");
	if build_config.typecheck_command.is_some() {
		steps.push("Type checking");
	}
	steps.push("Processing routes");
	if build_config.i18n.is_some() {
		steps.push("Exporting i18n");
	}
	steps.push("Packaging output");
	if has_ssg {
		steps.push("Pre-rendering static pages");
	}
	steps
}

fn dev_steps(build_config: &BuildConfig, is_vite: bool) -> Vec<&'static str> {
	let mut steps = Vec::new();
	if build_config.pages_dir.is_some() {
		steps.push("Generating routes");
	}
	steps.push("Extracting procedure manifest");
	if build_config.obfuscate {
		steps.push("Generating RPC hash map");
	}
	steps.push("Generating client types");
	steps.push("Rendering skeletons");
	steps.push("Generating route procedures");
	if !is_vite {
		steps.push("Bundling frontend");
	}
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
	let manifest_path = base_dir.join(build_config.bundler_manifest());

	ui::banner("build", Some(config.project_name()));

	use crate::config::OutputMode;
	let has_ssg = matches!(build_config.output, OutputMode::Static | OutputMode::Hybrid);
	let mut tracker = StepTracker::new(fullstack_steps(build_config, has_ssg));

	// -- Generating routes (conditional) --
	if let Some(pages_dir) = &build_config.pages_dir {
		let t = tracker.begin();
		let output = base_dir.join(".seam/generated/routes.ts");
		helpers::run_fs_router(base_dir, pages_dir, &output)?;
		tracker.end(t);
	}

	// -- Compiling backend --
	let t = tracker.begin();
	let backend_cmd = build_config
		.backend_build_command
		.as_deref()
		.expect("backend_build_command required in fullstack mode");
	run_command(base_dir, backend_cmd, "backend build", &[])?;
	copy_wasm_binary(base_dir, &out_dir)?;
	tracker.end(t);

	// -- Extracting procedure manifest --
	let t = tracker.begin();
	let manifest = dispatch_extract_manifest(build_config, base_dir, &out_dir)?;
	print_procedure_breakdown(&manifest);
	tracker.end_with(t, &format!("{} procedures", manifest.procedures.len()));

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
	generate_types(&manifest, config, rpc_hashes.as_ref(), base_dir)?;
	tracker.end(t);

	// -- Rendering skeletons (before bundling — independent of bundled output) --
	let t = tracker.begin();
	let skeleton_output =
		steps::render_skeletons(build_config, base_dir, &out_dir.join("seam-manifest.json"))?;
	let ref_graph = build_reference_graph(&manifest, &skeleton_output);
	validate_procedure_references(&ref_graph)?;
	validate_invalidates(&manifest)?;
	validate_handoff_consistency(&ref_graph);
	warn_unused_queries(&ref_graph, &manifest);
	tracker.end_with(t, &format!("{} routes", skeleton_output.routes.len()));

	// -- Generating route procedures --
	let t = tracker.begin();
	let rp_path = base_dir.join(".seam/generated/route-procedures.ts");
	generate_route_procedures_ts(&ref_graph, &manifest, &rp_path)?;
	tracker.end(t);

	// -- Bundling frontend --
	let t = tracker.begin();
	let rpc_map_path_str = if rpc_hashes.is_some() {
		out_dir.join("rpc-hash-map.json").to_string_lossy().to_string()
	} else {
		String::new()
	};
	let mut bundler_env = steps::build_bundler_env(build_config, &rpc_map_path_str);
	bundler_env.push((
		"SEAM_ROUTES_FILE".into(),
		base_dir.join(&build_config.routes).to_string_lossy().to_string(),
	));
	let assets = steps::bundle_frontend(build_config, base_dir, &bundler_env)?;
	print_asset_files(base_dir, build_config.dist_dir(), &assets);
	tracker.end_with(t, &format!("{} files", assets.js.len() + assets.css.len()));

	// -- Type checking (conditional) --
	if let Some(cmd) = &build_config.typecheck_command {
		let t = tracker.begin();
		run_typecheck(base_dir, cmd)?;
		tracker.end(t);
	}

	// -- Processing routes + Exporting i18n --
	let bundle_manifest =
		resolve_bundle_manifest(skeleton_output.source_file_map.as_ref(), &manifest_path);
	let template_assets = match &bundle_manifest {
		Some(bm) => &bm.template,
		None => &assets,
	};
	let render = RenderContext {
		root_id: &build_config.root_id,
		data_id: &build_config.data_id,
		dev_mode: false,
		vite: None,
	};
	let bundle_ctx = BundleContext {
		manifest: bundle_manifest.as_ref(),
		source_file_map: skeleton_output.source_file_map.as_ref(),
	};
	steps::execute_route_steps(
		&steps::RouteStepInput {
			skeleton: &skeleton_output,
			base_dir,
			out_dir: &out_dir,
			assets: template_assets,
			render: &render,
			bundle: &bundle_ctx,
			build_config,
			ref_graph: Some(&ref_graph),
		},
		&mut tracker,
	)?;

	// -- Packaging output --
	let t = tracker.begin();
	let asset_count = package_static_assets(base_dir, &out_dir, build_config.dist_dir())?;
	tracker.end_with(t, &format!("{asset_count} files"));

	// -- Pre-rendering static pages (conditional) --
	let ssg_result = if has_ssg && steps::has_prerender_routes(&skeleton_output, build_config.output)
	{
		let t = tracker.begin();
		let ssg = steps::render_static_pages(build_config, base_dir, &out_dir)?;
		tracker.end_with(t, &format!("{} pages", ssg.pages));
		Some(ssg)
	} else if has_ssg {
		let t = tracker.begin();
		tracker.end_with(t, "0 pages");
		None
	} else {
		None
	};
	let ssg_count = ssg_result.as_ref().map_or(0, |s| s.pages);

	// Package SSG output for full static deployment
	if let Some(ref ssg) = ssg_result
		&& build_config.output == crate::config::OutputMode::Static
	{
		steps::package_ssg_output(base_dir, ssg, build_config.dist_dir())?;
	}

	let extra = if ssg_count > 0 {
		format!("{ssg_count} prerendered \u{00b7} {asset_count} assets")
	} else {
		format!("{asset_count} assets")
	};
	print_build_summary(
		started,
		manifest.procedures.len(),
		skeleton_output.routes.len(),
		&extra,
		&build_config.renderer,
		"build",
	);

	Ok(())
}

// -- Dev build --

pub fn run_dev_build(
	config: &SeamConfig,
	build_config: &BuildConfig,
	base_dir: &Path,
) -> Result<()> {
	let started = Instant::now();
	let out_dir = base_dir.join(&build_config.out_dir);
	let vite = vite_info_from_config(config);
	let is_vite = vite.is_some();

	ui::banner("dev build", Some(config.project_name()));

	let mut tracker = StepTracker::new(dev_steps(build_config, is_vite));

	// -- Generating routes (conditional) --
	if let Some(pages_dir) = &build_config.pages_dir {
		let t = tracker.begin();
		let output = base_dir.join(".seam/generated/routes.ts");
		helpers::run_fs_router(base_dir, pages_dir, &output)?;
		tracker.end(t);
	}

	// -- Extracting procedure manifest --
	let t = tracker.begin();
	let manifest = dispatch_extract_manifest(build_config, base_dir, &out_dir)?;
	print_procedure_breakdown(&manifest);
	copy_wasm_binary(base_dir, &out_dir)?;
	tracker.end_with(t, &format!("{} procedures", manifest.procedures.len()));

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
	generate_types(&manifest, config, rpc_hashes.as_ref(), base_dir)?;
	tracker.end(t);

	// -- Rendering skeletons (before bundling — independent of bundled output) --
	let t = tracker.begin();
	let skeleton_output =
		steps::render_skeletons(build_config, base_dir, &out_dir.join("seam-manifest.json"))?;
	let ref_graph = build_reference_graph(&manifest, &skeleton_output);
	validate_procedure_references(&ref_graph)?;
	validate_invalidates(&manifest)?;
	validate_handoff_consistency(&ref_graph);
	warn_unused_queries(&ref_graph, &manifest);
	tracker.end_with(t, &format!("{} routes", skeleton_output.routes.len()));

	// -- Generating route procedures --
	let t = tracker.begin();
	let rp_path = base_dir.join(".seam/generated/route-procedures.ts");
	generate_route_procedures_ts(&ref_graph, &manifest, &rp_path)?;
	tracker.end(t);

	// -- Bundling frontend (skipped in Vite mode) --
	let rpc_map_path_str = if rpc_hashes.is_some() {
		out_dir.join("rpc-hash-map.json").to_string_lossy().to_string()
	} else {
		String::new()
	};
	let bundler_env = steps::build_bundler_env(build_config, &rpc_map_path_str);
	let assets = if is_vite {
		AssetFiles { css: vec![], js: vec![] }
	} else {
		let t = tracker.begin();
		let a = steps::bundle_frontend(build_config, base_dir, &bundler_env)?;
		print_asset_files(base_dir, build_config.dist_dir(), &a);
		tracker.end_with(t, &format!("{} files", a.js.len() + a.css.len()));
		a
	};

	// -- Processing routes + Exporting i18n --
	let render = RenderContext {
		root_id: &build_config.root_id,
		data_id: &build_config.data_id,
		dev_mode: true,
		vite: vite.as_ref(),
	};
	let bundle_ctx = BundleContext { manifest: None, source_file_map: None };
	steps::execute_route_steps(
		&steps::RouteStepInput {
			skeleton: &skeleton_output,
			base_dir,
			out_dir: &out_dir,
			assets: &assets,
			render: &render,
			bundle: &bundle_ctx,
			build_config,
			ref_graph: Some(&ref_graph),
		},
		&mut tracker,
	)?;

	// -- Packaging output (skipped in Vite mode) --
	let asset_count = if !is_vite {
		let t = tracker.begin();
		let count = package_static_assets(base_dir, &out_dir, build_config.dist_dir())?;
		tracker.end_with(t, &format!("{count} files"));
		count
	} else {
		0
	};

	let extra = if is_vite { "vite mode".to_string() } else { format!("{asset_count} assets") };
	print_build_summary(
		started,
		manifest.procedures.len(),
		skeleton_output.routes.len(),
		&extra,
		&build_config.renderer,
		"dev build",
	);

	Ok(())
}

// -- Helpers --

/// Parse extended bundle manifest for per-page asset splitting (when sourceFileMap is available).
fn resolve_bundle_manifest(
	source_file_map: Option<&std::collections::BTreeMap<String, String>>,
	manifest_path: &Path,
) -> Option<super::super::types::BundleManifest> {
	source_file_map?;
	read_bundle_manifest_extended(manifest_path).ok()
}

fn print_build_summary(
	started: Instant,
	proc_count: usize,
	template_count: usize,
	extra: &str,
	renderer: &str,
	label: &str,
) {
	ui::blank();
	let elapsed = started.elapsed().as_secs_f64();
	let (bg, bc, r) = (col(BRIGHT_GREEN), col(BRIGHT_CYAN), col(RESET));
	ui::ok(&format!("{label} complete in {bc}{elapsed:.1}s{r}"));
	ui::detail(&format!(
		"{bg}{proc_count}{r} procedures \u{00b7} {bg}{template_count}{r} templates \u{00b7} {bg}{extra}{r} \u{00b7} {renderer}",
	));
}
