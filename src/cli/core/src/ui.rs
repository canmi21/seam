/* src/cli/core/src/ui.rs */

use std::io::{IsTerminal, Write};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Instant;

use indicatif::{ProgressBar, ProgressStyle};

// -- Colors --

pub const RESET: &str = "\x1b[0m";
pub const BOLD: &str = "\x1b[1m";
pub const DIM: &str = "\x1b[2m";
pub const UNDERLINE: &str = "\x1b[4m";
pub const RED: &str = "\x1b[31m";
pub const GREEN: &str = "\x1b[32m";
pub const YELLOW: &str = "\x1b[33m";
pub const BLUE: &str = "\x1b[34m";
pub const MAGENTA: &str = "\x1b[35m";
pub const CYAN: &str = "\x1b[36m";
pub const BRIGHT_GREEN: &str = "\x1b[92m";
pub const BRIGHT_CYAN: &str = "\x1b[96m";

// -- Output mode --

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputMode {
  Rich,
  Plain,
}

static OUTPUT_MODE: OnceLock<OutputMode> = OnceLock::new();

/// Detail-line counter for rich mode cursor movement in StepTracker::end
static DETAIL_LINES: AtomicU32 = AtomicU32::new(0);

/// Detect output mode from environment.  Call once at startup.
/// Falls back to auto-detection if never called.
pub fn init_output_mode(force_plain: bool) {
  let _ = OUTPUT_MODE.set(detect_mode(force_plain));
}

fn detect_mode(force_plain: bool) -> OutputMode {
  if force_plain
    || std::env::var_os("NO_COLOR").is_some()
    || std::env::var_os("CI").is_some()
    || std::env::var("TERM").ok().as_deref() == Some("dumb")
    || !std::io::stdout().is_terminal()
  {
    OutputMode::Plain
  } else {
    OutputMode::Rich
  }
}

fn output_mode() -> OutputMode {
  *OUTPUT_MODE.get_or_init(|| detect_mode(false))
}

/// Return ANSI code when Rich, empty string when Plain.
pub fn col(code: &str) -> &str {
  if output_mode() == OutputMode::Rich { code } else { "" }
}

fn inc_detail_lines() {
  if output_mode() == OutputMode::Rich {
    DETAIL_LINES.fetch_add(1, Ordering::Relaxed);
  }
}

fn reset_detail_lines() -> u32 {
  DETAIL_LINES.swap(0, Ordering::Relaxed)
}

// -- Constants --

const VERSION: &str = env!("CARGO_PKG_VERSION");

pub const LABEL_WIDTH: usize = 10;

// -- Output functions --

pub fn ok(msg: &str) {
  println!("  {}\u{2713}{} {msg}", col(GREEN), col(RESET));
}

pub fn arrow(msg: &str) {
  println!("  {}\u{2192}{} {msg}", col(GREEN), col(RESET));
}

/// Print a step header (standalone, no StepTracker).
/// Kept for workspace / dev contexts that don't use StepTracker.
pub fn step(n: u32, total: u32, msg: &str) -> Instant {
  println!("  {}{}[{n}/{total}]{} {msg}...", col(BLUE), col(BOLD), col(RESET));
  Instant::now()
}

pub fn detail(msg: &str) {
  println!("        {msg}");
  inc_detail_lines();
}

pub fn detail_ok(msg: &str) {
  println!("        {}\u{2713}{} {msg}", col(GREEN), col(RESET));
  inc_detail_lines();
}

pub fn detail_warn(msg: &str) {
  println!("        {}warning{}: {msg}", col(YELLOW), col(RESET));
  inc_detail_lines();
}

pub fn label(color: &str, name: &str, msg: &str) {
  let c = col(color);
  let r = col(RESET);
  println!("  {c}{name:>LABEL_WIDTH$}{r} {msg}");
}

pub fn banner(cmd: &str, project_name: Option<&str>) {
  let (bl, b, d, r) = (col(BLUE), col(BOLD), col(DIM), col(RESET));
  println!();
  if let Some(name) = project_name {
    println!("  {bl}{b}seam{r} {cmd} {d}v{VERSION}{r}  {d}{name}{r}");
  } else {
    println!("  {bl}{b}seam{r} {cmd} {d}v{VERSION}{r}");
  }
  println!();
}

pub fn error(msg: &str) {
  eprintln!("\n  {}error{}: {msg}\n", col(RED), col(RESET));
}

pub fn shutting_down() {
  println!("  {}shutting down...{}", col(DIM), col(RESET));
}

