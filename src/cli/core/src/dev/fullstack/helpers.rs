/* src/cli/core/src/dev/fullstack/helpers.rs */

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};

use crate::build::config::BuildConfig;
use crate::build::run::{RebuildMode, run_incremental_rebuild};
use crate::config::SeamConfig;
use crate::ui::{self, CYAN, DIM, GREEN, RED, RESET, col};

use super::super::network::wait_for_port;
use super::super::process::{ChildProcess, pipe_output, spawn_binary, spawn_child};

/// Partial struct for lightweight `_meta` extraction without full deserialization.
#[derive(serde::Deserialize)]
struct ManifestMetaOnly {
	_meta: Option<crate::build::route::ManifestMeta>,
}

#[derive(Clone, Copy, Debug)]
pub(super) enum DevEvent {
	Reload,
	Rebuild(RebuildMode),
}

pub(super) struct SpawnOptions {
	pub(super) public_port: u16,
	pub(super) backend_port: u16,
	pub(super) vite_port: u16,
	port: String,
	out_dir: String,
	public_dir: Option<String>,
	obfuscate: String,
	sourcemap: String,
}

/// Returns `None` if the manifest is fresh, or `Some(reason)` explaining why a rebuild is needed.
pub(super) fn manifest_stale_reason(json: &str, build_config: &BuildConfig) -> Option<String> {
	let wrapper: ManifestMetaOnly = match serde_json::from_str(json) {
		Ok(w) => w,
		Err(_) => return Some("manifest parse failed".to_string()),
	};
	let Some(meta) = wrapper._meta else {
		return Some("legacy manifest without _meta".to_string());
	};
	let current_version = env!("CARGO_PKG_VERSION");
	if meta.seam_version != current_version {
		return Some(format!("seam version changed ({} -> {current_version})", meta.seam_version));
	}
	let current_hash = build_config.config_hash();
	if meta.config_hash != current_hash {
		return Some("config changed since last build".to_string());
	}
	None
}

pub(super) fn classify_event(
	event: &notify::Event,
	server_dir: &Path,
	public_dir: Option<&Path>,
) -> DevEvent {
	if event.paths.iter().any(|p| p.starts_with(server_dir)) {
		return DevEvent::Rebuild(RebuildMode::Full);
	}
	if let Some(public_dir) = public_dir
		&& event.paths.iter().any(|p| p.starts_with(public_dir))
	{
		return DevEvent::Reload;
	}
	DevEvent::Rebuild(RebuildMode::FrontendOnly)
}

pub(super) fn merge_dev_events(current: DevEvent, incoming: DevEvent) -> DevEvent {
	match (current, incoming) {
		(DevEvent::Rebuild(RebuildMode::Full), _) | (_, DevEvent::Rebuild(RebuildMode::Full)) => {
			DevEvent::Rebuild(RebuildMode::Full)
		}
		(DevEvent::Rebuild(RebuildMode::FrontendOnly), _)
		| (_, DevEvent::Rebuild(RebuildMode::FrontendOnly)) => {
			DevEvent::Rebuild(RebuildMode::FrontendOnly)
		}
		_ => DevEvent::Reload,
	}
}

pub(super) fn setup_watcher(
	server_dir: PathBuf,
	public_dir: Option<PathBuf>,
) -> Result<(RecommendedWatcher, tokio::sync::mpsc::Receiver<DevEvent>)> {
	let (tx, rx) = tokio::sync::mpsc::channel(16);
	let watcher = RecommendedWatcher::new(
		move |res: std::result::Result<notify::Event, notify::Error>| {
			if let Ok(event) = res {
				let dev_event = classify_event(&event, &server_dir, public_dir.as_deref());
				let _ = tx.blocking_send(dev_event);
			}
		},
		notify::Config::default(),
	)?;
	Ok((watcher, rx))
}

fn write_reload_trigger(out_dir: &Path) {
	let trigger = out_dir.join(".reload-trigger");
	let ts = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.unwrap_or_default()
		.as_millis()
		.to_string();
	let _ = std::fs::write(&trigger, &ts);
}

