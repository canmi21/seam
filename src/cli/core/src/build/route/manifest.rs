/* src/cli/core/src/build/route/manifest.rs */

use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result, bail};

use super::types::SkeletonOutput;
use crate::config::SeamConfig;
use crate::shell::{run_command, which_exists};
use crate::ui::{self, DIM, GREEN, RESET, col};
use seam_codegen::{Manifest, ProcedureType};

// -- Procedure reference validation --

/// Extract (source, loader_name, procedure_name) tuples from a loaders JSON object.
/// Loaders shape: `{ "loaderKey": { "procedure": "name" } }`
fn collect_loader_procedures(
  loaders: &serde_json::Value,
  source: &str,
) -> Vec<(String, String, String)> {
  let Some(obj) = loaders.as_object() else { return vec![] };
  let mut result = Vec::new();
  for (loader_name, loader_def) in obj {
    if let Some(proc_name) = loader_def.get("procedure").and_then(|v| v.as_str()) {
      result.push((source.to_string(), loader_name.clone(), proc_name.to_string()));
    }
  }
  result
}

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

/// Validate that all procedure references in routes/layouts exist in the manifest.
/// Collects all errors and reports them together.
pub(crate) fn validate_procedure_references(
  manifest: &Manifest,
  skeleton_output: &SkeletonOutput,
) -> Result<()> {
  let mut refs = Vec::new();
  for route in &skeleton_output.routes {
    refs.extend(collect_loader_procedures(&route.loaders, &format!("Route \"{}\"", route.path)));
  }
  for layout in &skeleton_output.layouts {
    refs.extend(collect_loader_procedures(&layout.loaders, &format!("Layout \"{}\"", layout.id)));
  }

  let available: Vec<&str> = manifest.procedures.keys().map(std::string::String::as_str).collect();
  let mut errors = Vec::new();

  for (source, loader_name, proc_name) in &refs {
    if manifest.procedures.contains_key(proc_name.as_str()) {
      continue;
    }
    let mut block = format!(
      "  {source} loader \"{loader_name}\" references procedure \"{proc_name}\",\n  \
       but no procedure with that name is registered.\n\n  \
       Available procedures: {}",
      available.join(", ")
    );
    if let Some(suggestion) = did_you_mean(proc_name, &available) {
      block.push_str(&format!("\n\n  Did you mean: {suggestion}?"));
    }
    errors.push(block);
  }

  if errors.is_empty() {
    return Ok(());
  }

  bail!("unknown procedure reference\n\n{}", errors.join("\n\n"));
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

/// Collect (loader_key, procedure_name, is_handoff) tuples from a loaders JSON object.
fn collect_loader_handoff_info(loaders: &serde_json::Value) -> Vec<(String, String, bool)> {
  let Some(obj) = loaders.as_object() else { return vec![] };
  let mut result = Vec::new();
  for (loader_name, loader_def) in obj {
    if let Some(proc_name) = loader_def.get("procedure").and_then(|v| v.as_str()) {
      let is_handoff = loader_def.get("handoff").and_then(|v| v.as_str()) == Some("client");
      result.push((loader_name.clone(), proc_name.to_string(), is_handoff));
    }
  }
  result
}

/// Warn when the same procedure appears in both handoff and non-handoff loaders
/// within the same page (including its layout chain).
pub(crate) fn validate_handoff_consistency(skeleton_output: &SkeletonOutput) {
  for route in &skeleton_output.routes {
    // Collect loader info from the route itself
    let mut all_loaders = collect_loader_handoff_info(&route.loaders);

    // Walk the layout chain for this route
    if let Some(layout_id) = &route.layout {
      let mut current_id = Some(layout_id.as_str());
      while let Some(id) = current_id {
        if let Some(layout) = skeleton_output.layouts.iter().find(|l| l.id == id) {
          all_loaders.extend(collect_loader_handoff_info(&layout.loaders));
          current_id = layout.parent.as_deref();
        } else {
          break;
        }
      }
    }

    // Group by procedure name, check for handoff/non-handoff mix
    let mut handoff_keys: Vec<&str> = Vec::new();
    let mut non_handoff_keys: Vec<&str> = Vec::new();

    for (key, proc_name, is_handoff) in &all_loaders {
      // Only check procedures that appear in both modes
      let has_other_mode = all_loaders.iter().any(|(_, p, h)| p == proc_name && *h != *is_handoff);
      if has_other_mode {
        if *is_handoff {
          handoff_keys.push(key);
        } else {
          non_handoff_keys.push(key);
        }
      }
    }

    if !handoff_keys.is_empty() && !non_handoff_keys.is_empty() {
      ui::warn(&format!(
        "Route \"{}\" has loaders {} (handoff) and {} sharing the same procedure. \
         These share the same data source but have different update mechanisms after hydration.",
        route.path,
        handoff_keys.iter().map(|k| format!("\"{k}\"")).collect::<Vec<_>>().join(", "),
        non_handoff_keys.iter().map(|k| format!("\"{k}\"")).collect::<Vec<_>>().join(", "),
      ));
    }
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

/// Generate TypeScript client types from the manifest
pub(crate) fn generate_types(
  manifest: &Manifest,
  config: &SeamConfig,
  rpc_hashes: Option<&seam_codegen::RpcHashMap>,
) -> Result<()> {
  let out_dir_str = config.generate.out_dir.as_deref().unwrap_or("src/generated");

  let code = seam_codegen::generate_typescript(manifest, rpc_hashes, &config.frontend.data_id)?;
  let line_count = code.lines().count();
  let proc_count = manifest.procedures.len();

  let out_path = Path::new(out_dir_str);
  std::fs::create_dir_all(out_path)
    .with_context(|| format!("failed to create {}", out_path.display()))?;
  let file = out_path.join("client.ts");
  std::fs::write(&file, &code).with_context(|| format!("failed to write {}", file.display()))?;

  let meta_code = seam_codegen::generate_typescript_meta(&config.frontend.data_id);
  let meta_file = out_path.join("meta.ts");
  std::fs::write(&meta_file, &meta_code)
    .with_context(|| format!("failed to write {}", meta_file.display()))?;

  ui::detail_ok(&format!(
    "{proc_count} procedures \u{2192} {} ({line_count} lines)",
    file.display()
  ));
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
