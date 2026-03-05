/* src/cli/core/src/build/route/process/skeleton.rs */

use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result, bail};

use super::super::types::SkeletonOutput;
use crate::config::I18nSection;
use crate::shell::which_exists;

pub(crate) fn run_skeleton_renderer(
	script_path: &Path,
	routes_path: &Path,
	manifest_path: &Path,
	base_dir: &Path,
	i18n: Option<&I18nSection>,
) -> Result<SkeletonOutput> {
	let runtime = if which_exists("bun") { "bun" } else { "node" };

	// Build i18n JSON argument: read locale message files and serialize as a single blob
	let i18n_arg = match i18n {
		Some(cfg) => {
			let mut messages = serde_json::Map::new();
			for locale in &cfg.locales {
				let path = base_dir.join(&cfg.messages_dir).join(format!("{locale}.json"));
				let content = std::fs::read_to_string(&path)
					.with_context(|| format!("i18n: failed to read {}", path.display()))?;
				let parsed: serde_json::Value = serde_json::from_str(&content)
					.with_context(|| format!("i18n: invalid JSON in {}", path.display()))?;
				messages.insert(locale.clone(), parsed);
			}
			serde_json::to_string(&serde_json::json!({
				"locales": cfg.locales,
				"default": cfg.default,
				"messages": messages,
			}))?
		}
		None => "none".to_string(),
	};

	let output = Command::new(runtime)
		.arg(script_path)
		.arg(routes_path)
		.arg(manifest_path)
		.arg(&i18n_arg)
		.current_dir(base_dir)
		.output()
		.with_context(|| format!("failed to spawn {runtime} for skeleton rendering"))?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		bail!("skeleton rendering failed:\n{stderr}");
	}

	let stdout = String::from_utf8(output.stdout).context("invalid UTF-8 from skeleton renderer")?;
	serde_json::from_str(&stdout).context("failed to parse skeleton output JSON")
}
