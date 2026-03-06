/* src/cli/core/src/build/route/manifest.rs */

use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result, bail};

use crate::config::SeamConfig;
use crate::shell::{run_command, which_exists};
use crate::ui::{self, DIM, GREEN, RESET, col};
use seam_codegen::{Manifest, ProcedureType};

pub(super) fn levenshtein(a: &str, b: &str) -> usize {
	let n = b.len();
	let mut prev: Vec<usize> = (0..=n).collect();
	let mut curr = vec![0; n + 1];
	for (i, ca) in a.chars().enumerate() {
		curr[0] = i + 1;
		for (j, cb) in b.chars().enumerate() {
			let cost = if ca == cb { 0 } else { 1 };
			curr[j + 1] = (prev[j] + cost).min(prev[j + 1] + 1).min(curr[j] + 1);
		}
		std::mem::swap(&mut prev, &mut curr);
	}
	prev[n]
}

pub(super) fn did_you_mean<'a>(name: &str, candidates: &[&'a str]) -> Option<&'a str> {
	candidates
		.iter()
		.map(|c| (*c, levenshtein(name, c)))
		.filter(|(_, d)| *d <= 3 && *d > 0)
		.min_by_key(|(_, d)| *d)
		.map(|(c, _)| c)
}

/// Extract top-level field names from a JTD schema Value.
pub(super) fn extract_jtd_fields(schema: &serde_json::Value) -> std::collections::BTreeSet<&str> {
	let mut fields = std::collections::BTreeSet::new();
	if let Some(props) = schema.get("properties").and_then(serde_json::Value::as_object) {
		fields.extend(props.keys().map(String::as_str));
	}
	if let Some(opt_props) = schema.get("optionalProperties").and_then(serde_json::Value::as_object) {
		fields.extend(opt_props.keys().map(String::as_str));
	}
	fields
}

/// Validate invalidates declarations in commands.
/// Errors: referenced procedure missing, referenced procedure not a query.
/// Warnings: mapping key not in target query input, mapping.from not in command input.
pub(crate) fn validate_invalidates(manifest: &Manifest) -> Result<()> {
	let available: Vec<&str> = manifest.procedures.keys().map(String::as_str).collect();
	let mut errors = Vec::new();

	for (cmd_name, cmd) in &manifest.procedures {
		let Some(targets) = &cmd.invalidates else { continue };
		for target in targets {
			// Check referenced procedure exists
			let Some(target_proc) = manifest.procedures.get(&target.query) else {
				let mut msg = format!(
					"  Command \"{cmd_name}\" invalidates \"{}\", but no procedure with that name exists.",
					target.query
				);
				if let Some(suggestion) = did_you_mean(&target.query, &available) {
					msg.push_str(&format!("\n\n  Did you mean: {suggestion}?"));
				}
				errors.push(msg);
				continue;
			};
			// Check it's a query
			if target_proc.proc_type != ProcedureType::Query {
				errors.push(format!(
					"  Command \"{cmd_name}\" invalidates \"{}\", but it is a {} (expected query).",
					target.query, target_proc.proc_type
				));
				continue;
			}
			// Warn on mapping field mismatches (non-blocking)
			if let Some(mapping) = &target.mapping {
				let target_fields = extract_jtd_fields(&target_proc.input);
				let cmd_fields = extract_jtd_fields(&cmd.input);
				for (key, val) in mapping {
					if !target_fields.is_empty() && !target_fields.contains(key.as_str()) {
						ui::warn(&format!(
							"Command \"{cmd_name}\": invalidates mapping key \"{key}\" not found in \"{}\".input",
							target.query
						));
					}
					if !cmd_fields.is_empty() && !cmd_fields.contains(val.from.as_str()) {
						ui::warn(&format!(
							"Command \"{cmd_name}\": invalidates mapping from \"{}\".input field \"{}\" not found",
							cmd_name, val.from
						));
					}
				}
			}
		}
	}

	if errors.is_empty() {
		Ok(())
	} else {
		bail!("invalid invalidates declaration\n\n{}", errors.join("\n\n"));
	}
}

/// Print procedure breakdown (reused from pull.rs logic)
pub(crate) fn print_procedure_breakdown(manifest: &Manifest) {
	let total = manifest.procedures.len();
	let mut queries = 0u32;
	let mut commands = 0u32;
	let mut subscriptions = 0u32;
	let mut streams = 0u32;
	let mut uploads = 0u32;
	for proc in manifest.procedures.values() {
		match proc.proc_type {
			ProcedureType::Query => queries += 1,
			ProcedureType::Command => commands += 1,
			ProcedureType::Subscription => subscriptions += 1,
			ProcedureType::Stream => streams += 1,
			ProcedureType::Upload => uploads += 1,
		}
	}
	let mut parts = Vec::new();
	if queries > 0 {
		parts.push(format!("{queries} {}", if queries == 1 { "query" } else { "queries" }));
	}
	if commands > 0 {
		parts.push(format!("{commands} {}", if commands == 1 { "command" } else { "commands" }));
	}
	if subscriptions > 0 {
		parts.push(format!(
			"{subscriptions} {}",
			if subscriptions == 1 { "subscription" } else { "subscriptions" }
		));
	}
	if streams > 0 {
		parts.push(format!("{streams} {}", if streams == 1 { "stream" } else { "streams" }));
	}
	if uploads > 0 {
		parts.push(format!("{uploads} {}", if uploads == 1 { "upload" } else { "uploads" }));
	}
	let breakdown =
		if parts.is_empty() { String::new() } else { format!(" \u{2014} {}", parts.join(", ")) };
	ui::detail_ok(&format!("{total} procedures{breakdown}"));
}

