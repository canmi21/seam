/* packages/cli/core/src/dev/ui.rs */

use std::path::Path;

use anyhow::Result;

use crate::build::config::{BuildConfig, BundlerMode};
use crate::config::SeamConfig;
use crate::ui::{BOLD, CYAN, DIM, GREEN, MAGENTA, RESET, YELLOW};

pub(super) fn print_dev_banner(
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

pub(super) fn build_frontend(config: &SeamConfig, base_dir: &Path) -> Result<()> {
  crate::ui::step(1, 1, "Building frontend");
  let build_config = BuildConfig::from_seam_config(config)?;
  let dist_dir = build_config.dist_dir();
  match &build_config.bundler_mode {
    BundlerMode::BuiltIn { entry } => {
      crate::shell::run_builtin_bundler(base_dir, entry, dist_dir, &[])?;
    }
    BundlerMode::Custom { command } => {
      crate::shell::run_command(base_dir, command, "bundler", &[])?;
    }
  }
  crate::ui::blank();
  Ok(())
}

pub(super) fn print_fullstack_banner(
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
