/* packages/cli/core/src/main.rs */

mod build;
mod codegen;
mod manifest;
mod pull;

use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "seam", about = "SeamJS CLI — manifest pull, codegen, and build")]
struct Cli {
  #[command(subcommand)]
  command: Command,
}

#[derive(Subcommand)]
enum Command {
  /// Fetch a manifest from a running SeamJS server
  Pull {
    /// Base URL of the server (e.g. http://localhost:3000)
    url: String,
    /// Output file path
    #[arg(short, long, default_value = "seam-manifest.json")]
    out: PathBuf,
  },
  /// Generate a typed TypeScript client from a manifest file
  Generate {
    /// Path to the manifest JSON file
    #[arg(short, long)]
    manifest: PathBuf,
    /// Output directory for the generated client
    #[arg(short, long)]
    out: PathBuf,
  },
  /// Build HTML skeletons from React components
  Build {
    /// Path to seam.config.json
    #[arg(short, long, default_value = "seam.config.json")]
    config: PathBuf,
  },
}

#[tokio::main]
async fn main() -> Result<()> {
  let cli = Cli::parse();

  match cli.command {
    Command::Pull { url, out } => {
      pull::pull_manifest(&url, &out).await?;
    }
    Command::Generate { manifest, out } => {
      let content = std::fs::read_to_string(&manifest)
        .with_context(|| format!("failed to read {}", manifest.display()))?;
      let parsed: crate::manifest::Manifest =
        serde_json::from_str(&content).context("failed to parse manifest")?;
      let code = codegen::generate_typescript(&parsed)?;

      std::fs::create_dir_all(&out)
        .with_context(|| format!("failed to create {}", out.display()))?;
      let file = out.join("client.ts");
      std::fs::write(&file, code).with_context(|| format!("failed to write {}", file.display()))?;

      println!("generated {}", file.display());
    }
    Command::Build { config } => {
      build::run::run_build(&config)?;
    }
  }

  Ok(())
}
