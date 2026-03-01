/* packages/cli/core/src/main.rs */

mod build;
mod clean;
mod codegen;
mod config;
mod dev;
mod dev_server;
mod manifest;
mod pull;
mod shell;
mod ui;
mod workspace;

use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};

use config::{find_seam_config, load_seam_config, SeamConfig};

#[derive(Parser)]
#[command(name = "seam", about = "SeamJS CLI")]
struct Cli {
  #[command(subcommand)]
  command: Command,
}

#[derive(Subcommand)]
enum Command {
  /// Fetch a manifest from a running SeamJS server
  Pull {
    /// Base URL of the server (e.g. http://localhost:3000)
    #[arg(short, long)]
    url: Option<String>,
    /// Output file path
    #[arg(short, long)]
    out: Option<PathBuf>,
  },
  /// Generate a typed TypeScript client from a manifest file
  Generate {
    /// Path to the manifest JSON file
    #[arg(short, long)]
    manifest: Option<PathBuf>,
    /// Output directory for the generated client
    #[arg(short, long)]
    out: Option<PathBuf>,
  },
  /// Build HTML skeletons from React components
  Build {
    /// Path to seam.toml (auto-detected if omitted)
    #[arg(short, long)]
    config: Option<PathBuf>,
    /// Build a specific workspace member (workspace mode only)
    #[arg(short, long)]
    member: Option<String>,
  },
  /// Start dev servers (backend + frontend)
  Dev {
    /// Path to seam.toml (auto-detected if omitted)
    #[arg(short, long)]
    config: Option<PathBuf>,
    /// Run dev mode for a specific workspace member
    #[arg(short, long)]
    member: Option<String>,
  },
  /// Remove build output, codegen artifacts, and run cleanup commands
  Clean {
    /// Path to seam.toml (auto-detected if omitted)
    #[arg(short, long)]
    config: Option<PathBuf>,
    /// Clean a specific workspace member only
    #[arg(short, long)]
    member: Option<String>,
  },
}

/// Warn if `.seam/` is not covered by any gitignore rule
fn warn_seam_not_gitignored(base_dir: &std::path::Path) {
  use std::process::Command;
  let output =
    Command::new("git").args(["check-ignore", "-q", ".seam"]).current_dir(base_dir).output();
  match output {
    // exit 1 = not ignored by any gitignore rule
    Ok(o) if o.status.code() == Some(1) => {
      ui::warn(
        ".seam/ is not in .gitignore -- consider adding it to avoid tracking build artifacts",
      );
    }
    // exit 0 = ignored (good); other = not a git repo or git missing (skip)
    _ => {}
  }
}

/// Try to load seam.toml from cwd upward; returns None if not found
fn try_load_config() -> Option<SeamConfig> {
  let cwd = std::env::current_dir().ok()?;
  let path = find_seam_config(&cwd).ok()?;
  load_seam_config(&path).ok()
}

/// Resolve config path (explicit or auto-detected) and parse it
fn resolve_config(explicit: Option<PathBuf>) -> Result<(PathBuf, SeamConfig)> {
  let path = match explicit {
    Some(p) => p,
    None => {
      let cwd = std::env::current_dir().context("failed to get cwd")?;
      find_seam_config(&cwd)?
    }
  };
  let config = load_seam_config(&path)?;
  Ok((path, config))
}

#[tokio::main]
async fn main() -> Result<()> {
  let cli = Cli::parse();

  match cli.command {
    Command::Pull { url, out } => {
      let cfg = try_load_config();
      let url = url.unwrap_or_else(|| {
        let port = cfg.as_ref().map_or(3000, |c| c.backend.port);
        format!("http://localhost:{port}")
      });
      let out = out.unwrap_or_else(|| PathBuf::from("seam-manifest.json"));
      pull::pull_manifest(&url, &out).await?;
    }
    Command::Generate { manifest, out } => {
      let cfg = try_load_config();
      let manifest = manifest.unwrap_or_else(|| PathBuf::from("seam-manifest.json"));
      let out = out.unwrap_or_else(|| {
        cfg
          .as_ref()
          .and_then(|c| c.generate.out_dir.as_ref())
          .map(PathBuf::from)
          .unwrap_or_else(|| PathBuf::from("src/generated"))
      });

      ui::arrow(&format!("reading {}", manifest.display()));

      let content = std::fs::read_to_string(&manifest)
        .with_context(|| format!("failed to read {}", manifest.display()))?;
      let parsed: crate::manifest::Manifest =
        serde_json::from_str(&content).context("failed to parse manifest")?;

      let proc_count = parsed.procedures.len();
      let data_id = cfg.as_ref().map_or("__data", |c| &c.frontend.data_id);
      let code = codegen::generate_typescript(&parsed, None, data_id)?;
      let line_count = code.lines().count();

      std::fs::create_dir_all(&out)
        .with_context(|| format!("failed to create {}", out.display()))?;
      let file = out.join("client.ts");
      std::fs::write(&file, &code)
        .with_context(|| format!("failed to write {}", file.display()))?;

      let meta_code = codegen::generate_typescript_meta(data_id);
      let meta_file = out.join("meta.ts");
      std::fs::write(&meta_file, &meta_code)
        .with_context(|| format!("failed to write {}", meta_file.display()))?;

      ui::ok(&format!("generated {proc_count} procedures"));
      ui::ok(&format!("{}  {line_count} lines", file.display()));
    }
    Command::Build { config, member } => {
      let (config_path, seam_config) = resolve_config(config)?;
      let base_dir = config_path.parent().unwrap_or_else(|| std::path::Path::new("."));
      warn_seam_not_gitignored(base_dir);
      if seam_config.is_workspace() {
        workspace::run_workspace_build(&seam_config, base_dir, member.as_deref())?;
      } else if member.is_some() {
        anyhow::bail!("--member flag requires a workspace project (add [workspace] to seam.toml)");
      } else {
        build::run::run_build(&seam_config, base_dir)?;
      }
    }
    Command::Dev { config, member } => {
      let (config_path, seam_config) = resolve_config(config)?;
      let base_dir = config_path.parent().unwrap_or_else(|| std::path::Path::new("."));
      warn_seam_not_gitignored(base_dir);
      if seam_config.is_workspace() {
        let member_name = member.as_deref().with_context(|| {
          let available: Vec<_> = seam_config
            .member_paths()
            .iter()
            .filter_map(|p| std::path::Path::new(p).file_name().and_then(|n| n.to_str()))
            .collect();
          format!(
            "--member is required for workspace dev mode\navailable members: {}",
            available.join(", ")
          )
        })?;
        dev::run_dev_workspace(&seam_config, base_dir, member_name).await?;
      } else if member.is_some() {
        anyhow::bail!("--member flag requires a workspace project (add [workspace] to seam.toml)");
      } else {
        dev::run_dev(&seam_config, base_dir).await?;
      }
    }
    Command::Clean { config, member } => {
      let (config_path, seam_config) = resolve_config(config)?;
      let base_dir = config_path.parent().unwrap_or_else(|| std::path::Path::new("."));
      clean::run_clean(&seam_config, base_dir, member.as_deref())?;
    }
  }

  Ok(())
}
