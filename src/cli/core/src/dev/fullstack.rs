/* src/cli/core/src/dev/fullstack.rs */

use std::path::Path;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tokio::signal;

use crate::build::config::BuildConfig;
use crate::build::run::{RebuildMode, run_incremental_rebuild};
use crate::config::SeamConfig;
use crate::ui::{CYAN, DIM, GREEN, RED, RESET};

use super::network::find_available_port;
use super::network::wait_for_port;
use super::process::{ChildProcess, label_color, pipe_output, spawn_binary, spawn_child, wait_any};
use super::ui::print_fullstack_banner;

fn setup_watcher() -> Result<(RecommendedWatcher, tokio::sync::mpsc::Receiver<()>)> {
  let (tx, rx) = tokio::sync::mpsc::channel(16);
  let watcher = RecommendedWatcher::new(
    move |res: std::result::Result<notify::Event, notify::Error>| {
      if res.is_ok() {
        let _ = tx.blocking_send(());
      }
    },
    notify::Config::default(),
  )?;
  // Directories are watched in run_dev_fullstack after watcher creation
  Ok((watcher, rx))
}

#[allow(dead_code)]
fn classify_change(path: &Path, base_dir: &Path) -> Option<RebuildMode> {
  let rel = path.strip_prefix(base_dir).ok()?;
  let parts: Vec<_> = rel.components().collect();
  if parts.len() >= 2 && parts[0].as_os_str() == "src" && parts[1].as_os_str() == "server" {
    Some(RebuildMode::Full)
  } else {
    Some(RebuildMode::FrontendOnly)
  }
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

async fn handle_rebuild(
  config: &SeamConfig,
  build_config: &BuildConfig,
  base_dir: &Path,
  out_dir: &Path,
  is_vite: bool,
) {
  let started = Instant::now();
  println!("  {CYAN}[seam]{RESET} rebuilding...");

  let cfg = config.clone();
  let bc = build_config.clone();
  let bd = base_dir.to_path_buf();
  let result = tokio::task::spawn_blocking(move || {
    run_incremental_rebuild(&cfg, &bc, &bd, RebuildMode::FrontendOnly)
  })
  .await;

  match result {
    Ok(Ok(())) => {
      println!("  {GREEN}[seam]{RESET} rebuild complete ({:.1}s)", started.elapsed().as_secs_f64());
      // Skip reload trigger when Vite handles HMR — the trigger would
      // cause seamReloadPlugin to send a redundant full-reload.
      if !is_vite {
        write_reload_trigger(out_dir);
      }
    }
    Ok(Err(e)) => println!("  {RED}[seam]{RESET} rebuild error: {e}"),
    Err(e) => println!("  {RED}[seam]{RESET} rebuild panicked: {e}"),
  }
}

async fn spawn_fullstack_children(
  config: &SeamConfig,
  base_dir: &Path,
  port_str: &str,
  out_dir_str: &str,
  obfuscate_str: &str,
  sourcemap_str: &str,
  vite_port: Option<u16>,
) -> Result<Vec<ChildProcess>> {
  let mut children: Vec<ChildProcess> = Vec::new();

  // Spawn Vite dev server when configured (direct binary, no sh/npx overhead)
  if let Some(vp) = vite_port {
    let vite_bin = base_dir.join("node_modules/.bin/vite");
    let vp_str = vp.to_string();
    let mut proc = spawn_binary("vite", &vite_bin, &["--port", &vp_str], base_dir, &[])?;
    pipe_output(&mut proc).await;
    children.push(proc);

    println!("  {DIM}waiting for vite on :{vp}...{RESET}");
    wait_for_port(vp, Duration::from_secs(10)).await?;
    println!("  {GREEN}vite ready{RESET}");
  }

  let backend_cmd_str = config
    .backend
    .dev_command
    .as_deref()
    .context("backend.dev_command is required for fullstack dev mode")?;
  let mut env_vars: Vec<(&str, &str)> = vec![
    ("PORT", port_str),
    ("SEAM_DEV", "1"),
    ("SEAM_OUTPUT_DIR", out_dir_str),
    ("SEAM_OBFUSCATE", obfuscate_str),
    ("SEAM_SOURCEMAP", sourcemap_str),
  ];
  if vite_port.is_some() {
    env_vars.push(("SEAM_VITE", "1"));
  }
  let mut proc = spawn_child("backend", backend_cmd_str, base_dir, &env_vars)?;
  pipe_output(&mut proc).await;
  children.push(proc);

  if let Some(cmd) = config.frontend.dev_command.as_deref() {
    let mut proc = spawn_child("frontend", cmd, base_dir, &[])?;
    pipe_output(&mut proc).await;
    children.push(proc);
  }

  Ok(children)
}

/// Workspace dev mode: resolve a single member, then run fullstack dev with merged config
pub async fn run_dev_workspace(
  root: &SeamConfig,
  base_dir: &Path,
  member_name: &str,
) -> Result<()> {
  let members = crate::workspace::resolve_members(root, base_dir, Some(member_name))?;
  let member = &members[0];
  run_dev_fullstack(&member.merged_config, base_dir).await
}

pub(super) async fn run_dev_fullstack(config: &SeamConfig, base_dir: &Path) -> Result<()> {
  let mut build_config = BuildConfig::from_seam_config_dev(config)?;
  // Dev writes to sibling dir to avoid overwriting production output
  let dev_dir = std::path::Path::new(&build_config.out_dir)
    .parent()
    .unwrap_or(std::path::Path::new("."))
    .join("dev-output");
  build_config.out_dir = dev_dir.to_string_lossy().to_string();
  let out_dir = base_dir.join(&build_config.out_dir);

  // Generate stable salt once per dev session
  if build_config.obfuscate {
    build_config.rpc_salt = Some(crate::build::rpc_hash::generate_random_salt());
  }

  // Skip build if route-manifest.json already exists
  let route_manifest_path = out_dir.join("route-manifest.json");
  if route_manifest_path.exists() {
    println!("  {DIM}route-manifest.json found, skipping initial build{RESET}");
    println!("  {DIM}(delete {} to force rebuild){RESET}", out_dir.display());
    println!();
  } else {
    crate::build::run::run_dev_build(config, &build_config, base_dir)?;
    println!();
  }

  // Set up file watcher before spawning backend
  let (mut _watcher, mut watcher_rx) = setup_watcher()?;
  let mut watched_dirs = Vec::new();
  for dir in ["src/client", "src/server", "shared"] {
    let path = base_dir.join(dir);
    if path.exists() {
      _watcher.watch(&path, RecursiveMode::Recursive)?;
      watched_dirs.push(format!("{dir}/"));
    }
  }

  let port = find_available_port(config.dev.port)?;
  let vite_port = config.dev.vite_port;

  // Resolve absolute output dir for SEAM_OUTPUT_DIR env var
  let abs_out_dir = if out_dir.is_absolute() {
    out_dir.clone()
  } else {
    base_dir
      .join(&out_dir)
      .canonicalize()
      .with_context(|| format!("failed to resolve {}", out_dir.display()))?
  };
  let out_dir_str = abs_out_dir.to_string_lossy().to_string();
  let port_str = port.to_string();

  let obfuscate_str = if build_config.obfuscate { "1" } else { "0" };
  let sourcemap_str = if build_config.sourcemap { "1" } else { "0" };

  print_fullstack_banner(config, port, &watched_dirs, vite_port);

  let mut children = spawn_fullstack_children(
    config,
    base_dir,
    &port_str,
    &out_dir_str,
    obfuscate_str,
    sourcemap_str,
    vite_port,
  )
  .await?;

  // Event loop: Ctrl+C, child exit, or file change triggers rebuild
  loop {
    tokio::select! {
      _ = signal::ctrl_c() => {
        println!();
        println!("  {DIM}shutting down...{RESET}");
        break;
      }
      result = wait_any(&mut children) => {
        let (label, status) = result;
        let color = label_color(label);
        match status {
          Ok(s) if s.success() => println!("  {color}{label}{RESET} exited"),
          Ok(s) => println!("  {RED}{label} exited with {s}{RESET}"),
          Err(e) => println!("  {RED}{label} error: {e}{RESET}"),
        }
        break;
      }
      Some(()) = watcher_rx.recv() => {
        // Debounce: wait 300ms, drain pending events
        tokio::time::sleep(Duration::from_millis(300)).await;
        while watcher_rx.try_recv().is_ok() {}
        handle_rebuild(config, &build_config, base_dir, &out_dir, vite_port.is_some()).await;
      }
    }
  }

  Ok(())
}
