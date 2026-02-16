/* packages/cli/core/src/build/route.rs */

// Build pipeline steps: skeleton rendering, route processing,
// manifest extraction, codegen, type checking, and asset packaging.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use super::skeleton::{extract_template, sentinel_to_slots, wrap_document, Axis};
use super::types::AssetFiles;
use crate::codegen;
use crate::config::SeamConfig;
use crate::manifest::Manifest;
use crate::shell::{run_command, which_exists};
use crate::ui::{self, DIM, GREEN, RESET};

// -- Node script output types --

#[derive(Deserialize)]
pub(super) struct SkeletonOutput {
  pub(super) routes: Vec<SkeletonRoute>,
}

#[derive(Deserialize)]
pub(super) struct SkeletonRoute {
  path: String,
  loaders: serde_json::Value,
  axes: Vec<Axis>,
  variants: Vec<RenderedVariant>,
}

#[derive(Deserialize)]
struct RenderedVariant {
  #[serde(rename = "variant")]
  _variant: serde_json::Value,
  html: String,
}

// -- Route manifest output --

#[derive(Serialize)]
pub(super) struct RouteManifest {
  routes: BTreeMap<String, RouteManifestEntry>,
}

#[derive(Serialize)]
struct RouteManifestEntry {
  template: String,
  loaders: serde_json::Value,
}

/// Convert route path to filename: `/user/:id` -> `user-id.html`, `/` -> `index.html`
fn path_to_filename(path: &str) -> String {
  let trimmed = path.trim_matches('/');
  if trimmed.is_empty() {
    return "index.html".to_string();
  }
  let slug = trimmed.replace('/', "-").replace(':', "");
  format!("{slug}.html")
}

/// Print each asset file with its size from disk
pub(super) fn print_asset_files(base_dir: &Path, dist_dir: &str, assets: &AssetFiles) {
  let all_files: Vec<&str> =
    assets.js.iter().chain(assets.css.iter()).map(|s| s.as_str()).collect();
  for file in all_files {
    let full_path = base_dir.join(dist_dir).join(file);
    let size = std::fs::metadata(&full_path).map(|m| m.len()).unwrap_or(0);
    ui::detail_ok(&format!("{dist_dir}/{file}  {DIM}({}){RESET}", ui::format_size(size)));
  }
}

pub(super) fn run_skeleton_renderer(
  script_path: &Path,
  routes_path: &Path,
  manifest_path: &Path,
  base_dir: &Path,
) -> Result<SkeletonOutput> {
  let output = Command::new("node")
    .arg(script_path)
    .arg(routes_path)
    .arg(manifest_path)
    .current_dir(base_dir)
    .output()
    .context("failed to spawn node for skeleton rendering")?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    bail!("skeleton rendering failed:\n{stderr}");
  }

  let stdout = String::from_utf8(output.stdout).context("invalid UTF-8 from node")?;
  serde_json::from_str(&stdout).context("failed to parse skeleton output JSON")
}

pub(super) fn process_routes(
  routes: &[SkeletonRoute],
  templates_dir: &Path,
  assets: &AssetFiles,
) -> Result<RouteManifest> {
  let mut manifest = RouteManifest { routes: BTreeMap::new() };

  for route in routes {
    let processed: Vec<_> = route.variants.iter().map(|v| sentinel_to_slots(&v.html)).collect();
    let template = extract_template(&route.axes, &processed);
    let document = wrap_document(&template, &assets.css, &assets.js);

    let filename = path_to_filename(&route.path);
    let filepath = templates_dir.join(&filename);
    std::fs::write(&filepath, &document)
      .with_context(|| format!("failed to write {}", filepath.display()))?;

    let size = document.len() as u64;
    let template_rel = format!("templates/{filename}");
    ui::detail_ok(&format!(
      "{}  \u{2192} {template_rel}  {DIM}({}){RESET}",
      route.path,
      ui::format_size(size)
    ));

    manifest.routes.insert(
      route.path.clone(),
      RouteManifestEntry { template: template_rel, loaders: route.loaders.clone() },
    );
  }
  Ok(manifest)
}