pub(super) fn signal_rebuild_reload(out_dir: &Path, _is_vite: bool) {
	write_reload_trigger(out_dir);
}

pub(super) async fn handle_rebuild(
	config: &SeamConfig,
	build_config: &BuildConfig,
	base_dir: &Path,
	out_dir: &Path,
	is_vite: bool,
	mode: RebuildMode,
) {
	let started = Instant::now();
	let label = match mode {
		RebuildMode::Full => "rebuilding (full)...",
		RebuildMode::FrontendOnly => "rebuilding...",
	};
	ui::label(CYAN, "seam", label);

	let cfg = config.clone();
	let bc = build_config.clone();
	let bd = base_dir.to_path_buf();
	let result =
		tokio::task::spawn_blocking(move || run_incremental_rebuild(&cfg, &bc, &bd, mode)).await;

	match result {
		Ok(Ok(())) => {
			ui::label(
				GREEN,
				"seam",
				&format!("rebuild complete ({:.1}s)", started.elapsed().as_secs_f64()),
			);
			signal_rebuild_reload(out_dir, is_vite);
		}
		Ok(Err(e)) => ui::label(RED, "seam", &format!("rebuild error: {e}")),
		Err(e) => ui::label(RED, "seam", &format!("rebuild panicked: {e}")),
	}
}

pub(super) fn handle_public_reload(out_dir: &Path) {
	ui::label(CYAN, "seam", "public/ changed, reloading...");
	write_reload_trigger(out_dir);
}

pub(super) async fn spawn_fullstack_children(
	config: &SeamConfig,
	base_dir: &Path,
	opts: &SpawnOptions,
) -> Result<Vec<ChildProcess>> {
	let mut children: Vec<ChildProcess> = Vec::new();

	let script = crate::shell::find_cli_script(base_dir, "dev-frontend.mjs")?;
	let runtime = if crate::shell::which_exists("bun") { "bun" } else { "node" };
	let runtime_path = PathBuf::from(runtime);
	let vp_str = opts.vite_port.to_string();
	let script_str = script.to_string_lossy().to_string();
	let mut env_vars_vite: Vec<(&str, &str)> = Vec::new();
	if let Some(ref cp) = config.config_file_path {
		env_vars_vite.push(("SEAM_CONFIG_PATH", cp));
	}
	let dev_out_dir = base_dir
		.join(config.build.out_dir.clone().unwrap_or_else(|| ".seam/output".into()))
		.parent()
		.unwrap_or(Path::new("."))
		.join("dev-output")
		.to_string_lossy()
		.to_string();
	env_vars_vite.push(("SEAM_DEV_OUT_DIR", &dev_out_dir));
	let mut proc =
		spawn_binary("vite", &runtime_path, &[&script_str, &vp_str], base_dir, &env_vars_vite)?;
	pipe_output(&mut proc).await;
	children.push(proc);

	ui::label(DIM, "vite", &format!("waiting on :{}...", opts.vite_port));
	wait_for_port(opts.vite_port, Duration::from_secs(10)).await?;
	ui::label(GREEN, "vite", "ready");

	let backend_cmd = config
		.backend
		.dev_command
		.as_ref()
		.context("backend.dev_command is required for fullstack dev mode")?;
	let mut env_vars: Vec<(&str, &str)> = vec![
		("PORT", &opts.port),
		("SEAM_DEV", "1"),
		("SEAM_OUTPUT_DIR", &opts.out_dir),
		("SEAM_OBFUSCATE", &opts.obfuscate),
		("SEAM_SOURCEMAP", &opts.sourcemap),
	];
	if let Some(public_dir) = opts.public_dir.as_deref() {
		env_vars.push(("SEAM_PUBLIC_DIR", public_dir));
	}
	env_vars.push(("SEAM_VITE", "1"));
	let backend_cwd = backend_cmd.resolve_cwd(base_dir);
	let mut proc = spawn_child("backend", backend_cmd.command(), &backend_cwd, &env_vars)?;
	pipe_output(&mut proc).await;
	children.push(proc);
	ui::label(DIM, "backend", &format!("waiting on :{}...", opts.backend_port));
	wait_for_port(opts.backend_port, Duration::from_secs(10)).await?;
	ui::label(GREEN, "backend", "ready");

	Ok(children)
}

