/* src/cli/core/src/main.rs */
#![cfg_attr(test, allow(clippy::unwrap_used))]
#![allow(clippy::print_stdout, clippy::print_stderr)]

mod build;
mod clean;
mod config;
mod dev;
mod dev_server;
mod pull;
mod shell;
mod ui;
mod workspace;

use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};

use config::{SeamConfig, find_seam_config, load_seam_config};

#[derive(Parser)]
#[command(name = "seam", about = "SeamJS CLI", version)]
struct Cli {
	/// Disable rich output (no colors, no cursor movement).
	/// Auto-detected when NO_COLOR, CI, TERM=dumb, or non-TTY.
	#[arg(long, global = true)]
	plain: bool,

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
		/// Base URL or manifest URL to fetch before generating
		#[arg(short, long)]
		url: Option<String>,
		/// Output directory for the generated client
		#[arg(short, long)]
		out: Option<PathBuf>,
	},
	/// Build HTML skeletons from React components
	Build {
		/// Path to config file (auto-detected if omitted)
		#[arg(short, long)]
		config: Option<PathBuf>,
		/// Build a specific workspace member (workspace mode only)
		#[arg(short, long)]
		member: Option<String>,
	},
	/// Start dev servers (backend + frontend)
	Dev {
		/// Path to config file (auto-detected if omitted)
		#[arg(short, long)]
		config: Option<PathBuf>,
		/// Run dev mode for a specific workspace member
		#[arg(short, long)]
		member: Option<String>,
	},
	/// Remove build output, codegen artifacts, and run cleanup commands
	Clean {
		/// Path to config file (auto-detected if omitted)
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

/// Try to load config from cwd upward; returns None if not found
fn try_load_config() -> Option<SeamConfig> {
	let cwd = std::env::current_dir().ok()?;
	let path = find_seam_config(&cwd).ok()?;
	load_seam_config(&path).ok()
}

/// Resolve config path (explicit or auto-detected) and parse it
fn resolve_config(explicit: Option<PathBuf>) -> Result<(PathBuf, SeamConfig)> {
	let path = match explicit {
		Some(p) => {
			let cwd = std::env::current_dir().context("failed to get cwd")?;
			if p.is_absolute() { p } else { cwd.join(p) }
		}
		None => {
			let cwd = std::env::current_dir().context("failed to get cwd")?;
			find_seam_config(&cwd)?
		}
	};
	let config = load_seam_config(&path)?;
	Ok((path, config))
}

#[tokio::main]
async fn main() {
	// Install the crypto provider selected by feature flag (ring or aws-lc-rs via reqwest)
	#[cfg(feature = "crypto-ring")]
	rustls::crypto::ring::default_provider().install_default().ok();

	if let Err(e) = run().await {
		ui::error(&format!("{e:#}"));
		std::process::exit(1);
	}
}

fn write_hooks_and_declarations(
	seam_dir: &std::path::Path,
	base_dir: &std::path::Path,
	config: Option<&SeamConfig>,
) -> Result<()> {
	let emit_hooks = build::route::has_query_react_dep(
		base_dir,
		config.and_then(|cfg| cfg.frontend.entry.as_deref()),
	);
	std::fs::write(seam_dir.join("seam.d.ts"), seam_codegen::generate_type_declarations(emit_hooks))
		.context("failed to write .seam/generated/seam.d.ts")?;
	if emit_hooks {
		std::fs::write(seam_dir.join("hooks.ts"), seam_codegen::generate_hooks_module())
			.context("failed to write .seam/generated/hooks.ts")?;
	}
	Ok(())
}

fn resolve_generate_manifest_url(
	url: Option<String>,
	config: Option<&SeamConfig>,
) -> Option<String> {
	url.or_else(|| config.and_then(|cfg| cfg.generate.manifest_url.clone()))
}

async fn run() -> Result<()> {
	let cli = Cli::parse();
	ui::init_output_mode(cli.plain);

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
		Command::Generate { manifest, url, out } => {
			let cfg = try_load_config();
			let cwd = std::env::current_dir().context("failed to get cwd")?;

			ui::banner("generate", None);
			let parsed = if let Some(url) = resolve_generate_manifest_url(url, cfg.as_ref()) {
				ui::arrow(&format!("fetching {url}"));
				pull::fetch_manifest(&url).await?
			} else {
				let manifest = manifest.unwrap_or_else(|| PathBuf::from("seam-manifest.json"));
				ui::arrow(&format!("reading {}", manifest.display()));
				let content = std::fs::read_to_string(&manifest)
					.with_context(|| format!("failed to read {}", manifest.display()))?;
				serde_json::from_str(&content).context("failed to parse manifest")?
			};

			let proc_count = parsed.procedures.len();
			let data_id = cfg.as_ref().map_or("__data", |c| &c.frontend.data_id);
			let code = seam_codegen::generate_typescript(&parsed, None, data_id)?;
			let line_count = code.lines().count();

			// Primary: always write to .seam/generated/
			let seam_dir = cwd.join(".seam/generated");
			std::fs::create_dir_all(&seam_dir)
				.with_context(|| format!("failed to create {}", seam_dir.display()))?;
			std::fs::write(seam_dir.join("client.ts"), &code)
				.with_context(|| "failed to write .seam/generated/client.ts")?;
			write_hooks_and_declarations(&seam_dir, &cwd, cfg.as_ref())?;

			// Secondary: if --out or config outDir specified, also write there
			let user_out =
				out.or_else(|| cfg.as_ref().and_then(|c| c.generate.out_dir.as_ref()).map(PathBuf::from));
			if let Some(ref out_dir) = user_out {
				std::fs::create_dir_all(out_dir)
					.with_context(|| format!("failed to create {}", out_dir.display()))?;
				let file = out_dir.join("client.ts");
				std::fs::write(&file, &code)
					.with_context(|| format!("failed to write {}", file.display()))?;
			}

			ui::ok(&format!("generated {proc_count} procedures"));
			ui::ok(&format!(".seam/generated/client.ts  {line_count} lines"));
		}
		Command::Build { config, member } => {
			let (config_path, seam_config) = resolve_config(config)?;
			let base_dir = config_path.parent().unwrap_or_else(|| std::path::Path::new("."));
			warn_seam_not_gitignored(base_dir);
			build::config::BuildConfig::warn_stale_vite_config(base_dir);
			if seam_config.is_workspace() {
				workspace::run_workspace_build(&seam_config, base_dir, member.as_deref())?;
			} else if member.is_some() {
				anyhow::bail!(
					"--member flag requires a workspace project (add workspace section to config)"
				);
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
				anyhow::bail!(
					"--member flag requires a workspace project (add workspace section to config)"
				);
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

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn generate_url_flag_overrides_config_manifest_url() {
		let config: SeamConfig = toml::from_str(
			r#"
[generate]
manifest_url = "http://config.example/_seam/manifest.json"
"#,
		)
		.unwrap();

		let resolved = resolve_generate_manifest_url(
			Some("http://flag.example/_seam/manifest.json".to_string()),
			Some(&config),
		);
		assert_eq!(resolved.as_deref(), Some("http://flag.example/_seam/manifest.json"));
	}

	#[test]
	fn generate_uses_config_manifest_url_when_flag_missing() {
		let config: SeamConfig = toml::from_str(
			r#"
[generate]
manifest_url = "http://config.example/_seam/manifest.json"
"#,
		)
		.unwrap();

		let resolved = resolve_generate_manifest_url(None, Some(&config));
		assert_eq!(resolved.as_deref(), Some("http://config.example/_seam/manifest.json"));
	}

	#[test]
	fn generate_falls_back_to_local_manifest_when_no_url_configured() {
		let resolved = resolve_generate_manifest_url(None, None);
		assert!(resolved.is_none());
	}

	#[test]
	fn resolve_config_converts_explicit_relative_path_to_absolute() {
		let old_cwd = std::env::current_dir().unwrap();
		let tmp = std::env::temp_dir().join("seam-test-resolve-config-relative");
		let _ = std::fs::remove_dir_all(&tmp);
		std::fs::create_dir_all(&tmp).unwrap();
		std::fs::write(
			tmp.join("seam.dev-cwd.config.ts"),
			r#"export default { frontend: { entry: "src/main.tsx" }, build: { pagesDir: "src/pages" } }"#,
		)
		.unwrap();

		std::env::set_current_dir(&tmp).unwrap();
		let (path, _) = resolve_config(Some(PathBuf::from("seam.dev-cwd.config.ts"))).unwrap();
		assert!(path.is_absolute());
		assert_eq!(path.file_name().and_then(|name| name.to_str()), Some("seam.dev-cwd.config.ts"));
		assert!(path.ends_with("seam.dev-cwd.config.ts"));

		std::env::set_current_dir(old_cwd).unwrap();
		let _ = std::fs::remove_dir_all(&tmp);
	}
}
