/* packages/cli/core/src/dev.rs */

use std::path::Path;

use anyhow::{bail, Result};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::signal;

use crate::config::SeamConfig;

const VERSION: &str = env!("CARGO_PKG_VERSION");

// ANSI color helpers
const RESET: &str = "\x1b[0m";
const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[2m";
const CYAN: &str = "\x1b[36m";
const GREEN: &str = "\x1b[32m";
const MAGENTA: &str = "\x1b[35m";
const YELLOW: &str = "\x1b[33m";
const RED: &str = "\x1b[31m";

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

pub async fn run_dev(config: &SeamConfig, base_dir: &Path) -> Result<()> {
  let backend_cmd = config.backend.dev_command.as_deref();
  let frontend_cmd = config.frontend.dev_command.as_deref();

  if backend_cmd.is_none() && frontend_cmd.is_none() {
    bail!(
      "no dev_command configured in seam.toml (set backend.dev_command or frontend.dev_command)"
    );
  }

  // Banner
  println!();
  println!("  {BOLD}SeamJS{RESET} {DIM}v{VERSION}{RESET} dev");
  println!();

  if let Some(cmd) = backend_cmd {
    println!("  {CYAN}backend{RESET}   {DIM}{cmd}{RESET}");
  }
  if let Some(cmd) = frontend_cmd {
    let port_suffix =
      config.frontend.dev_port.map_or(String::new(), |p| format!(" {DIM}:{p}{RESET}"));
    println!("  {MAGENTA}frontend{RESET}  {DIM}{cmd}{RESET}{port_suffix}");
  }
  if backend_cmd.is_some() {
    if let Some(fp) = config.frontend.dev_port {
      println!("  {YELLOW}proxy{RESET}     {DIM}:{} \u{2192} :{fp}{RESET}", config.backend.port);
    }
  }
  println!();
  println!("  {GREEN}\u{2192}{RESET} {BOLD}http://localhost:{}{RESET}", config.backend.port);
  println!();

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

  // Wait for Ctrl+C or any child exit
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

  Ok(())
}