pub(super) fn configure_dev_build(
	config: &SeamConfig,
	base_dir: &Path,
) -> Result<(BuildConfig, PathBuf)> {
	let mut build_config = BuildConfig::from_seam_config_dev(config)?;
	let dev_dir =
		Path::new(&build_config.out_dir).parent().unwrap_or(Path::new(".")).join("dev-output");
	build_config.out_dir = dev_dir.to_string_lossy().to_string();
	if build_config.obfuscate {
		build_config.rpc_salt = Some(seam_codegen::generate_random_salt());
	}
	Ok((build_config, base_dir.join(dev_dir)))
}

pub(super) fn ensure_initial_dev_build(
	config: &SeamConfig,
	build_config: &BuildConfig,
	base_dir: &Path,
	out_dir: &Path,
) -> Result<()> {
	let route_manifest_path = out_dir.join("route-manifest.json");
	let should_rebuild = match std::fs::read_to_string(&route_manifest_path) {
		Ok(json) => {
			let reason = manifest_stale_reason(&json, build_config);
			if let Some(r) = &reason {
				println!("  {}rebuilding: {r}{}", col(DIM), col(RESET));
			}
			reason.is_some()
		}
		Err(_) => true,
	};
	if should_rebuild {
		crate::build::run::run_dev_build(config, build_config, base_dir)?;
		println!();
		return Ok(());
	}
	println!("  {}route-manifest.json up to date, skipping initial build{}", col(DIM), col(RESET));
	println!("  {}(delete {} to force rebuild){}", col(DIM), out_dir.display(), col(RESET));
	println!();
	Ok(())
}

fn watch_dir(
	watcher: &mut RecommendedWatcher,
	path: &Path,
	label: &str,
	watched_dirs: &mut Vec<String>,
) -> Result<()> {
	if path.exists() {
		watcher.watch(path, RecursiveMode::Recursive)?;
		watched_dirs.push(label.to_string());
	}
	Ok(())
}

pub(super) fn setup_watched_dirs(
	base_dir: &Path,
	build_config: &BuildConfig,
	public_dir: Option<&Path>,
	watcher: &mut RecommendedWatcher,
) -> Result<Vec<String>> {
	let mut watched_dirs = Vec::new();
	for dir in ["src/client", "src/server", "shared"] {
		watch_dir(watcher, &base_dir.join(dir), &format!("{dir}/"), &mut watched_dirs)?;
	}
	if let Some(pages_dir) = &build_config.pages_dir {
		watch_dir(watcher, &base_dir.join(pages_dir), &format!("{pages_dir}/"), &mut watched_dirs)?;
	}
	if let Some(public_dir) = public_dir {
		watch_dir(watcher, public_dir, "public/", &mut watched_dirs)?;
	}
	Ok(watched_dirs)
}

pub(super) fn resolve_spawn_options(
	build_config: &BuildConfig,
	base_dir: &Path,
	out_dir: &Path,
	public_dir: Option<&Path>,
	public_port: u16,
	backend_port: u16,
	vite_port: u16,
) -> Result<SpawnOptions> {
	let abs_out_dir = if out_dir.is_absolute() {
		out_dir.to_path_buf()
	} else {
		base_dir
			.join(out_dir)
			.canonicalize()
			.with_context(|| format!("failed to resolve {}", out_dir.display()))?
	};
	Ok(SpawnOptions {
		public_port,
		backend_port,
		vite_port,
		port: backend_port.to_string(),
		out_dir: abs_out_dir.to_string_lossy().to_string(),
		public_dir: public_dir.map(|dir| dir.to_string_lossy().to_string()),
		obfuscate: if build_config.obfuscate { "1" } else { "0" }.to_string(),
		sourcemap: if build_config.sourcemap { "1" } else { "0" }.to_string(),
	})
}
