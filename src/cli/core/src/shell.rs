/* src/cli/core/src/shell.rs */

// Shell command helpers shared across build and dev.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};

use crate::ui::{self, DIM, RESET};

/// Run a shell command, bail on failure (shows both stdout and stderr on error).
pub(crate) fn run_command(
  base_dir: &Path,
  command: &str,
  label: &str,
  env: &[(&str, &str)],
) -> Result<()> {
  ui::detail(&format!("{DIM}{command}{RESET}"));
  let mut cmd = Command::new("sh");
  cmd.args(["-c", command]);
  cmd.current_dir(base_dir);
  for (k, v) in env {
    cmd.env(k, v);
  }
  let output = cmd.output().with_context(|| format!("failed to run {label}"))?;
  if !output.status.success() {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut msg = format!("{label} exited with status {}", output.status);
    if !stderr.is_empty() {
      msg.push('\n');
      msg.push_str(&stderr);
    }
    if !stdout.is_empty() {
      msg.push('\n');
      msg.push_str(&stdout);
    }
    bail!("{msg}");
  }
  Ok(())
}

/// Run the built-in Rolldown bundler via the packaged build script.
pub(crate) fn run_builtin_bundler(
  base_dir: &Path,
  entry: &str,
  out_dir: &str,
  env: &[(&str, &str)],
) -> Result<()> {
  let runtime = if which_exists("bun") { "bun" } else { "node" };
  let script = find_cli_script(base_dir, "build-frontend.mjs")?;
  ui::detail(&format!("{DIM}{runtime} build-frontend.mjs {entry} {out_dir}{RESET}"));
  let mut cmd = Command::new(runtime);
  cmd.args([script.to_str().unwrap(), entry, out_dir]);
  cmd.current_dir(base_dir);
  for (k, v) in env {
    cmd.env(k, v);
  }
  let output = cmd.output().context("failed to run built-in bundler")?;
  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut msg = format!("built-in bundler exited with status {}", output.status);
    if !stderr.is_empty() {
      msg.push('\n');
      msg.push_str(&stderr);
    }
    if !stdout.is_empty() {
      msg.push('\n');
      msg.push_str(&stdout);
    }
    bail!("{msg}");
  }
  Ok(())
}

/// Locate a script bundled with @canmi/seam-cli.
fn find_cli_script(base_dir: &Path, name: &str) -> Result<PathBuf> {
  let suffix = format!("@canmi/seam-cli/scripts/{name}");
  resolve_node_module(base_dir, &suffix).ok_or_else(|| {
    anyhow::anyhow!("{name} not found -- install @canmi/seam-cli or set build.bundler_command")
  })
}

/// Resolve a path inside node_modules by walking up parent directories.
/// Mirrors Node.js module resolution: checks `<dir>/node_modules/<suffix>` at each level.
/// Also scans immediate subdirectories of `start` (bun workspace puts symlinks in member node_modules).
pub(crate) fn resolve_node_module(start: &Path, suffix: &str) -> Option<PathBuf> {
  // Walk up from start
  let mut dir = start.to_path_buf();
  loop {
    let candidate = dir.join("node_modules").join(suffix);
    if candidate.exists() {
      return Some(candidate);
    }
    if !dir.pop() {
      break;
    }
  }
  // Scan immediate subdirectories (bun workspace hoists into member node_modules)
  if let Ok(entries) = std::fs::read_dir(start) {
    for entry in entries.flatten() {
      if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
        let candidate = entry.path().join("node_modules").join(suffix);
        if candidate.exists() {
          return Some(candidate);
        }
      }
    }
  }
  None
}

/// Check if a command exists on PATH.
pub(crate) fn which_exists(cmd: &str) -> bool {
  Command::new("which")
    .arg(cmd)
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null())
    .status()
    .map(|s| s.success())
    .unwrap_or(false)
}