/// Run a shell command that prints Manifest JSON to stdout.
/// Used for Rust/Go backends that can't be imported via bun -e.
pub(crate) fn extract_manifest_command(
	base_dir: &Path,
	command: &str,
	out_dir: &Path,
) -> Result<Manifest> {
	let spinner = ui::spinner(command);

	let output = Command::new("sh")
		.args(["-c", command])
		.current_dir(base_dir)
		.output()
		.with_context(|| format!("failed to run manifest command: {command}"))?;

	if !output.status.success() {
		spinner.finish_with("failed");
		let stderr = String::from_utf8_lossy(&output.stderr);
		bail!("manifest command failed:\n{stderr}");
	}
	spinner.finish();

	let stdout = String::from_utf8(output.stdout).context("invalid UTF-8 from manifest command")?;
	let manifest: Manifest =
		serde_json::from_str(&stdout).context("failed to parse manifest JSON from command output")?;

	// Write seam-manifest.json
	std::fs::create_dir_all(out_dir)
		.with_context(|| format!("failed to create {}", out_dir.display()))?;
	let manifest_path = out_dir.join("seam-manifest.json");
	let json = serde_json::to_string_pretty(&manifest)?;
	std::fs::write(&manifest_path, &json)
		.with_context(|| format!("failed to write {}", manifest_path.display()))?;
	ui::detail_ok(&format!("{}seam-manifest.json{}", col(DIM), col(RESET)));

	Ok(manifest)
}

/// Extract procedure manifest by importing the router file at build time
pub(crate) fn extract_manifest(
	base_dir: &Path,
	router_file: &str,
	out_dir: &Path,
) -> Result<Manifest> {
	// Prefer bun (handles .ts natively), fall back to node
	let runtime = if which_exists("bun") { "bun" } else { "node" };

	let script = format!(
		"import('./{router_file}').then(m => {{ \
       const r = m.router || m.default; \
       console.log(JSON.stringify(r.manifest())); \
     }})"
	);

	let spinner = ui::spinner(&format!("{runtime} -e \"import('{router_file}')...\""));

	let output = Command::new(runtime)
		.args(["-e", &script])
		.current_dir(base_dir)
		.output()
		.with_context(|| format!("failed to run {runtime} for manifest extraction"))?;

	if !output.status.success() {
		spinner.finish_with("failed");
		let stderr = String::from_utf8_lossy(&output.stderr);
		bail!("manifest extraction failed:\n{stderr}");
	}
	spinner.finish();

	let stdout = String::from_utf8(output.stdout).context("invalid UTF-8 from manifest output")?;
	let manifest: Manifest =
		serde_json::from_str(&stdout).context("failed to parse manifest JSON")?;

	// Write seam-manifest.json
	std::fs::create_dir_all(out_dir)
		.with_context(|| format!("failed to create {}", out_dir.display()))?;
	let manifest_path = out_dir.join("seam-manifest.json");
	let json = serde_json::to_string_pretty(&manifest)?;
	std::fs::write(&manifest_path, &json)
		.with_context(|| format!("failed to write {}", manifest_path.display()))?;
	ui::detail_ok(&format!("{}seam-manifest.json{}", col(DIM), col(RESET)));

	Ok(manifest)
}

/// Convert a config TransportPreference to codegen TransportPreference.
fn to_codegen_preference(
	p: &crate::config::TransportPreference,
) -> seam_codegen::TransportPreference {
	match p {
		crate::config::TransportPreference::Http => seam_codegen::TransportPreference::Http,
		crate::config::TransportPreference::Sse => seam_codegen::TransportPreference::Sse,
		crate::config::TransportPreference::Ws => seam_codegen::TransportPreference::Ws,
		crate::config::TransportPreference::Ipc => seam_codegen::TransportPreference::Ipc,
	}
}

/// Convert a config TransportConfig to codegen TransportConfig.
fn to_codegen_transport(tc: &crate::config::TransportConfig) -> seam_codegen::TransportConfig {
	seam_codegen::TransportConfig {
		prefer: to_codegen_preference(&tc.prefer),
		fallback: tc.fallback.as_ref().map(|v| v.iter().map(to_codegen_preference).collect::<Vec<_>>()),
	}
}

