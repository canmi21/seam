/* crates/seam-cli/src/build/run.rs */

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use super::config::load_config;
use super::skeleton::{apply_conditionals, detect_conditional, sentinel_to_slots, wrap_document};

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

pub fn run_build(config_path: &Path) -> Result<()> {
  let base_dir = config_path.parent().unwrap_or_else(|| Path::new("."));

  let config = load_config(config_path)?;

  // 1. Run bundler
  println!("Running bundler: {}", config.bundler.command);
  let bundler_status = Command::new("sh")
    .args(["-c", &config.bundler.command])
    .current_dir(base_dir)
    .status()
    .context("failed to run bundler")?;
  if !bundler_status.success() {
    bail!("bundler exited with status {}", bundler_status);
  }

  // 2. Read Vite manifest for asset filenames
  let manifest_path = base_dir.join(&config.bundler.manifest_file);
  let manifest_content = std::fs::read_to_string(&manifest_path)
    .with_context(|| format!("failed to read Vite manifest at {}", manifest_path.display()))?;
  let vite_manifest: BTreeMap<String, ViteManifestEntry> =
    serde_json::from_str(&manifest_content).context("failed to parse Vite manifest")?;

  let mut css_files = Vec::new();
  let mut js_files = Vec::new();
  for entry in vite_manifest.values() {
    if entry.is_entry == Some(true) {
      js_files.push(entry.file.clone());
    }
    if let Some(css) = &entry.css {
      css_files.extend(css.iter().cloned());
    }
  }

  // 3. Find and run build-skeletons.mjs
  let script_path = base_dir.join("node_modules/@canmi/seam-react/scripts/build-skeletons.mjs");
  if !script_path.exists() {
    bail!("build-skeletons.mjs not found at {}", script_path.display());
  }

  let routes_path = base_dir.join(&config.routes);
  println!("Rendering skeletons for: {}", routes_path.display());

  let node_output = Command::new("node")
    .arg(&script_path)
    .arg(&routes_path)
    .current_dir(base_dir)
    .output()
    .context("failed to spawn node for skeleton rendering")?;

  if !node_output.status.success() {
    let stderr = String::from_utf8_lossy(&node_output.stderr);
    bail!("skeleton rendering failed:\n{stderr}");
  }

  let stdout = String::from_utf8(node_output.stdout).context("invalid UTF-8 from node")?;
  let skeleton_output: SkeletonOutput =
    serde_json::from_str(&stdout).context("failed to parse skeleton output JSON")?;

  // 4. Process each route
  let out_dir = base_dir.join(&config.out_dir);
  let templates_dir = out_dir.join("templates");
  std::fs::create_dir_all(&templates_dir)
    .with_context(|| format!("failed to create {}", templates_dir.display()))?;

  let mut route_manifest = RouteManifest { routes: BTreeMap::new() };

  for route in &skeleton_output.routes {
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

    // Wrap in full HTML document
    let document = wrap_document(&processed, &css_files, &js_files);

    let filename = path_to_filename(&route.path);
    let filepath = templates_dir.join(&filename);
    std::fs::write(&filepath, &document)
      .with_context(|| format!("failed to write {}", filepath.display()))?;

    let template_rel = format!("templates/{filename}");
    route_manifest.routes.insert(
      route.path.clone(),
      RouteManifestEntry { template: template_rel, loaders: route.loaders.clone() },
    );

    println!("  {} -> {}", route.path, filename);
  }

  // 5. Write route manifest
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
