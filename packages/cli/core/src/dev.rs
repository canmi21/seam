/* packages/cli/core/src/dev.rs */

use std::path::Path;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::signal;

use crate::build::config::{BuildConfig, BundlerMode};
use crate::build::run::{run_incremental_rebuild, RebuildMode};
use crate::build::types::read_bundle_manifest;
use crate::config::SeamConfig;
use crate::dev_server;
use crate::ui::{BOLD, CYAN, DIM, GREEN, MAGENTA, RED, RESET, YELLOW};

struct ChildProcess {
  label: &'static str,
  child: tokio::process::Child,
}

fn spawn_child(
  label: &'static str,
  command: &str,
  base_dir: &Path,
  env_vars: &[(&str, &str)],
) -> Result<ChildProcess> {
  let mut cmd = Command::new("sh");
  cmd.args(["-c", command]);
  cmd.current_dir(base_dir);
  cmd.stdout(std::process::Stdio::piped());
  cmd.stderr(std::process::Stdio::piped());
  cmd.kill_on_drop(true);

  for (key, val) in env_vars {
    cmd.env(key, val);
  }

  let child = cmd.spawn()?;
  Ok(ChildProcess { label, child })
}

/// Spawn a binary directly, bypassing sh -c overhead.
/// Use for framework-internal binaries (not user-configurable commands).
fn spawn_binary(
  label: &'static str,
  bin: &Path,
  args: &[&str],
  base_dir: &Path,
  env_vars: &[(&str, &str)],
) -> Result<ChildProcess> {
  let mut cmd = Command::new(bin);
  cmd.args(args);
  cmd.current_dir(base_dir);
  cmd.stdout(std::process::Stdio::piped());
  cmd.stderr(std::process::Stdio::piped());
  cmd.kill_on_drop(true);
  for (key, val) in env_vars {
    cmd.env(key, val);
  }
  let child = cmd.spawn().with_context(|| format!("failed to start {}", bin.display()))?;
  Ok(ChildProcess { label, child })
}

fn label_color(label: &str) -> &'static str {
  match label {
    "backend" => CYAN,
    "frontend" | "vite" => MAGENTA,
    _ => DIM,
  }
}

/// Pipe stdout/stderr, prefixed with a colored label
async fn pipe_output(proc: &mut ChildProcess) {
  let label = proc.label;
  let color = label_color(label);
  let stdout = proc.child.stdout.take();
  let stderr = proc.child.stderr.take();

  if let Some(stdout) = stdout {
    let reader = BufReader::new(stdout);
    let c = color;
    tokio::spawn(async move {
      let mut lines = reader.lines();
      while let Ok(Some(line)) = lines.next_line().await {
        println!("  {c}{DIM}{label:>8}{RESET} {line}");
      }
    });
  }

  if let Some(stderr) = stderr {
    let reader = BufReader::new(stderr);
    let c = color;
    tokio::spawn(async move {
      let mut lines = reader.lines();
      while let Ok(Some(line)) = lines.next_line().await {
        eprintln!("  {c}{DIM}{label:>8}{RESET} {line}");
      }
    });
  }
}

/// Wait for any child process to exit, return its label and exit status
async fn wait_any(
  children: &mut [ChildProcess],
) -> (&'static str, Result<std::process::ExitStatus, std::io::Error>) {
  loop {
    for child in children.iter_mut() {
      match child.child.try_wait() {
        Ok(Some(status)) => return (child.label, Ok(status)),
        Ok(None) => {}
        Err(e) => return (child.label, Err(e)),
      }
    }
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
  }
}

fn find_available_port(preferred: u16) -> Result<u16> {
  if std::net::TcpListener::bind(("0.0.0.0", preferred)).is_ok() {
    return Ok(preferred);
  }
  for port in 3000..3100 {
    if port != preferred && std::net::TcpListener::bind(("0.0.0.0", port)).is_ok() {
      return Ok(port);
    }
  }
  bail!("no available port found in range 3000-3099");
}

