/* src/cli/core/src/build/run/helpers.rs */

use std::path::Path;

use anyhow::{Context, Result, bail};

use super::super::config::{BuildConfig, BundlerMode};
use super::super::route::CacheStats;
use super::super::types::ViteDevInfo;
use crate::config::SeamConfig;
use crate::shell::{run_builtin_bundler, run_command};
use crate::ui;

#[derive(Debug, Clone, Copy)]
pub enum RebuildMode {
	/// src/server/** changed — full rebuild (manifest + codegen + bundle + skeletons + assets)
	#[allow(dead_code)] // Part of rebuild API; no caller constructs Full yet
	Full,
	/// src/client/** or shared/** changed — frontend only (bundle + skeletons + assets)
	FrontendOnly,
}

/// Dispatch bundler based on mode
pub(super) fn run_bundler(
	base_dir: &Path,
	mode: &BundlerMode,
	dist_dir: &str,
	env: &[(&str, &str)],
) -> Result<()> {
	match mode {
		BundlerMode::BuiltIn { entry } => run_builtin_bundler(base_dir, entry, dist_dir, env),
		BundlerMode::Custom { command } => run_command(base_dir, command, "bundler", env),
	}
}

/// Generate RPC hash map when obfuscation is enabled, write to out_dir
pub(super) fn maybe_generate_rpc_hashes(
	build_config: &BuildConfig,
	manifest: &seam_codegen::Manifest,
	out_dir: &Path,
) -> Result<Option<seam_codegen::RpcHashMap>> {
	if !build_config.obfuscate {
		return Ok(None);
	}
	let names: Vec<&str> = manifest.procedures.keys().map(std::string::String::as_str).collect();
	let salt = build_config
		.rpc_salt
		.as_deref()
		.map(std::string::ToString::to_string)
		.unwrap_or_else(seam_codegen::generate_random_salt);
	let map = seam_codegen::generate_rpc_hash_map(
		&names,
		&salt,
		build_config.hash_length,
		build_config.type_hint,
	)?;
	let path = out_dir.join("rpc-hash-map.json");
	std::fs::write(&path, serde_json::to_string_pretty(&map)?)?;
	ui::detail_ok(&format!("{}rpc-hash-map.json{}", ui::col(ui::DIM), ui::col(ui::RESET)));
	Ok(Some(map))
}

/// Dispatch manifest extraction: manifest_command for non-JS backends, router_file for JS/TS
pub(super) fn dispatch_extract_manifest(
	build_config: &BuildConfig,
	base_dir: &Path,
	out_dir: &Path,
) -> Result<seam_codegen::Manifest> {
	use super::super::route::{extract_manifest, extract_manifest_command};
	use anyhow::Context;
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
	manifest: &seam_codegen::Manifest,
	out_dir: &std::path::Path,
) -> Result<Option<seam_codegen::RpcHashMap>> {
	maybe_generate_rpc_hashes(build_config, manifest, out_dir)
}

/// Construct ViteDevInfo when vite_port is configured
pub(super) fn vite_info_from_config(config: &SeamConfig) -> Option<ViteDevInfo> {
	config.dev.vite_port.map(|port| ViteDevInfo {
		origin: format!("http://localhost:{port}"),
		entry: config
			.frontend
			.entry
			.clone()
			.expect("frontend.entry is required when dev.vite_port is set"),
	})
}

pub(super) fn print_cache_stats(cache: &Option<CacheStats>) {
	if let Some(stats) = cache {
		ui::detail_ok(&format!(
			"{}skeleton cache: {} hit, {} miss{}",
			ui::col(ui::DIM),
			stats.hits,
			stats.misses,
			ui::col(ui::RESET)
		));
	}
}

/// Shell out to @canmi/seam-router to generate routes from pages directory
pub(super) fn run_fs_router(base_dir: &Path, pages_dir: &str, output_path: &Path) -> Result<()> {
	let script = crate::shell::resolve_node_module(base_dir, "@canmi/seam-router/dist/cli.js")
		.ok_or_else(|| anyhow::anyhow!("@canmi/seam-router not found -- install it"))?;

	let runtime = if which_exists("bun") { "bun" } else { "node" };

	let pages_abs = base_dir.join(pages_dir);
	let output_abs =
		if output_path.is_absolute() { output_path.to_path_buf() } else { base_dir.join(output_path) };

	let status = std::process::Command::new(runtime)
		.arg(script.to_string_lossy().as_ref())
		.arg(pages_abs.to_string_lossy().as_ref())
		.arg(output_abs.to_string_lossy().as_ref())
		.current_dir(base_dir)
		.status()
		.with_context(|| format!("failed to run {runtime} for fs router generation"))?;

	if !status.success() {
		bail!("fs router generation failed (exit code: {})", status.code().unwrap_or(-1));
	}
	Ok(())
}

fn which_exists(name: &str) -> bool {
	std::process::Command::new("which")
		.arg(name)
		.stdout(std::process::Stdio::null())
		.stderr(std::process::Stdio::null())
		.status()
		.is_ok_and(|s| s.success())
}
