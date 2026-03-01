/* src/cli/core/src/dev/process.rs */

use std::path::Path;

use anyhow::{Context, Result};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::ui::{CYAN, DIM, MAGENTA, RESET};

pub(super) struct ChildProcess {
  pub label: &'static str,
  pub child: tokio::process::Child,
}

pub(super) fn spawn_child(
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
pub(super) fn spawn_binary(
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

pub(super) fn label_color(label: &str) -> &'static str {
  match label {
    "backend" => CYAN,
    "frontend" | "vite" => MAGENTA,
    _ => DIM,
  }
}

/// Pipe stdout/stderr, prefixed with a colored label
pub(super) async fn pipe_output(proc: &mut ChildProcess) {
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
pub(super) async fn wait_any(
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