/// Poll a TCP port until it accepts connections, or bail after timeout.
/// Tries both IPv6 (::1) and IPv4 (127.0.0.1) since Vite v7 binds IPv6-only on macOS.
async fn wait_for_port(port: u16, timeout: Duration) -> Result<()> {
  let deadline = Instant::now() + timeout;
  loop {
    if tokio::net::TcpStream::connect(("::1", port)).await.is_ok()
      || tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok()
    {
      return Ok(());
    }
    if Instant::now() >= deadline {
      bail!("timed out waiting for port {port} to become ready");
    }
    tokio::time::sleep(Duration::from_millis(100)).await;
  }
}

fn print_dev_banner(
  config: &SeamConfig,
  backend_cmd: Option<&str>,
  frontend_cmd: Option<&str>,
  use_embedded: bool,
) {
  crate::ui::banner("dev", Some(&config.project.name));

  if let Some(cmd) = backend_cmd {
    let lang = &config.backend.lang;
    println!("  {CYAN}backend{RESET}   {DIM}[{lang}]{RESET} {DIM}{cmd}{RESET}");
  }

  if let Some(cmd) = frontend_cmd {
    let port_suffix =
      config.frontend.dev_port.map_or(String::new(), |p| format!(" {DIM}:{p}{RESET}"));
    println!("  {MAGENTA}frontend{RESET}  {DIM}{cmd}{RESET}{port_suffix}");
  } else if use_embedded {
    let dev_port = config.frontend.dev_port.unwrap_or(5173);
    println!("  {MAGENTA}frontend{RESET}  {DIM}embedded dev server :{dev_port}{RESET}");
  }

  if backend_cmd.is_some() {
    let fp = config.frontend.dev_port.unwrap_or(5173);
    if frontend_cmd.is_some() || use_embedded {
      println!("  {YELLOW}proxy{RESET}     {DIM}:{} \u{2192} :{fp}{RESET}", config.backend.port);
    }
  }

  let primary_port =
    if use_embedded { config.frontend.dev_port.unwrap_or(5173) } else { config.backend.port };
  println!();
  println!("  {GREEN}\u{2192}{RESET} {BOLD}http://localhost:{primary_port}{RESET}");
  println!();
}

fn build_frontend(config: &SeamConfig, base_dir: &Path) -> Result<()> {
  crate::ui::step(1, 1, "Building frontend");
  let build_config = BuildConfig::from_seam_config(config)?;
  match &build_config.bundler_mode {
    BundlerMode::BuiltIn { entry } => {
      crate::shell::run_builtin_bundler(base_dir, entry, "dist", &[])?;
    }
    BundlerMode::Custom { command } => {
      crate::shell::run_command(base_dir, command, "bundler", &[])?;
    }
  }
  crate::ui::blank();
  Ok(())
}

