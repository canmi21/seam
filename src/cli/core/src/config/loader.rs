/* src/cli/core/src/config/loader.rs */

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail};

use super::SeamConfig;
use crate::shell::which_exists;
use crate::ui;

/// Config file names in priority order.
const CONFIG_FILES: [&str; 3] = ["seam.config.ts", "seam.config.mjs", "seam.toml"];

/// Check a single directory for config files in priority order.
pub(crate) fn find_config_in_dir(dir: &Path) -> Option<PathBuf> {
	for name in CONFIG_FILES {
		let candidate = dir.join(name);
		if candidate.is_file() {
			return Some(candidate);
		}
	}
	None
}

/// Walk upward from `start` to find a config file, like Cargo.toml discovery.
pub fn find_seam_config(start: &Path) -> Result<PathBuf> {
	let mut dir =
		start.canonicalize().with_context(|| format!("failed to canonicalize {}", start.display()))?;
	loop {
		if let Some(path) = find_config_in_dir(&dir) {
			return Ok(path);
		}
		if !dir.pop() {
			bail!(
				"no config file found (searched for {} upward from {})",
				CONFIG_FILES.join(", "),
				start.display()
			);
		}
	}
}

/// Load and parse a config file, dispatching by extension.
pub fn load_seam_config(path: &Path) -> Result<SeamConfig> {
	let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
	match ext {
		"toml" => {
			ui::detail(&format!(
				"{}using legacy seam.toml -- consider migrating to seam.config.ts{}",
				ui::col(ui::DIM),
				ui::col(ui::RESET)
			));
			load_toml_config(path)
		}
		"ts" | "mjs" => load_ts_config(path),
		_ => bail!("unsupported config file extension: {}", path.display()),
	}
}

fn load_toml_config(path: &Path) -> Result<SeamConfig> {
	let content =
		std::fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
	let config: SeamConfig =
		toml::from_str(&content).with_context(|| format!("failed to parse {}", path.display()))?;
	if let Some(ref i18n) = config.i18n {
		i18n.validate()?;
	}
	Ok(config)
}

fn load_ts_config(path: &Path) -> Result<SeamConfig> {
	let base_dir = path.parent().unwrap_or_else(|| Path::new("."));
	let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("seam.config.ts");

	let runtime = if which_exists("bun") { "bun" } else { "node" };

	let script = format!("import('./{file_name}').then(m => console.log(JSON.stringify(m.default)))");

	let mut args: Vec<&str> = vec![];
	// Node needs --experimental-strip-types for .ts files
	if runtime == "node" && path.extension().and_then(|e| e.to_str()) == Some("ts") {
		args.push("--experimental-strip-types");
	}
	args.extend(["-e", &script]);

	let output = Command::new(runtime)
		.args(&args)
		.current_dir(base_dir)
		.output()
		.with_context(|| format!("failed to run {runtime} to evaluate {file_name}"))?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		bail!("failed to evaluate {file_name}:\n{stderr}");
	}

	let stdout = String::from_utf8(output.stdout).context("invalid UTF-8 from config evaluation")?;

	let raw: serde_json::Value =
		serde_json::from_str(stdout.trim()).context("failed to parse config JSON output")?;

	let transformed = prepare_ts_config(raw);

	let config: SeamConfig = serde_json::from_value(transformed)
		.with_context(|| format!("failed to deserialize config from {file_name}"))?;

	if let Some(ref i18n) = config.i18n {
		i18n.validate()?;
	}
	Ok(config)
}

/// Transform camelCase keys to snake_case, preserving `vite` and `router`
/// fields which contain user config with their own key conventions.
pub(super) fn prepare_ts_config(mut raw: serde_json::Value) -> serde_json::Value {
	// Extract passthrough fields before transformation
	let vite = raw.get("vite").cloned();
	let router = raw.get("router").cloned();

	if let Some(obj) = raw.as_object_mut() {
		obj.remove("vite");
		obj.remove("router");
	}

	let mut result = camel_to_snake_keys(raw);

	// Restore passthrough fields with original keys
	if let Some(v) = vite {
		result["vite"] = v;
	}
	if let Some(r) = router {
		result["router"] = r;
	}

	result
}

