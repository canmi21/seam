/* packages/cli/core/src/dev.rs */

use std::path::Path;

use anyhow::{bail, Result};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::signal;

use crate::config::SeamConfig;

const VERSION: &str = env!("CARGO_PKG_VERSION");

struct ChildProcess {
  label: &'static str,
  child: tokio::process::Child,
}

fn spawn_child(label: &'static str, command: &str, base_dir: &Path, port: Option<u16>) -> Result<ChildProcess> {
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

/// Pipe stdout/stderr with a prefix label
async fn pipe_output(proc: &mut ChildProcess) {
  let label = proc.label;
  let stdout = proc.child.stdout.take();
  let stderr = proc.child.stderr.take();

  if let Some(stdout) = stdout {
    let reader = BufReader::new(stdout);
    tokio::spawn(async move {
      let mut lines = reader.lines();
      while let Ok(Some(line)) = lines.next_line().await {
        println!("  [{label}] {line}");
      }
    });
  }

  if let Some(stderr) = stderr {
    let reader = BufReader::new(stderr);
    tokio::spawn(async move {
      let mut lines = reader.lines();
      while let Ok(Some(line)) = lines.next_line().await {
        eprintln!("  [{label}] {line}");
      }
    });
  }
}

pub async fn run_dev(config: &SeamConfig, base_dir: &Path) -> Result<()> {
  let backend_cmd = config.backend.dev_command.as_deref();
  let frontend_cmd = config.frontend.dev_command.as_deref();

  if backend_cmd.is_none() && frontend_cmd.is_none() {
    bail!("no dev_command configured in seam.toml (set backend.dev_command or frontend.dev_command)");
  }

  // Print banner
  println!();
  println!("  SeamJS v{VERSION} dev");
  println!();

  if let Some(cmd) = backend_cmd {
    println!("  backend   {cmd}");
  }
  if let Some(cmd) = frontend_cmd {
    let port_suffix = config.frontend.dev_port.map_or(String::new(), |p| format!(" :{p}"));
    println!("  frontend  {cmd}{port_suffix}");
  }
  if backend_cmd.is_some() && config.frontend.dev_port.is_some() {
    println!(
      "  proxy     :{} \u{2192} :{}",
      config.backend.port,
      config.frontend.dev_port.unwrap()
    );
  }
  println!();
  println!("  \u{2192} http://localhost:{}", config.backend.port);
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
      println!("  shutting down...");
    }
    result = async {
      for child in &mut children {
        let status = child.child.wait().await;
        return (child.label, status);
      }
      unreachable!()
    } => {
      let (label, status) = result;
      match status {
        Ok(s) if s.success() => println!("  [{label}] exited"),
        Ok(s) => println!("  [{label}] exited with {s}"),
        Err(e) => println!("  [{label}] error: {e}"),
      }
    }
  }

  // kill_on_drop handles cleanup when children are dropped
  Ok(())
}
