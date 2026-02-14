/* packages/cli/core/src/build/run.rs */

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use super::config::BuildConfig;
use super::skeleton::{apply_conditionals, detect_conditional, sentinel_to_slots, wrap_document};
use crate::config::SeamConfig;

// -- Vite manifest types --

#[derive(Deserialize)]
struct ViteManifestEntry {
  file: String,
  css: Option<Vec<String>>,
  #[serde(rename = "isEntry")]
  is_entry: Option<bool>,
}

// -- Node script output types --

#[derive(Deserialize)]
struct SkeletonOutput {
  routes: Vec<SkeletonRoute>,
}

#[derive(Deserialize)]
struct SkeletonRoute {
  path: String,
  loaders: serde_json::Value,
  #[serde(rename = "fullHtml")]
  full_html: String,
  #[serde(rename = "nullableFields")]
  nullable_fields: Vec<String>,
  #[serde(rename = "nulledHtmls")]
  nulled_htmls: BTreeMap<String, String>,
}

// -- Route manifest output --

#[derive(Serialize)]
struct RouteManifest {
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

struct AssetFiles {
  css: Vec<String>,
  js: Vec<String>,
}

fn run_bundler(base_dir: &Path, command: &str) -> Result<()> {
  println!("Running bundler: {command}");
  let status = Command::new("sh")
    .args(["-c", command])
    .current_dir(base_dir)
    .status()
    .context("failed to run bundler")?;
  if !status.success() {
    bail!("bundler exited with status {status}");
  }
  Ok(())
}

fn read_vite_manifest(path: &Path) -> Result<AssetFiles> {
  let content = std::fs::read_to_string(path)
    .with_context(|| format!("failed to read Vite manifest at {}", path.display()))?;
  let manifest: BTreeMap<String, ViteManifestEntry> =
    serde_json::from_str(&content).context("failed to parse Vite manifest")?;

  let mut css = Vec::new();
  let mut js = Vec::new();
  for entry in manifest.values() {
    if entry.is_entry == Some(true) {
      js.push(entry.file.clone());
    }
    if let Some(css_list) = &entry.css {
      css.extend(css_list.iter().cloned());
    }
  }
  Ok(AssetFiles { css, js })
}

fn run_skeleton_renderer(
  script_path: &Path,
  routes_path: &Path,
  base_dir: &Path,
) -> Result<SkeletonOutput> {
  println!("Rendering skeletons for: {}", routes_path.display());

  let output = Command::new("node")
    .arg(script_path)
    .arg(routes_path)
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

fn process_routes(
  routes: &[SkeletonRoute],
  templates_dir: &Path,
  assets: &AssetFiles,
) -> Result<RouteManifest> {
  let mut manifest = RouteManifest { routes: BTreeMap::new() };

  for route in routes {
    let mut processed = sentinel_to_slots(&route.full_html);

    // Detect and apply conditionals from nullable field diffs
    let mut blocks = Vec::new();
    for field in &route.nullable_fields {
      if let Some(nulled_html) = route.nulled_htmls.get(field) {
        let nulled_processed = sentinel_to_slots(nulled_html);
        if let Some(block) = detect_conditional(&processed, &nulled_processed, field) {
          blocks.push(block);
        }
      }
    }
    if !blocks.is_empty() {
      processed = apply_conditionals(&processed, blocks);
    }

    let document = wrap_document(&processed, &assets.css, &assets.js);

    let filename = path_to_filename(&route.path);
    let filepath = templates_dir.join(&filename);
    std::fs::write(&filepath, &document)
      .with_context(|| format!("failed to write {}", filepath.display()))?;

    let template_rel = format!("templates/{filename}");
    manifest.routes.insert(
      route.path.clone(),
      RouteManifestEntry { template: template_rel, loaders: route.loaders.clone() },
    );

    println!("  {} -> {}", route.path, filename);
  }
  Ok(manifest)
}

pub fn run_build(config: &SeamConfig, base_dir: &Path) -> Result<()> {
  let build_config = BuildConfig::from_seam_config(config)?;

  run_bundler(base_dir, &build_config.bundler_command)?;

  let manifest_path = base_dir.join(&build_config.bundler_manifest);
  let assets = read_vite_manifest(&manifest_path)?;

  let script_path = base_dir.join("node_modules/@canmi/seam-react/scripts/build-skeletons.mjs");
  if !script_path.exists() {
    bail!("build-skeletons.mjs not found at {}", script_path.display());
  }
  let routes_path = base_dir.join(&build_config.routes);
  let skeleton_output = run_skeleton_renderer(&script_path, &routes_path, base_dir)?;

  let out_dir = base_dir.join(&build_config.out_dir);
  let templates_dir = out_dir.join("templates");
  std::fs::create_dir_all(&templates_dir)
    .with_context(|| format!("failed to create {}", templates_dir.display()))?;

  let route_manifest = process_routes(&skeleton_output.routes, &templates_dir, &assets)?;

  let manifest_out = out_dir.join("route-manifest.json");
  let manifest_json = serde_json::to_string_pretty(&route_manifest)?;
  std::fs::write(&manifest_out, manifest_json)
    .with_context(|| format!("failed to write {}", manifest_out.display()))?;

  println!("Build complete: {} routes", skeleton_output.routes.len());
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
