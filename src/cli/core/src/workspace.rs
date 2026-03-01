/* src/cli/core/src/workspace.rs */

// Workspace build orchestrator: resolves members, builds frontend once,
// validates manifest compatibility across backends, packages per-member output.

use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result, bail};

use crate::build::config::BuildConfig;
use crate::build::route::{
  extract_manifest, extract_manifest_command, generate_types, package_static_assets,
  print_asset_files, print_procedure_breakdown, process_routes, run_skeleton_renderer,
  run_typecheck, validate_procedure_references,
};
use crate::build::types::read_bundle_manifest;
use crate::config::{SeamConfig, resolve_member_config, validate_workspace};
use crate::manifest::Manifest;
use crate::shell::{resolve_node_module, run_command};
use crate::ui::{self, DIM, GREEN, RESET, YELLOW};

#[derive(Debug)]
pub struct ResolvedMember {
  pub name: String,
  pub member_dir: PathBuf,
  pub merged_config: SeamConfig,
  pub build_config: BuildConfig,
}

pub fn resolve_members(
  root: &SeamConfig,
  base_dir: &Path,
  filter: Option<&str>,
) -> Result<Vec<ResolvedMember>> {
  validate_workspace(root, base_dir)?;

  let mut members = Vec::new();
  for member_path in root.member_paths() {
    let dir = base_dir.join(member_path);
    let name = Path::new(member_path)
      .file_name()
      .and_then(|n| n.to_str())
      .unwrap_or(member_path)
      .to_string();

    if let Some(f) = filter
      && name != f
    {
      continue;
    }

    let merged = resolve_member_config(root, &dir)?;
    let build_config = BuildConfig::from_seam_config(&merged)?;

    members.push(ResolvedMember { name, member_dir: dir, merged_config: merged, build_config });
  }

  if let Some(f) = filter
    && members.is_empty()
  {
    let available: Vec<_> = root
      .member_paths()
      .iter()
      .filter_map(|p| Path::new(p).file_name().and_then(|n| n.to_str()))
      .collect();
    bail!("unknown member \"{f}\"\navailable members: {}", available.join(", "));
  }

  Ok(members)
}

/// Validate that two manifests are compatible: same procedure names, types, and schemas.
fn validate_manifest_compatibility(
  reference: &Manifest,
  ref_name: &str,
  candidate: &Manifest,
  cand_name: &str,
) -> Result<()> {
  let mut errors = Vec::new();

  // Check all reference procedures exist in candidate
  for name in reference.procedures.keys() {
    if !candidate.procedures.contains_key(name) {
      errors.push(format!("procedure \"{name}\" exists in {ref_name} but not in {cand_name}"));
    }
  }

  // Check all candidate procedures exist in reference
  for name in candidate.procedures.keys() {
    if !reference.procedures.contains_key(name) {
      errors.push(format!("procedure \"{name}\" exists in {cand_name} but not in {ref_name}"));
    }
  }

  // Check matching procedures have compatible type (query/mutation/subscription).
  // Schema comparison is intentionally omitted: different SDK implementations
  // represent nullable/optional fields differently in JTD (properties vs optionalProperties).
  // The reference member's schema is authoritative for client codegen.
  for (name, ref_proc) in &reference.procedures {
    if let Some(cand_proc) = candidate.procedures.get(name)
      && ref_proc.proc_type != cand_proc.proc_type
    {
      errors.push(format!(
        "procedure \"{name}\" type mismatch: {ref_name}=\"{}\" vs {cand_name}=\"{}\"",
        ref_proc.proc_type, cand_proc.proc_type
      ));
    }
  }

  if errors.is_empty() {
    Ok(())
  } else {
    bail!(
      "manifest incompatibility between {ref_name} and {cand_name}:\n  {}",
      errors.join("\n  ")
    );
  }
}

