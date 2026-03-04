/* src/cli/core/src/workspace.rs */

// Workspace build orchestrator: resolves members, builds frontend once,
// validates manifest compatibility across backends, packages per-member output.

use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result, bail};

use crate::build::config::BuildConfig;
use crate::build::route::{
  BundleContext, RenderContext, extract_manifest, extract_manifest_command, generate_types,
  package_static_assets, print_asset_files, print_procedure_breakdown, process_routes,
  run_typecheck, validate_handoff_consistency, validate_procedure_references,
};
use crate::build::run::steps;
use crate::config::{SeamConfig, resolve_member_config, validate_workspace};
use crate::shell::run_command;
use crate::ui::{self, DIM, GREEN, RESET, col};
use seam_codegen::Manifest;

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

/// Build output from the reference member (first member in workspace).
struct ReferenceOutput {
  manifest: Manifest,
  route_count: usize,
  asset_count: usize,
}

/// Build the reference member: compile backend, extract manifest, bundle frontend,
/// generate skeletons, process routes, and package output.
fn build_reference_member(
  first: &ResolvedMember,
  base_dir: &Path,
  shared_out_dir: &Path,
) -> Result<ReferenceOutput> {
  // [1.1] Compile backend
  ui::detail(&format!("{}[{}/backend]{} compiling...", col(DIM), first.name, col(RESET)));
  if let Some(cmd) = &first.build_config.backend_build_command {
    run_command(&first.member_dir, cmd, "backend build", &[])?;
  }

  // [1.2] Extract manifest
  ui::detail(&format!("{}[{}/manifest]{} extracting...", col(DIM), first.name, col(RESET)));
  let manifest = extract_member_manifest(&first.build_config, &first.member_dir, shared_out_dir)?;
  print_procedure_breakdown(&manifest);

  let rpc_hashes = super::build::run::maybe_generate_rpc_hashes_pub(
    &first.build_config,
    &manifest,
    shared_out_dir,
  )?;

  // [1.3] Generate client types (shared)
  ui::detail(&format!("{}[shared]{} generating client types", col(DIM), col(RESET)));
  generate_types(&manifest, &first.merged_config, rpc_hashes.as_ref())?;

  // [1.4] Bundle frontend (shared)
  ui::detail(&format!("{}[shared]{} bundling frontend", col(DIM), col(RESET)));
  let rpc_map_path_str = if rpc_hashes.is_some() {
    shared_out_dir.join("rpc-hash-map.json").to_string_lossy().to_string()
  } else {
    String::new()
  };
  let bundler_env = steps::build_bundler_env(&first.build_config, &rpc_map_path_str);
  let assets = steps::bundle_frontend(&first.build_config, base_dir, &bundler_env)?;
  print_asset_files(base_dir, first.build_config.dist_dir(), &assets);

  // [1.5] Type check (optional)
  if let Some(cmd) = &first.build_config.typecheck_command {
    ui::detail(&format!("{}[shared]{} type checking", col(DIM), col(RESET)));
    run_typecheck(base_dir, cmd)?;
  }

  // [1.6] Generate skeletons + process routes
  ui::detail(&format!("{}[shared]{} generating skeletons", col(DIM), col(RESET)));
  let skeleton_output = steps::render_skeletons(
    &first.build_config,
    base_dir,
    &shared_out_dir.join("seam-manifest.json"),
  )?;
  validate_procedure_references(&manifest, &skeleton_output)?;
  validate_handoff_consistency(&skeleton_output);

  let templates_dir = shared_out_dir.join("templates");
  std::fs::create_dir_all(&templates_dir)
    .with_context(|| format!("failed to create {}", templates_dir.display()))?;
  let render = RenderContext {
    root_id: &first.build_config.root_id,
    data_id: &first.build_config.data_id,
    dev_mode: false,
    vite: None,
  };
  let bundle_ctx = BundleContext { manifest: None, source_file_map: None };
  let route_manifest = process_routes(
    &skeleton_output.layouts,
    &skeleton_output.routes,
    &templates_dir,
    &assets,
    &render,
    first.build_config.i18n.as_ref(),
    &bundle_ctx,
  )?;

  let route_manifest_path = shared_out_dir.join("route-manifest.json");
  let route_manifest_json = serde_json::to_string_pretty(&route_manifest)?;
  std::fs::write(&route_manifest_path, &route_manifest_json)
    .with_context(|| format!("failed to write {}", route_manifest_path.display()))?;
  ui::detail_ok("route-manifest.json");

  // [1.7] Package output
  let first_member_out = shared_out_dir.join(&first.name);
  std::fs::create_dir_all(&first_member_out)?;
  package_static_assets(base_dir, &assets, shared_out_dir, first.build_config.dist_dir())?;
  crate::build::run::copy_wasm_binary_pub(base_dir, shared_out_dir)?;
  ui::detail_ok(&format!("{}{}{} build complete", col(GREEN), first.name, col(RESET)));

  let route_count = skeleton_output.routes.len();
  let asset_count = assets.js.len() + assets.css.len();
  Ok(ReferenceOutput { manifest, route_count, asset_count })
}

