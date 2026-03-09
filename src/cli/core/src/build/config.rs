/* src/cli/core/src/build/config.rs */

use std::path::Path;

use anyhow::{Result, bail};

use crate::config::{I18nSection, OutputMode, SeamConfig};
use crate::ui;

#[derive(Debug, Clone)]
pub struct BuildConfig {
	pub output: OutputMode,
	pub entry: String,
	pub routes: String,
	pub out_dir: String,
	pub renderer: String,
	pub backend_build_command: Option<String>,
	pub router_file: Option<String>,
	pub manifest_command: Option<String>,
	pub typecheck_command: Option<String>,
	pub is_fullstack: bool,
	pub obfuscate: bool,
	pub sourcemap: bool,
	pub type_hint: bool,
	pub hash_length: usize,
	pub rpc_salt: Option<String>,
	pub root_id: String,
	pub data_id: String,
	pub pages_dir: Option<String>,
	pub i18n: Option<I18nSection>,
	/// Absolute path to seam.config.ts/mjs (for bundler scripts via SEAM_CONFIG_PATH)
	pub config_path: Option<String>,
}

impl BuildConfig {
	pub fn from_seam_config(config: &SeamConfig) -> Result<Self> {
		let build = &config.build;

		if build.bundler_command.is_some() || config.frontend.build_command.is_some() {
			bail!(
				"bundlerCommand has been removed -- use frontend.entry with the built-in bundler instead"
			);
		}

		let pages_dir = build.pages_dir.clone();
		let routes = match (&build.routes, &pages_dir) {
			(Some(_), Some(_)) => bail!("build.routes and build.pages_dir are mutually exclusive"),
			(Some(r), None) => r.clone(),
			(None, Some(_)) => ".seam/generated/routes.ts".to_string(),
			(None, None) => bail!("either build.routes or build.pages_dir is required in config"),
		};

		let out_dir = build
			.out_dir
			.clone()
			.or_else(|| config.frontend.out_dir.clone())
			.unwrap_or_else(|| ".seam/output".to_string());

		let entry =
			config.frontend.entry.clone().ok_or_else(|| anyhow::anyhow!("frontend.entry is required"))?;

		let renderer = build.renderer.clone().unwrap_or_else(|| "react".to_string());
		if renderer != "react" {
			bail!("unsupported renderer '{renderer}' (only 'react' is currently supported)");
		}
		let backend_build_command = build.backend_build_command.clone();
		let router_file = build.router_file.clone();
		let manifest_command = build.manifest_command.clone();
		let typecheck_command = build.typecheck_command.clone();
		let is_fullstack = backend_build_command.is_some();
		let obfuscate = build.obfuscate.unwrap_or(true);
		let sourcemap = build.sourcemap.unwrap_or(false);
		let type_hint = build.type_hint.unwrap_or(true);
		let hash_length = build.hash_length.unwrap_or(12) as usize;
		if !(4..=64).contains(&hash_length) {
			bail!("hash_length must be between 4 and 64 (got {hash_length})");
		}

		let root_id = config.frontend.root_id.clone();
		let data_id = config.frontend.data_id.clone();
		let i18n = config.i18n.clone();
		let config_path = config.config_file_path.clone();

		Ok(Self {
			output: config.output,
			entry,
			routes,
			out_dir,
			renderer,
			backend_build_command,
			router_file,
			manifest_command,
			typecheck_command,
			is_fullstack,
			obfuscate,
			sourcemap,
			type_hint,
			hash_length,
			rpc_salt: None,
			root_id,
			data_id,
			pages_dir,
			i18n,
			config_path,
		})
	}

	/// Dist directory is always `.seam/dist` (built-in bundler only).
	#[allow(clippy::unused_self)]
	pub fn dist_dir(&self) -> &str {
		".seam/dist"
	}

	/// Vite manifest path within the dist directory.
	pub fn bundler_manifest(&self) -> String {
		format!("{}/.vite/manifest.json", self.dist_dir())
	}

	/// Warn if a stale vite.config.ts/js/mjs exists in the project directory.
	pub fn warn_stale_vite_config(base_dir: &Path) {
		for name in ["vite.config.ts", "vite.config.js", "vite.config.mjs"] {
			if base_dir.join(name).exists() {
				ui::warn(&format!("{name} is ignored -- move settings to seam.config.ts vite field"));
			}
		}
	}