pub fn process_exited(
  label: &str,
  color: &str,
  status: Result<std::process::ExitStatus, std::io::Error>,
) {
  let c = col(color);
  let r = col(RESET);
  let red = col(RED);
  match status {
    Ok(s) if s.success() => println!("  {c}{label}{r} exited"),
    Ok(s) => println!("  {red}{label} exited with {s}{r}"),
    Err(e) => println!("  {red}{label} error: {e}{r}"),
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
  println!("  {}warning{}: {msg}", col(YELLOW), col(RESET));
}

pub fn blank() {
  println!();
}

// -- StepTracker --

/// Declarative build-step tracker with rich-mode overwrite-in-place.
///
/// In Rich mode, `end()` rewrites the step header with a checkmark + timing
/// by cursor-moving over the detail lines.  In Plain mode, behaviour matches
/// the original `step()` / `step_done()` pattern.
pub struct StepTracker {
  steps: Vec<&'static str>,
  current: usize,
}

impl StepTracker {
  pub fn new(steps: Vec<&'static str>) -> Self {
    Self { steps, current: 0 }
  }

  /// Print step header and return the start instant.
  pub fn begin(&mut self) -> Instant {
    let n = self.current + 1;
    let total = self.steps.len();
    let label = self.steps[self.current];
    self.current += 1;
    reset_detail_lines();
    println!("  {}{}[{n}/{total}]{} {label}...", col(BLUE), col(BOLD), col(RESET));
    Instant::now()
  }

  /// Complete the current step.
  /// Rich: overwrite step header with checkmark + timing, keep detail lines.
  /// Plain: print "done (Xs)" + blank line (original behaviour).
  pub fn end(&mut self, started: Instant) {
    let elapsed = started.elapsed().as_secs_f64();
    let n = self.current;
    let total = self.steps.len();
    let label = self.steps[n - 1];

    match output_mode() {
      OutputMode::Rich => {
        let detail_count = reset_detail_lines();
        let up = detail_count + 1;
        // Cursor up to step header, clear line
        print!("\x1b[{up}A\x1b[2K");
        if elapsed >= 0.1 {
          println!(
            "  {}{}[{n}/{total}]{} {}\u{2713}{} {label} {}({elapsed:.1}s){}",
            col(BLUE),
            col(BOLD),
            col(RESET),
            col(GREEN),
            col(RESET),
            col(BRIGHT_CYAN),
            col(RESET),
          );
        } else {
          println!(
            "  {}{}[{n}/{total}]{} {}\u{2713}{} {label}",
            col(BLUE),
            col(BOLD),
            col(RESET),
            col(GREEN),
            col(RESET),
          );
        }
        // Cursor back down past detail lines
        if detail_count > 0 {
          print!("\x1b[{detail_count}B");
        }
        std::io::stdout().flush().ok();
      }
      OutputMode::Plain => {
        if elapsed >= 1.0 {
          println!("        done {}({elapsed:.1}s){}", col(BRIGHT_CYAN), col(RESET));
        }
        println!();
      }
    }
  }
}

// -- Spinner --

enum SpinnerInner {
  Animated(ProgressBar),
  Static,
}

pub struct Spinner {
  inner: SpinnerInner,
  msg: String,
  started: Instant,
}

pub fn spinner(msg: &str) -> Spinner {
  match output_mode() {
    OutputMode::Rich => {
      let pb = ProgressBar::new_spinner();
      pb.set_style(
        ProgressStyle::default_spinner()
          .tick_chars("\u{280b}\u{2819}\u{2838}\u{28b0}\u{28e0}\u{28c4}\u{2846}\u{2807} ")
          .template("        {spinner} {msg}")
          .unwrap(),
      );
      pb.set_message(msg.to_string());
      pb.enable_steady_tick(std::time::Duration::from_millis(80));
      Spinner { inner: SpinnerInner::Animated(pb), msg: msg.to_string(), started: Instant::now() }
    }
    OutputMode::Plain => {
      println!("        {msg}...");
      inc_detail_lines();
      Spinner { inner: SpinnerInner::Static, msg: msg.to_string(), started: Instant::now() }
    }
  }
}

impl Spinner {
  pub fn finish(self) {
    let elapsed = self.started.elapsed().as_secs_f64();
    match self.inner {
      SpinnerInner::Animated(pb) => pb.finish_and_clear(),
      SpinnerInner::Static => {}
    }
    println!("        {}\u{2713}{} {} ({elapsed:.1}s)", col(GREEN), col(RESET), self.msg);
    inc_detail_lines();
  }

  pub fn finish_with(self, msg: &str) {
    let elapsed = self.started.elapsed().as_secs_f64();
    match self.inner {
      SpinnerInner::Animated(pb) => pb.finish_and_clear(),
      SpinnerInner::Static => {}
    }
    println!("        {}\u{2713}{} {msg} ({elapsed:.1}s)", col(GREEN), col(RESET));
    inc_detail_lines();
  }
}