/// Merge config [transport] section into manifest transport_defaults.
/// Config values override server-declared defaults.
fn merge_transport_defaults(
	defaults: &mut std::collections::BTreeMap<String, seam_codegen::TransportConfig>,
	section: &crate::config::TransportSection,
) {
	let pairs: &[(&str, &Option<crate::config::TransportConfig>)] = &[
		("query", &section.query),
		("command", &section.command),
		("stream", &section.stream),
		("subscription", &section.subscription),
		("upload", &section.upload),
		("channel", &section.channel),
	];
	for (kind, opt) in pairs {
		if let Some(tc) = opt {
			defaults.insert((*kind).to_string(), to_codegen_transport(tc));
		}
	}
}

/// Fill built-in defaults for any procedure kind not yet declared.
fn fill_builtin_transport_defaults(
	defaults: &mut std::collections::BTreeMap<String, seam_codegen::TransportConfig>,
) {
	use seam_codegen::TransportPreference::{Http, Sse, Ws};

	let builtins: &[(
		&str,
		seam_codegen::TransportPreference,
		Option<Vec<seam_codegen::TransportPreference>>,
	)] = &[
		("query", Http, None),
		("command", Http, None),
		("stream", Sse, Some(vec![Http])),
		("subscription", Sse, Some(vec![Http])),
		("upload", Http, None),
		("channel", Ws, Some(vec![Http])),
	];
	for (kind, prefer, fallback) in builtins {
		defaults.entry((*kind).to_string()).or_insert_with(|| seam_codegen::TransportConfig {
			prefer: *prefer,
			fallback: fallback.clone(),
		});
	}
}

/// Generate TypeScript client types from the manifest.
/// Always writes to `.seam/generated/`; also writes to `config.generate.out_dir` when set.
pub(crate) fn generate_types(
	manifest: &Manifest,
	config: &SeamConfig,
	rpc_hashes: Option<&seam_codegen::RpcHashMap>,
	base_dir: &Path,
) -> Result<()> {
	// Merge transport: config overrides server defaults, then fill built-in defaults
	let mut manifest = manifest.clone();
	if let Some(ref section) = config.transport {
		merge_transport_defaults(&mut manifest.transport_defaults, section);
	}
	fill_builtin_transport_defaults(&mut manifest.transport_defaults);

	let code = seam_codegen::generate_typescript(&manifest, rpc_hashes, &config.frontend.data_id)?;
	let line_count = code.lines().count();
	let proc_count = manifest.procedures.len();

	// Primary: always write to .seam/generated/
	let seam_dir = base_dir.join(".seam/generated");
	std::fs::create_dir_all(&seam_dir)
		.with_context(|| format!("failed to create {}", seam_dir.display()))?;
	let primary_file = seam_dir.join("client.ts");
	std::fs::write(&primary_file, &code)
		.with_context(|| format!("failed to write {}", primary_file.display()))?;
	std::fs::write(seam_dir.join("seam.d.ts"), seam_codegen::generate_type_declarations())
		.with_context(|| "failed to write .seam/generated/seam.d.ts")?;

	// Secondary: if user explicitly configured outDir, also write client.ts there
	if let Some(ref user_dir) = config.generate.out_dir {
		let out = base_dir.join(user_dir);
		std::fs::create_dir_all(&out).with_context(|| format!("failed to create {}", out.display()))?;
		let file = out.join("client.ts");
		std::fs::write(&file, &code).with_context(|| format!("failed to write {}", file.display()))?;
	}

	let display_path = match config.generate.out_dir.as_deref() {
		Some(dir) => format!("{dir}/client.ts"),
		None => ".seam/generated/client.ts".to_string(),
	};
	ui::detail_ok(&format!("{proc_count} procedures \u{2192} {display_path} ({line_count} lines)",));
	Ok(())
}

/// Run type checking (optional step)
pub(crate) fn run_typecheck(base_dir: &Path, command: &str) -> Result<()> {
	run_command(base_dir, command, "type checker", &[])?;
	ui::detail_ok(&format!("{}passed{}", col(GREEN), col(RESET)));
	Ok(())
}

/// Copy frontend assets from the bundler output directory to {out_dir}/public/
/// `dist_dir` is the directory containing bundler output (e.g. ".seam/dist" or "frontend/.seam/dist").
pub(crate) fn package_static_assets(
	base_dir: &Path,
	assets: &super::super::types::AssetFiles,
	out_dir: &Path,
	dist_dir: &str,
) -> Result<()> {
	let public_dir = out_dir.join("public");

	let all_files: Vec<&str> =
		assets.js.iter().chain(assets.css.iter()).map(std::string::String::as_str).collect();

	for file in all_files {
		let src = base_dir.join(dist_dir).join(file);
		let dst = public_dir.join(file);

		if let Some(parent) = dst.parent() {
			std::fs::create_dir_all(parent)
				.with_context(|| format!("failed to create {}", parent.display()))?;
		}

		std::fs::copy(&src, &dst)
			.with_context(|| format!("failed to copy {} -> {}", src.display(), dst.display()))?;

		let size = std::fs::metadata(&dst).map(|m| m.len()).unwrap_or(0);
		ui::detail_ok(&format!("{}public/{file}  ({}){}", col(DIM), ui::format_size(size), col(RESET)));
	}

	Ok(())
}
