/* packages/cli/core/src/dev/mod.rs */

mod fullstack;
mod network;
mod process;
mod ui;

use std::path::Path;

use anyhow::{bail, Result};
use tokio::signal;

use crate::build::config::BuildConfig;
use crate::build::types::read_bundle_manifest;
use crate::config::SeamConfig;
use crate::dev_server;
use crate::ui::{DIM, RED, RESET};

use fullstack::run_dev_fullstack;
use process::{label_color, pipe_output, spawn_child, wait_any, ChildProcess};
use ui::{build_frontend, print_dev_banner};

pub use fullstack::run_dev_workspace;

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
    let (manifest_path, static_dir) = match &build_config {
      Ok(bc) => (base_dir.join(&bc.bundler_manifest), base_dir.join(bc.dist_dir())),
      Err(_) => (base_dir.join(".seam/dist/.seam/manifest.json"), base_dir.join(".seam/dist")),
    };
    let assets = read_bundle_manifest(&manifest_path)?;

    if children.is_empty() {
      // No backend -- just run dev server
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
