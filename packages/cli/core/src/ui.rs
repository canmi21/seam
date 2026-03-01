/* packages/cli/core/src/ui.rs */

pub const RESET: &str = "\x1b[0m";
pub const BOLD: &str = "\x1b[1m";
pub const DIM: &str = "\x1b[2m";
pub const RED: &str = "\x1b[31m";
pub const GREEN: &str = "\x1b[32m";
pub const YELLOW: &str = "\x1b[33m";
pub const MAGENTA: &str = "\x1b[35m";
pub const CYAN: &str = "\x1b[36m";

const VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn ok(msg: &str) {
  println!("  {GREEN}\u{2713}{RESET} {msg}");
}

pub fn arrow(msg: &str) {
  println!("  {GREEN}\u{2192}{RESET} {msg}");
}

pub fn step(n: u32, total: u32, msg: &str) {
  println!("  {BOLD}[{n}/{total}]{RESET} {msg}...");
}

pub fn detail(msg: &str) {
  println!("        {msg}");
}

pub fn detail_ok(msg: &str) {
  println!("        {GREEN}\u{2713}{RESET} {msg}");
}

pub fn banner(cmd: &str, project_name: Option<&str>) {
  println!();
  if let Some(name) = project_name {
    println!("  {BOLD}SeamJS{RESET} {cmd} {DIM}v{VERSION}{RESET}  {DIM}{name}{RESET}");
  } else {
    println!("  {BOLD}SeamJS{RESET} {cmd} {DIM}v{VERSION}{RESET}");
  }
  println!();
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
