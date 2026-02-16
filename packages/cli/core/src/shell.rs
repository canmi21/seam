/* packages/cli/core/src/shell.rs */

// Shell command helpers shared across build and dev.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};

use crate::ui::{self, DIM, RESET};

/// Run a shell command, bail on failure (shows both stdout and stderr on error).
pub(crate) fn run_command(base_dir: &Path, command: &str, label: &str) -> Result<()> {
  ui::detail(&format!("{DIM}{command}{RESET}"));
  let output = Command::new("sh")
    .args(["-c", command])
    .current_dir(base_dir)
    .output()
    .with_context(|| format!("failed to run {label}"))?;
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
pub(crate) fn run_builtin_bundler(base_dir: &Path, entry: &str, out_dir: &str) -> Result<()> {
  let runtime = if which_exists("bun") { "bun" } else { "node" };
  let script = find_cli_script(base_dir, "build-frontend.mjs")?;
  ui::detail(&format!("{DIM}{runtime} build-frontend.mjs {entry} {out_dir}{RESET}"));
  let output = Command::new(runtime)
    .args([script.to_str().unwrap(), entry, out_dir])
    .current_dir(base_dir)
    .output()
    .context("failed to run built-in bundler")?;
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
  let path = base_dir.join("node_modules/@canmi/seam-cli/scripts").join(name);
  if path.exists() {
    return Ok(path);
  }
  bail!(
    "{name} not found at {} -- install @canmi/seam-cli or set build.bundler_command",
    path.display()
  );
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
