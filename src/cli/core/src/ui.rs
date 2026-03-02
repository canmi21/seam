/* src/cli/core/src/ui.rs */

use std::time::Instant;

use indicatif::{ProgressBar, ProgressStyle};

pub const RESET: &str = "\x1b[0m";
pub const BOLD: &str = "\x1b[1m";
pub const DIM: &str = "\x1b[2m";
pub const RED: &str = "\x1b[31m";
pub const GREEN: &str = "\x1b[32m";
pub const YELLOW: &str = "\x1b[33m";
pub const MAGENTA: &str = "\x1b[35m";
pub const CYAN: &str = "\x1b[36m";

const VERSION: &str = env!("CARGO_PKG_VERSION");

pub const LABEL_WIDTH: usize = 10;

pub fn ok(msg: &str) {
  println!("  {GREEN}\u{2713}{RESET} {msg}");
}

pub fn arrow(msg: &str) {
  println!("  {GREEN}\u{2192}{RESET} {msg}");
}

pub fn step(n: u32, total: u32, msg: &str) -> Instant {
  println!("  {BOLD}[{n}/{total}]{RESET} {msg}...");
  Instant::now()
}

pub fn step_done(started: Instant) {
  let elapsed = started.elapsed().as_secs_f64();
  if elapsed >= 1.0 {
    println!("        done ({elapsed:.1}s)");
  }
}

pub fn detail(msg: &str) {
  println!("        {msg}");
}

pub fn detail_ok(msg: &str) {
  println!("        {GREEN}\u{2713}{RESET} {msg}");
}

pub fn detail_warn(msg: &str) {
  println!("        {YELLOW}warning{RESET}: {msg}");
}

pub fn label(color: &str, name: &str, msg: &str) {
  println!("  {color}{name:>LABEL_WIDTH$}{RESET} {msg}");
}

pub fn banner(cmd: &str, project_name: Option<&str>) {
  println!();
  if let Some(name) = project_name {
    println!("  {BOLD}seam{RESET} {cmd} {DIM}v{VERSION}{RESET}  {DIM}{name}{RESET}");
  } else {
    println!("  {BOLD}seam{RESET} {cmd} {DIM}v{VERSION}{RESET}");
  }
  println!();
}

pub fn error(msg: &str) {
  eprintln!("\n  {RED}error{RESET}: {msg}\n");
}

pub fn shutting_down() {
  println!("  {DIM}shutting down...{RESET}");
}

pub fn process_exited(
  label: &str,
  color: &str,
  status: Result<std::process::ExitStatus, std::io::Error>,
) {
  match status {
    Ok(s) if s.success() => println!("  {color}{label}{RESET} exited"),
    Ok(s) => println!("  {RED}{label} exited with {s}{RESET}"),
    Err(e) => println!("  {RED}{label} error: {e}{RESET}"),
  }
}

pub fn format_size(bytes: u64) -> String {
  if bytes >= 1_000_000 {
    format!("{:.1} MB", bytes as f64 / 1_000_000.0)
  } else if bytes >= 1_000 {
    format!("{:.1} kB", bytes as f64 / 1_000.0)
  } else {
    format!("{bytes} B")
  }
}

pub fn warn(msg: &str) {
  println!("  {YELLOW}warning{RESET}: {msg}");
}

pub fn blank() {
  println!();
}

// -- Spinner --

pub struct Spinner {
  pb: ProgressBar,
  msg: String,
  started: Instant,
}

pub fn spinner(msg: &str) -> Spinner {
  let pb = ProgressBar::new_spinner();
  pb.set_style(
    ProgressStyle::default_spinner()
      .tick_chars("\u{280b}\u{2819}\u{2838}\u{28b0}\u{28e0}\u{28c4}\u{2846}\u{2807} ")
      .template("        {spinner} {msg}")
      .unwrap(),
  );
  pb.set_message(msg.to_string());
  pb.enable_steady_tick(std::time::Duration::from_millis(80));
  Spinner { pb, msg: msg.to_string(), started: Instant::now() }
}

impl Spinner {
  pub fn finish(self) {
    let elapsed = self.started.elapsed().as_secs_f64();
    self.pb.finish_and_clear();
    println!("        {GREEN}\u{2713}{RESET} {} ({elapsed:.1}s)", self.msg);
  }

  pub fn finish_with(self, msg: &str) {
    let elapsed = self.started.elapsed().as_secs_f64();
    self.pb.finish_and_clear();
    println!("        {GREEN}\u{2713}{RESET} {msg} ({elapsed:.1}s)");
  }
}