fn extract_member_manifest(
  build_config: &BuildConfig,
  member_dir: &Path,
  out_dir: &Path,
) -> Result<Manifest> {
  if let Some(cmd) = &build_config.manifest_command {
    extract_manifest_command(member_dir, cmd, out_dir)
  } else {
    let router_file = build_config
      .router_file
      .as_deref()
      .context("either router_file or manifest_command is required")?;
    extract_manifest(member_dir, router_file, out_dir)
  }
}

/// Run workspace build: build frontend once, then compile + validate each backend member.
#[allow(clippy::too_many_lines)]
pub fn run_workspace_build(root: &SeamConfig, base_dir: &Path, filter: Option<&str>) -> Result<()> {
  let started = Instant::now();
  let members = resolve_members(root, base_dir, filter)?;

  let member_count = members.len();
  let total_label =
    if member_count == 1 { "1 member".to_string() } else { format!("{member_count} members") };
  ui::banner("workspace build", Some(&format!("{} — {total_label}", root.project.name)));

  // Use first member as the reference for shared frontend steps
  let first = &members[0];
  let shared_out_dir = base_dir.join(&first.build_config.out_dir);

  // -- Phase 1: First member full build --
  ui::step(1, 2, &format!("Building reference member: {}", first.name));
  println!();

  // [1.1] Compile backend
  ui::detail(&format!("{DIM}[{}/backend]{RESET} compiling...", first.name));
  if let Some(cmd) = &first.build_config.backend_build_command {
    run_command(&first.member_dir, cmd, "backend build", &[])?;
  }

  // [1.2] Extract manifest
  ui::detail(&format!("{DIM}[{}/manifest]{RESET} extracting...", first.name));
  let reference_manifest =
    extract_member_manifest(&first.build_config, &first.member_dir, &shared_out_dir)?;
  print_procedure_breakdown(&reference_manifest);

  let rpc_hashes = super::build::run::maybe_generate_rpc_hashes_pub(
    &first.build_config,
    &reference_manifest,
    &shared_out_dir,
  )?;

  // [1.3] Generate client types (shared)
  ui::detail(&format!("{DIM}[shared]{RESET} generating client types"));
  generate_types(&reference_manifest, &first.merged_config, rpc_hashes.as_ref())?;

  // [1.4] Bundle frontend (shared)
  ui::detail(&format!("{DIM}[shared]{RESET} bundling frontend"));
  let hash_length_str = first.build_config.hash_length.to_string();
  let rpc_map_path_str = if rpc_hashes.is_some() {
    shared_out_dir.join("rpc-hash-map.json").to_string_lossy().to_string()
  } else {
    String::new()
  };
  let dist_dir_str = first.build_config.dist_dir().to_string();
  let bundler_env: Vec<(&str, &str)> = vec![
    ("SEAM_OBFUSCATE", if first.build_config.obfuscate { "1" } else { "0" }),
    ("SEAM_SOURCEMAP", if first.build_config.sourcemap { "1" } else { "0" }),
    ("SEAM_TYPE_HINT", if first.build_config.type_hint { "1" } else { "0" }),
    ("SEAM_HASH_LENGTH", &hash_length_str),
    ("SEAM_RPC_MAP_PATH", &rpc_map_path_str),
    ("SEAM_DIST_DIR", &dist_dir_str),
  ];
  match &first.build_config.bundler_mode {
    crate::build::config::BundlerMode::BuiltIn { entry } => {
      crate::shell::run_builtin_bundler(base_dir, entry, &dist_dir_str, &bundler_env)?;
    }
    crate::build::config::BundlerMode::Custom { command } => {
      run_command(base_dir, command, "bundler", &bundler_env)?;
    }
  }
  let manifest_path = base_dir.join(&first.build_config.bundler_manifest);
  let assets = read_bundle_manifest(&manifest_path)?;
  print_asset_files(base_dir, first.build_config.dist_dir(), &assets);

  // [1.5] Type check (optional)
  if let Some(cmd) = &first.build_config.typecheck_command {
    ui::detail(&format!("{DIM}[shared]{RESET} type checking"));
    run_typecheck(base_dir, cmd)?;
  }

  // [1.6] Generate skeletons (shared)
  ui::detail(&format!("{DIM}[shared]{RESET} generating skeletons"));
  let script_path = resolve_node_module(base_dir, "@canmi/seam-react/scripts/build-skeletons.mjs")
    .ok_or_else(|| anyhow::anyhow!("build-skeletons.mjs not found -- install @canmi/seam-react"))?;
  let routes_path = base_dir.join(&first.build_config.routes);
  let manifest_json_path = shared_out_dir.join("seam-manifest.json");
  let skeleton_output = run_skeleton_renderer(
    &script_path,
    &routes_path,
    &manifest_json_path,
    base_dir,
    first.build_config.i18n.as_ref(),
  )?;
  for w in &skeleton_output.warnings {
    ui::detail(&format!("{YELLOW}warning{RESET}: {w}"));
  }
  validate_procedure_references(&reference_manifest, &skeleton_output)?;

  let templates_dir = shared_out_dir.join("templates");
  std::fs::create_dir_all(&templates_dir)
    .with_context(|| format!("failed to create {}", templates_dir.display()))?;
  let route_manifest = process_routes(
    &skeleton_output.layouts,
    &skeleton_output.routes,
    &templates_dir,
    &assets,
    false,
    None,
    &first.build_config.root_id,
    &first.build_config.data_id,
    first.build_config.i18n.as_ref(),
  )?;

  // Write route-manifest.json
  let route_manifest_path = shared_out_dir.join("route-manifest.json");
  let route_manifest_json = serde_json::to_string_pretty(&route_manifest)?;
  std::fs::write(&route_manifest_path, &route_manifest_json)
    .with_context(|| format!("failed to write {}", route_manifest_path.display()))?;
  ui::detail_ok("route-manifest.json");

  // [1.7] Package first member output
  let first_member_out = shared_out_dir.join(&first.name);
  std::fs::create_dir_all(&first_member_out)?;
  package_static_assets(base_dir, &assets, &shared_out_dir, first.build_config.dist_dir())?;
  crate::build::run::copy_wasm_binary_pub(base_dir, &shared_out_dir)?;
  ui::detail_ok(&format!("{GREEN}{}{RESET} build complete", first.name));
  println!();

  // -- Phase 2: Subsequent members (compile + validate + package) --
  if members.len() > 1 {
    ui::step(2, 2, &format!("Building {} additional members", members.len() - 1));
    println!();

    for member in &members[1..] {
      ui::detail(&format!("{DIM}[{}]{RESET} compiling backend...", member.name));

      if let Some(cmd) = &member.build_config.backend_build_command {
        run_command(&member.member_dir, cmd, "backend build", &[])?;
      }

      // Extract manifest and validate compatibility
      let member_out = shared_out_dir.join(&member.name);
      std::fs::create_dir_all(&member_out)?;
      let member_manifest =
        extract_member_manifest(&member.build_config, &member.member_dir, &member_out)?;

      validate_manifest_compatibility(
        &reference_manifest,
        &first.name,
        &member_manifest,
        &member.name,
      )?;

      ui::detail_ok(&format!("{GREEN}{}{RESET} manifest compatible, build complete", member.name));
    }
    println!();
  }

  // Summary
  let elapsed = started.elapsed().as_secs_f64();
  let proc_count = reference_manifest.procedures.len();
  let template_count = skeleton_output.routes.len();
  let asset_count = assets.js.len() + assets.css.len();
  ui::ok(&format!("workspace build complete in {elapsed:.1}s"));
  ui::detail(&format!(
    "{member_count} members \u{00b7} {proc_count} procedures \u{00b7} {template_count} templates \u{00b7} {asset_count} assets",
  ));

  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::manifest::ProcedureSchema;
  use std::collections::BTreeMap;

  fn make_manifest(procs: &[(&str, &str)]) -> Manifest {
    use crate::manifest::ProcedureType;
    let mut procedures = BTreeMap::new();
    for (name, ptype) in procs {
      let proc_type = match *ptype {
        "query" => ProcedureType::Query,
        "command" => ProcedureType::Command,
        "subscription" => ProcedureType::Subscription,
        _ => ProcedureType::Query,
      };
      procedures.insert(
        name.to_string(),
        ProcedureSchema {
          proc_type,
          input: serde_json::json!({"properties": {"id": {"type": "uint32"}}}),
          output: serde_json::json!({"properties": {"name": {"type": "string"}}}),
          error: None,
        },
      );
    }
    Manifest { version: 1, procedures, channels: BTreeMap::new() }
  }

  #[test]
  fn compatible_manifests_pass() {
    let a = make_manifest(&[("getUser", "query"), ("getRepos", "query")]);
    let b = make_manifest(&[("getUser", "query"), ("getRepos", "query")]);
    assert!(validate_manifest_compatibility(&a, "ts-hono", &b, "rust-axum").is_ok());
  }

  #[test]
  fn missing_procedure_detected() {
    let a = make_manifest(&[("getUser", "query"), ("getRepos", "query")]);
    let b = make_manifest(&[("getUser", "query")]);
    let err = validate_manifest_compatibility(&a, "ts-hono", &b, "rust-axum").unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("getRepos"));
    assert!(msg.contains("ts-hono"));
    assert!(msg.contains("rust-axum"));
  }

  #[test]
  fn extra_procedure_detected() {
    let a = make_manifest(&[("getUser", "query")]);
    let b = make_manifest(&[("getUser", "query"), ("getExtra", "query")]);
    let err = validate_manifest_compatibility(&a, "ts-hono", &b, "rust-axum").unwrap_err();
    assert!(err.to_string().contains("getExtra"));
  }

  #[test]
  fn type_mismatch_detected() {
    let a = make_manifest(&[("getUser", "query")]);
    let b = make_manifest(&[("getUser", "subscription")]);
    let err = validate_manifest_compatibility(&a, "ts-hono", &b, "rust-axum").unwrap_err();
    assert!(err.to_string().contains("type mismatch"));
  }

  #[test]
  fn resolve_members_filter_works() {
    use std::io::Write;

    let tmp = std::env::temp_dir().join("seam-test-resolve-members");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(tmp.join("backends/ts-hono")).unwrap();
    std::fs::create_dir_all(tmp.join("backends/rust-axum")).unwrap();

    for (dir, router) in [("backends/ts-hono", true), ("backends/rust-axum", false)] {
      let mut f = std::fs::File::create(tmp.join(dir).join("seam.toml")).unwrap();
      if router {
        writeln!(
          f,
          r#"[project]
name = "x"
[backend]
lang = "typescript"
[build]
router_file = "src/router.ts"
backend_build_command = "bun build"
"#
        )
        .unwrap();
      } else {
        writeln!(
          f,
          r#"[project]
name = "x"
[backend]
lang = "rust"
[build]
manifest_command = "cargo run -- --manifest"
backend_build_command = "cargo build --release"
"#
        )
        .unwrap();
      }
    }

    let root: SeamConfig = toml::from_str(
      r#"
[project]
name = "test"

[frontend]
entry = "frontend/src/main.tsx"

[build]
routes = "frontend/src/routes.ts"
out_dir = ".seam/output"

[workspace]
members = ["backends/ts-hono", "backends/rust-axum"]
"#,
    )
    .unwrap();

    // No filter returns all
    let all = resolve_members(&root, &tmp, None).unwrap();
    assert_eq!(all.len(), 2);

    // Filter returns one
    let filtered = resolve_members(&root, &tmp, Some("rust-axum")).unwrap();
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].name, "rust-axum");

    // Unknown filter errors
    let err = resolve_members(&root, &tmp, Some("nonexistent")).unwrap_err();
    assert!(err.to_string().contains("unknown member"));

    let _ = std::fs::remove_dir_all(&tmp);
  }
}