	pub fn from_seam_config_dev(config: &SeamConfig) -> Result<Self> {
		let mut bc = Self::from_seam_config(config)?;
		bc.obfuscate = config.dev.obfuscate.unwrap_or(false);
		bc.sourcemap = config.dev.sourcemap.unwrap_or(true);
		bc.type_hint = config.dev.type_hint.unwrap_or(true);
		if let Some(n) = config.dev.hash_length {
			bc.hash_length = n as usize;
		}
		bc.rpc_salt = None;
		Ok(bc)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::config::SeamConfig;

	fn parse_config(toml_str: &str) -> SeamConfig {
		toml::from_str(toml_str).unwrap()
	}

	/// Parse a fullstack config with optional extra [build] fields and extra top-level sections.
	fn parse_fullstack(extra_build: &str, extra: &str) -> SeamConfig {
		parse_config(&format!(
			r#"
[project]
name = "test"

[frontend]
entry = "src/client/main.tsx"

[build]
routes = "./src/routes.ts"
out_dir = ".seam/output"
backend_build_command = "bun build"
router_file = "src/server/router.ts"
{extra_build}
{extra}"#
		))
	}

	#[test]
	fn builtin_bundler_with_entry() {
		let config = parse_fullstack("", "");
		let build = BuildConfig::from_seam_config(&config).unwrap();
		assert_eq!(build.entry, "src/client/main.tsx");
		assert_eq!(build.bundler_manifest(), ".seam/dist/.vite/manifest.json");
		assert!(build.is_fullstack);
	}

	#[test]
	fn bundler_command_rejected() {
		let config = parse_config(
			r#"
[project]
name = "test"

[frontend]
entry = "src/main.tsx"

[build]
routes = "./src/routes.ts"
bundler_command = "npx vite build"
"#,
		);
		let result = BuildConfig::from_seam_config(&config);
		assert!(result.is_err());
		let msg = result.unwrap_err().to_string();
		assert!(msg.contains("bundlerCommand has been removed"));
	}

	#[test]
	fn build_command_from_frontend_rejected() {
		let config = parse_config(
			r#"
[project]
name = "test"

[frontend]
build_command = "bun run build"
entry = "src/main.tsx"

[build]
routes = "./src/routes.ts"
"#,
		);
		let result = BuildConfig::from_seam_config(&config);
		assert!(result.is_err());
		let msg = result.unwrap_err().to_string();
		assert!(msg.contains("bundlerCommand has been removed"));
	}

	#[test]
	fn no_entry_errors() {
		let config = parse_config(
			r#"
[project]
name = "test"

[build]
routes = "./src/routes.ts"
"#,
		);
		let result = BuildConfig::from_seam_config(&config);
		assert!(result.is_err());
		let msg = result.unwrap_err().to_string();
		assert!(msg.contains("frontend.entry"));
	}

	#[test]
	fn build_config_obfuscate_defaults() {
		let config = parse_fullstack("", "");
		let bc = BuildConfig::from_seam_config(&config).unwrap();
		assert!(bc.obfuscate, "build defaults to obfuscate=true");
		assert!(!bc.sourcemap, "build defaults to sourcemap=false");
		assert!(bc.rpc_salt.is_none());
	}

	#[test]
	fn dev_config_obfuscate_defaults() {
		let config = parse_fullstack("", "");
		let bc = BuildConfig::from_seam_config_dev(&config).unwrap();
		assert!(!bc.obfuscate, "dev defaults to obfuscate=false");
		assert!(bc.sourcemap, "dev defaults to sourcemap=true");
	}

	#[test]
	fn explicit_obfuscate_overrides_defaults() {
		let config = parse_fullstack(
			"obfuscate = false\nsourcemap = true",
			"\n[dev]\nobfuscate = true\nsourcemap = false",
		);
		let bc = BuildConfig::from_seam_config(&config).unwrap();
		assert!(!bc.obfuscate);
		assert!(bc.sourcemap);

		let bc_dev = BuildConfig::from_seam_config_dev(&config).unwrap();
		assert!(bc_dev.obfuscate);
		assert!(!bc_dev.sourcemap);
	}

	#[test]
	fn build_config_type_hint_defaults() {
		let config = parse_fullstack("", "");
		let bc = BuildConfig::from_seam_config(&config).unwrap();
		assert!(bc.type_hint, "build defaults to type_hint=true");

		let bc_dev = BuildConfig::from_seam_config_dev(&config).unwrap();
		assert!(bc_dev.type_hint, "dev defaults to type_hint=true");
	}

	#[test]
	fn explicit_type_hint_overrides() {
		let config = parse_fullstack("type_hint = false", "\n[dev]\ntype_hint = false");
		let bc = BuildConfig::from_seam_config(&config).unwrap();
		assert!(!bc.type_hint);

		let bc_dev = BuildConfig::from_seam_config_dev(&config).unwrap();
		assert!(!bc_dev.type_hint);
	}

	#[test]
	fn build_config_hash_length_defaults() {
		let config = parse_fullstack("", "");
		let bc = BuildConfig::from_seam_config(&config).unwrap();
		assert_eq!(bc.hash_length, 12, "build defaults to hash_length=12");

		let bc_dev = BuildConfig::from_seam_config_dev(&config).unwrap();
		assert_eq!(bc_dev.hash_length, 12, "dev inherits hash_length from build");
	}

	#[test]
	fn explicit_hash_length_overrides() {
		let config = parse_fullstack("hash_length = 20", "\n[dev]\nhash_length = 8");
		let bc = BuildConfig::from_seam_config(&config).unwrap();
		assert_eq!(bc.hash_length, 20);

		let bc_dev = BuildConfig::from_seam_config_dev(&config).unwrap();
		assert_eq!(bc_dev.hash_length, 8);
	}

	#[test]
	fn hash_length_validation() {
		let config = parse_fullstack("hash_length = 3", "");
		let result = BuildConfig::from_seam_config(&config);
		assert!(result.is_err());
		assert!(result.unwrap_err().to_string().contains("hash_length"));

		let config = parse_fullstack("hash_length = 65", "");
		let result = BuildConfig::from_seam_config(&config);
		assert!(result.is_err());
		assert!(result.unwrap_err().to_string().contains("hash_length"));
	}

	#[test]
	fn pages_dir_without_routes() {
		let config = parse_config(
			r#"
[project]
name = "test"

[frontend]
entry = "src/client/main.tsx"

[build]
pages_dir = "src/pages"
out_dir = ".seam/output"
backend_build_command = "bun build"
router_file = "src/server/router.ts"
"#,
		);
		let bc = BuildConfig::from_seam_config(&config).unwrap();
		assert_eq!(bc.routes, ".seam/generated/routes.ts");
		assert_eq!(bc.pages_dir.as_deref(), Some("src/pages"));
	}

	#[test]
	fn pages_dir_with_routes_errors() {
		let config = parse_config(
			r#"
[project]
name = "test"

[frontend]
entry = "src/client/main.tsx"

[build]
routes = "./src/routes.ts"
pages_dir = "src/pages"
out_dir = ".seam/output"
"#,
		);
		let result = BuildConfig::from_seam_config(&config);
		assert!(result.is_err());
		let msg = result.unwrap_err().to_string();
		assert!(msg.contains("mutually exclusive"));
	}

	#[test]
	fn no_routes_no_pages_dir_errors() {
		let config = parse_config(
			r#"
[project]
name = "test"

[frontend]
entry = "src/client/main.tsx"

[build]
out_dir = ".seam/output"
"#,
		);
		let result = BuildConfig::from_seam_config(&config);
		assert!(result.is_err());
		let msg = result.unwrap_err().to_string();
		assert!(msg.contains("build.routes") || msg.contains("build.pages_dir"));
	}

	#[test]
	fn parse_transport_section() {
		let config = parse_config(
			r#"
[project]
name = "test"

[frontend]
entry = "src/client/main.tsx"

[build]
routes = "./src/routes.ts"

[transport]
subscription = { prefer = "ws" }
stream = { prefer = "sse", fallback = ["http"] }
"#,
		);
		let t = config.transport.as_ref().unwrap();
		assert!(t.query.is_none());
		let sub = t.subscription.as_ref().unwrap();
		assert_eq!(sub.prefer, crate::config::TransportPreference::Ws);
		let stream = t.stream.as_ref().unwrap();
		assert_eq!(stream.prefer, crate::config::TransportPreference::Sse);
		assert_eq!(stream.fallback.as_ref().unwrap().len(), 1);
	}

	#[test]
	fn absent_transport_is_none() {
		let config = parse_fullstack("", "");
		assert!(config.transport.is_none());
	}

	#[test]
	fn partial_transport_override() {
		let config = parse_config(
			r#"
[project]
name = "test"

[frontend]
entry = "src/client/main.tsx"

[build]
routes = "./src/routes.ts"

[transport]
channel = { prefer = "ws", fallback = ["http"] }
"#,
		);
		let t = config.transport.as_ref().unwrap();
		assert!(t.query.is_none());
		assert!(t.command.is_none());
		assert!(t.stream.is_none());
		assert!(t.subscription.is_none());
		assert!(t.upload.is_none());
		assert!(t.channel.is_some());
	}

	#[test]
	fn dist_dir_is_constant() {
		let config = parse_fullstack("", "");
		let bc = BuildConfig::from_seam_config(&config).unwrap();
		assert_eq!(bc.dist_dir(), ".seam/dist");
	}
}
