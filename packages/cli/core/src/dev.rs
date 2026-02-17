/* packages/cli/core/src/dev.rs */

use std::path::Path;

use anyhow::{bail, Result};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::signal;

use crate::build::config::{BuildConfig, BundlerMode};
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
  port: Option<u16>,
) -> Result<ChildProcess> {
  let mut cmd = Command::new("sh");
  cmd.args(["-c", command]);
  cmd.current_dir(base_dir);
  cmd.stdout(std::process::Stdio::piped());
  cmd.stderr(std::process::Stdio::piped());
  cmd.kill_on_drop(true);

  if let Some(p) = port {
    cmd.env("PORT", p.to_string());
  }

  let child = cmd.spawn()?;
  Ok(ChildProcess { label, child })
}

fn label_color(label: &str) -> &'static str {
  match label {
    "backend" => CYAN,
    "frontend" => MAGENTA,
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

fn print_dev_banner(
  config: &SeamConfig,
  backend_cmd: Option<&str>,
  frontend_cmd: Option<&str>,
  use_embedded: bool,
) {
  crate::ui::banner("dev");

  if let Some(cmd) = backend_cmd {
    println!("  {CYAN}backend{RESET}   {DIM}{cmd}{RESET}");
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
      crate::shell::run_builtin_bundler(base_dir, entry, "dist")?;
    }
    BundlerMode::Custom { command } => {
      crate::shell::run_command(base_dir, command, "bundler")?;
    }
  }
  crate::ui::blank();
  Ok(())
}

pub async fn run_dev(config: &SeamConfig, base_dir: &Path) -> Result<()> {
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
    let mut proc = spawn_child("backend", cmd, base_dir, Some(config.backend.port))?;
    pipe_output(&mut proc).await;
    children.push(proc);
  }

  if let Some(cmd) = frontend_cmd {
    let mut proc = spawn_child("frontend", cmd, base_dir, None)?;
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