pub async fn run_dev(config: &SeamConfig, base_dir: &Path) -> Result<()> {
  let build_config = BuildConfig::from_seam_config(config);
  if build_config.as_ref().is_ok_and(|bc| bc.is_fullstack) {
    return run_dev_fullstack(config, base_dir).await;
  }

  let backend_cmd = config.backend.dev_command.as_deref();
  let frontend_cmd = config.frontend.dev_command.as_deref();
  let has_entry = config.frontend.entry.is_some();

  // Determine frontend mode: external command, embedded dev server, or none
  let use_embedded = frontend_cmd.is_none() && has_entry;

  if backend_cmd.is_none() && frontend_cmd.is_none() && !has_entry {
    bail!(
      "no dev_command configured in seam.toml \
       (set backend.dev_command, frontend.dev_command, or frontend.entry)"
    );
  }

  print_dev_banner(config, backend_cmd, frontend_cmd, use_embedded);

  if use_embedded {
    build_frontend(config, base_dir)?;
  }

  let mut children: Vec<ChildProcess> = Vec::new();

  if let Some(cmd) = backend_cmd {
    let port_str = config.backend.port.to_string();
    let mut proc = spawn_child("backend", cmd, base_dir, &[("PORT", &port_str)])?;
    pipe_output(&mut proc).await;
    children.push(proc);
  }

  if let Some(cmd) = frontend_cmd {
    let mut proc = spawn_child("frontend", cmd, base_dir, &[])?;
    pipe_output(&mut proc).await;
    children.push(proc);
  }

  // Wait for Ctrl+C, child exit, or dev server error
  if use_embedded {
    let dev_port = config.frontend.dev_port.unwrap_or(5173);
    let manifest_path = base_dir.join("dist/.seam/manifest.json");
    let assets = read_bundle_manifest(&manifest_path)?;
    let static_dir = base_dir.join("dist");

    if children.is_empty() {
      // No backend — just run dev server
      tokio::select! {
        _ = signal::ctrl_c() => {
          println!();
          println!("  {DIM}shutting down...{RESET}");
        }
        result = dev_server::start_dev_server(static_dir, dev_port, config.backend.port, assets) => {
          if let Err(e) = result {
            println!("  {RED}dev server error: {e}{RESET}");
          }
        }
      }
    } else {
      tokio::select! {
        _ = signal::ctrl_c() => {
          println!();
          println!("  {DIM}shutting down...{RESET}");
        }
        result = wait_any(&mut children) => {
          let (label, status) = result;
          let color = label_color(label);
          match status {
            Ok(s) if s.success() => println!("  {color}{label}{RESET} exited"),
            Ok(s) => println!("  {RED}{label} exited with {s}{RESET}"),
            Err(e) => println!("  {RED}{label} error: {e}{RESET}"),
          }
        }
        result = dev_server::start_dev_server(static_dir, dev_port, config.backend.port, assets) => {
          if let Err(e) = result {
            println!("  {RED}dev server error: {e}{RESET}");
          }
        }
      }
    }
  } else {
    // Original behavior: wait for Ctrl+C or any child exit
    tokio::select! {
      _ = signal::ctrl_c() => {
        println!();
        println!("  {DIM}shutting down...{RESET}");
      }
      result = wait_any(&mut children) => {
        let (label, status) = result;
        let color = label_color(label);
        match status {
          Ok(s) if s.success() => println!("  {color}{label}{RESET} exited"),
          Ok(s) => println!("  {RED}{label} exited with {s}{RESET}"),
          Err(e) => println!("  {RED}{label} error: {e}{RESET}"),
        }
      }
    }
  }

  Ok(())
}

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

fn print_fullstack_banner(
  config: &SeamConfig,
  port: u16,
  watched_dirs: &[String],
  vite_port: Option<u16>,
) {
  let backend_cmd =
    config.backend.dev_command.as_deref().unwrap_or("bun --watch src/server/index.ts");
  let lang = &config.backend.lang;

  crate::ui::banner("dev", Some(&config.project.name));
  if let Some(vp) = vite_port {
    println!("  {MAGENTA}vite{RESET}      {DIM}http://localhost:{vp}{RESET}");
  }
  println!("  {CYAN}backend{RESET}   {DIM}[{lang}]{RESET} {DIM}{backend_cmd}{RESET}");
  println!("  {GREEN}mode{RESET}      fullstack CTR");
  if !watched_dirs.is_empty() {
    println!("  {GREEN}watching{RESET}  {DIM}{}{RESET}", watched_dirs.join(", "));
  }
  println!();
  if port == 80 {
    println!("  {GREEN}\u{2192}{RESET} {BOLD}http://localhost{RESET}");
  } else {
    println!("  {GREEN}\u{2192}{RESET} {BOLD}http://localhost:{port}{RESET}");
  }
  println!();
}

async fn handle_rebuild(
  config: &SeamConfig,
  build_config: &BuildConfig,
  base_dir: &Path,
  out_dir: &Path,
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
      write_reload_trigger(out_dir);
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

async fn run_dev_fullstack(config: &SeamConfig, base_dir: &Path) -> Result<()> {
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
        handle_rebuild(config, &build_config, base_dir, &out_dir).await;
      }
    }
  }

  Ok(())
}