/// Print procedure breakdown (reused from pull.rs logic)
pub(super) fn print_procedure_breakdown(manifest: &Manifest) {
  let total = manifest.procedures.len();
  let mut queries = 0u32;
  let mut mutations = 0u32;
  let mut subscriptions = 0u32;
  for proc in manifest.procedures.values() {
    match proc.proc_type.as_str() {
      "query" => queries += 1,
      "mutation" => mutations += 1,
      "subscription" => subscriptions += 1,
      _ => queries += 1,
    }
  }
  let mut parts = Vec::new();
  if queries > 0 {
    parts.push(format!("{queries} {}", if queries == 1 { "query" } else { "queries" }));
  }
  if mutations > 0 {
    parts.push(format!("{mutations} {}", if mutations == 1 { "mutation" } else { "mutations" }));
  }
  if subscriptions > 0 {
    parts.push(format!(
      "{subscriptions} {}",
      if subscriptions == 1 { "subscription" } else { "subscriptions" }
    ));
  }
  let breakdown =
    if parts.is_empty() { String::new() } else { format!(" \u{2014} {}", parts.join(", ")) };
  ui::detail_ok(&format!("{total} procedures{breakdown}"));
}

/// Extract procedure manifest by importing the router file at build time
pub(super) fn extract_manifest(
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

  ui::detail(&format!("{DIM}{runtime} -e \"import('{router_file}')...\"{RESET}"));

  let output = Command::new(runtime)
    .args(["-e", &script])
    .current_dir(base_dir)
    .output()
    .with_context(|| format!("failed to run {runtime} for manifest extraction"))?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    bail!("manifest extraction failed:\n{stderr}");
  }

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
  ui::detail_ok("seam-manifest.json");

  Ok(manifest)
}

/// Generate TypeScript client types from the manifest
pub(super) fn generate_types(manifest: &Manifest, config: &SeamConfig) -> Result<()> {
  let out_dir_str = config.generate.out_dir.as_deref().unwrap_or("src/generated");

  let code = codegen::generate_typescript(manifest)?;
  let line_count = code.lines().count();
  let proc_count = manifest.procedures.len();

  let out_path = Path::new(out_dir_str);
  std::fs::create_dir_all(out_path)
    .with_context(|| format!("failed to create {}", out_path.display()))?;
  let file = out_path.join("client.ts");
  std::fs::write(&file, &code).with_context(|| format!("failed to write {}", file.display()))?;

  ui::detail_ok(&format!(
    "{proc_count} procedures \u{2192} {} ({line_count} lines)",
    file.display()
  ));
  Ok(())
}

/// Run type checking (optional step)
pub(super) fn run_typecheck(base_dir: &Path, command: &str) -> Result<()> {
  run_command(base_dir, command, "type checker")?;
  ui::detail_ok(&format!("{GREEN}passed{RESET}"));
  Ok(())
}

/// Copy frontend assets from dist/ to {out_dir}/public/
pub(super) fn package_static_assets(
  base_dir: &Path,
  assets: &AssetFiles,
  out_dir: &Path,
) -> Result<()> {
  let public_dir = out_dir.join("public");

  let all_files: Vec<&str> =
    assets.js.iter().chain(assets.css.iter()).map(|s| s.as_str()).collect();

  for file in all_files {
    let src = base_dir.join("dist").join(file);
    let dst = public_dir.join(file);

    if let Some(parent) = dst.parent() {
      std::fs::create_dir_all(parent)
        .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    std::fs::copy(&src, &dst)
      .with_context(|| format!("failed to copy {} -> {}", src.display(), dst.display()))?;

    let size = std::fs::metadata(&dst).map(|m| m.len()).unwrap_or(0);
    ui::detail_ok(&format!("public/{file}  {DIM}({}){RESET}", ui::format_size(size)));
  }

  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn path_to_filename_root() {
    assert_eq!(path_to_filename("/"), "index.html");
  }

  #[test]
  fn path_to_filename_simple() {
    assert_eq!(path_to_filename("/about"), "about.html");
  }

  #[test]
  fn path_to_filename_with_param() {
    assert_eq!(path_to_filename("/user/:id"), "user-id.html");
  }

  #[test]
  fn path_to_filename_nested() {
    assert_eq!(path_to_filename("/user/:id/posts"), "user-id-posts.html");
  }
}