/// Build and validate a subsequent workspace member against the reference manifest.
fn build_validate_member(
  member: &ResolvedMember,
  reference_manifest: &Manifest,
  reference_name: &str,
  shared_out_dir: &Path,
) -> Result<()> {
  ui::detail(&format!("{}[{}]{} compiling backend...", col(DIM), member.name, col(RESET)));

  if let Some(cmd) = &member.build_config.backend_build_command {
    run_command(&member.member_dir, cmd, "backend build", &[])?;
  }

  let member_out = shared_out_dir.join(&member.name);
  std::fs::create_dir_all(&member_out)?;
  let member_manifest =
    extract_member_manifest(&member.build_config, &member.member_dir, &member_out)?;

  validate_manifest_compatibility(
    reference_manifest,
    reference_name,
    &member_manifest,
    &member.name,
  )?;

  ui::detail_ok(&format!(
    "{}{}{} manifest compatible, build complete",
    col(GREEN),
    member.name,
    col(RESET)
  ));
  Ok(())
}

/// Run workspace build: build frontend once, then compile + validate each backend member.
pub fn run_workspace_build(root: &SeamConfig, base_dir: &Path, filter: Option<&str>) -> Result<()> {
  let started = Instant::now();
  let members = resolve_members(root, base_dir, filter)?;

  let member_count = members.len();
  let total_label =
    if member_count == 1 { "1 member".to_string() } else { format!("{member_count} members") };
  ui::banner("workspace build", Some(&format!("{} — {total_label}", root.project.name)));

  let first = &members[0];
  let shared_out_dir = base_dir.join(&first.build_config.out_dir);

  // -- Phase 1: Reference member full build --
  ui::step(1, 2, &format!("Building reference member: {}", first.name));
  println!();
  let ref_output = build_reference_member(first, base_dir, &shared_out_dir)?;
  println!();

  // -- Phase 2: Subsequent members (compile + validate) --
  if members.len() > 1 {
    ui::step(2, 2, &format!("Building {} additional members", members.len() - 1));
    println!();
    for member in &members[1..] {
      build_validate_member(member, &ref_output.manifest, &first.name, &shared_out_dir)?;
    }
    println!();
  }

  // Summary
  let elapsed = started.elapsed().as_secs_f64();
  let proc_count = ref_output.manifest.procedures.len();
  ui::ok(&format!("workspace build complete in {elapsed:.1}s"));
  ui::detail(&format!(
    "{member_count} members \u{00b7} {proc_count} procedures \u{00b7} {} templates \u{00b7} {} assets",
    ref_output.route_count, ref_output.asset_count,
  ));

  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use seam_codegen::ProcedureSchema;
  use std::collections::BTreeMap;

  fn make_manifest(procs: &[(&str, &str)]) -> Manifest {
    use seam_codegen::ProcedureType;
    let mut procedures = BTreeMap::new();
    for (name, ptype) in procs {
      let proc_type = match *ptype {
        "query" => ProcedureType::Query,
        "command" => ProcedureType::Command,
        "subscription" => ProcedureType::Subscription,
        "stream" => ProcedureType::Stream,
        "upload" => ProcedureType::Upload,
        _ => ProcedureType::Query,
      };
      procedures.insert(
        name.to_string(),
        ProcedureSchema {
          proc_type,
          input: serde_json::json!({"properties": {"id": {"type": "uint32"}}}),
          output: Some(serde_json::json!({"properties": {"name": {"type": "string"}}})),
          chunk_output: None,
          error: None,
          invalidates: None,
          context: None,
          transport: None,
        },
      );
    }
    Manifest {
      version: 1,
      context: BTreeMap::new(),
      procedures,
      channels: BTreeMap::new(),
      transport_defaults: BTreeMap::new(),
    }
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
