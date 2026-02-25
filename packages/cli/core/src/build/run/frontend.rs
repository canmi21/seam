/* packages/cli/core/src/build/run/frontend.rs */

use std::path::Path;
use std::time::Instant;

use anyhow::{Context, Result};

use super::super::config::BuildConfig;
use super::super::route::{
  export_i18n_messages, print_asset_files, process_routes, read_i18n_messages,
  run_skeleton_renderer,
};
use super::super::types::read_bundle_manifest;
use super::helpers::{print_cache_stats, run_bundler};
use crate::shell::resolve_node_module;
use crate::ui::{self, RESET, YELLOW};

// -- Frontend-only build (4 steps) --

pub(super) fn run_frontend_build(build_config: &BuildConfig, base_dir: &Path) -> Result<()> {
  let started = Instant::now();

  ui::banner("build", None);

  // [1/4] Bundle frontend
  ui::step(1, 4, "Bundling frontend");
  run_bundler(base_dir, &build_config.bundler_mode, &[])?;

  let manifest_path = base_dir.join(&build_config.bundler_manifest);
  let assets = read_bundle_manifest(&manifest_path)?;
  print_asset_files(base_dir, build_config.dist_dir(), &assets);
  ui::blank();

  // [2/4] Extract routes
  ui::step(2, 4, "Extracting routes");
  let script_path = resolve_node_module(base_dir, "@canmi/seam-react/scripts/build-skeletons.mjs")
    .ok_or_else(|| anyhow::anyhow!("build-skeletons.mjs not found -- install @canmi/seam-react"))?;
  let routes_path = base_dir.join(&build_config.routes);
  let none_path = Path::new("none");
  let skeleton_output = run_skeleton_renderer(
    &script_path,
    &routes_path,
    none_path,
    base_dir,
    build_config.i18n.as_ref(),
  )?;
  for w in &skeleton_output.warnings {
    ui::detail(&format!("{YELLOW}warning{RESET}: {w}"));
  }
  print_cache_stats(&skeleton_output.cache);
  ui::detail_ok(&format!("{} routes found", skeleton_output.routes.len()));
  ui::blank();

  // [3/4] Generate skeletons
  ui::step(3, 4, "Generating skeletons");
  let out_dir = base_dir.join(&build_config.out_dir);
  let templates_dir = out_dir.join("templates");
  std::fs::create_dir_all(&templates_dir)
    .with_context(|| format!("failed to create {}", templates_dir.display()))?;
  let i18n_messages = match &build_config.i18n {
    Some(cfg) => Some(read_i18n_messages(base_dir, cfg)?),
    None => None,
  };
  let route_manifest = process_routes(
    &skeleton_output.layouts,
    &skeleton_output.routes,
    &templates_dir,
    &assets,
    false,
    None,
    &build_config.root_id,
    &build_config.data_id,
    build_config.i18n.as_ref(),
    i18n_messages.as_ref(),
  )?;
  if let Some(ref msgs) = i18n_messages {
    export_i18n_messages(&out_dir, msgs)?;
  }
  ui::blank();

  // [4/4] Write route manifest
  ui::step(4, 4, "Writing route manifest");
  let manifest_out = out_dir.join("route-manifest.json");
  let manifest_json = serde_json::to_string_pretty(&route_manifest)?;
  std::fs::write(&manifest_out, &manifest_json)
    .with_context(|| format!("failed to write {}", manifest_out.display()))?;
  ui::detail_ok("route-manifest.json");
  ui::blank();

  // Summary
  let elapsed = started.elapsed().as_secs_f64();
  let template_count = skeleton_output.routes.len();
  let asset_count = assets.js.len() + assets.css.len();
  ui::ok(&format!("build complete in {elapsed:.1}s"));
  ui::detail(&format!(
    "{template_count} templates \u{00b7} {asset_count} assets \u{00b7} {} \u{00b7} route-manifest.json",
    build_config.renderer,
  ));

  Ok(())
}