/// Recursively transform all object keys from camelCase to snake_case.
fn camel_to_snake_keys(value: serde_json::Value) -> serde_json::Value {
	match value {
		serde_json::Value::Object(map) => {
			let mut new_map = serde_json::Map::new();
			for (key, val) in map {
				let snake_key = camel_to_snake(&key);
				new_map.insert(snake_key, camel_to_snake_keys(val));
			}
			serde_json::Value::Object(new_map)
		}
		serde_json::Value::Array(arr) => {
			serde_json::Value::Array(arr.into_iter().map(camel_to_snake_keys).collect())
		}
		other => other,
	}
}

/// Convert a single camelCase string to snake_case.
fn camel_to_snake(s: &str) -> String {
	let mut result = String::with_capacity(s.len() + 4);
	for (i, ch) in s.chars().enumerate() {
		if ch.is_uppercase() {
			if i > 0 {
				result.push('_');
			}
			result.push(ch.to_lowercase().next().unwrap_or(ch));
		} else {
			result.push(ch);
		}
	}
	result
}

/// Load and merge root + member config.
/// Member overrides: [backend], [build].{backend_build_command, router_file, manifest_command, out_dir}
/// Root provides: [project], [frontend], [build] (shared fields), [i18n], [dev], [generate]
pub fn resolve_member_config(root: &SeamConfig, member_dir: &Path) -> Result<SeamConfig> {
	let member_config_path = find_config_in_dir(member_dir)
		.with_context(|| format!("no config file found in {}", member_dir.display()))?;
	let member = load_seam_config(&member_config_path)?;

	let mut merged = root.clone();

	// Backend entirely from member
	merged.backend = member.backend;

	// Build: member overrides backend-specific fields only
	if member.build.backend_build_command.is_some() {
		merged.build.backend_build_command = member.build.backend_build_command;
	}
	if member.build.router_file.is_some() {
		merged.build.router_file = member.build.router_file;
	}
	if member.build.manifest_command.is_some() {
		merged.build.manifest_command = member.build.manifest_command;
	}
	if member.build.out_dir.is_some() {
		merged.build.out_dir = member.build.out_dir;
	}

	// Clean section from member (not merged with root)
	merged.clean = member.clean;

	// Strip workspace section from merged config (members are not workspaces)
	merged.workspace = None;

	Ok(merged)
}

/// Validate workspace: member dirs exist, contain a config file, no duplicates,
/// each member has either router_file or manifest_command.
pub fn validate_workspace(config: &SeamConfig, base_dir: &Path) -> Result<()> {
	let members = config.member_paths();
	if members.is_empty() {
		bail!("workspace.members must not be empty");
	}

	let mut seen_names = std::collections::HashSet::new();
	for member_path in members {
		let dir = base_dir.join(member_path);
		if !dir.is_dir() {
			bail!("workspace member directory not found: {}", dir.display());
		}
		if find_config_in_dir(&dir).is_none() {
			bail!("workspace member missing config file: {}", dir.display());
		}

		// Extract basename for duplicate check
		let name = Path::new(member_path).file_name().and_then(|n| n.to_str()).unwrap_or(member_path);
		if !seen_names.insert(name.to_string()) {
			bail!("duplicate workspace member name: {name}");
		}

		// Load and check manifest extraction method
		let member_config = resolve_member_config(config, &dir)?;
		if member_config.build.router_file.is_none() && member_config.build.manifest_command.is_none() {
			bail!(
				"workspace member \"{member_path}\" must have either build.router_file or build.manifest_command"
			);
		}
	}

	Ok(())
}
