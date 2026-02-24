/* packages/cli/core/src/build/route.rs */

// Build pipeline steps: skeleton rendering, route processing,
// manifest extraction, codegen, type checking, and asset packaging.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use super::ctr_check;
use super::skeleton::{
  extract_head_metadata, extract_template, sentinel_to_slots, wrap_document, Axis,
};
use super::slot_warning;
use super::types::{AssetFiles, ViteDevInfo};
use crate::codegen;
use crate::config::SeamConfig;
use crate::manifest::Manifest;
use crate::shell::{run_command, which_exists};
use crate::ui::{self, DIM, GREEN, RESET, YELLOW};

// -- Node script output types --

#[derive(Deserialize)]
pub(super) struct SkeletonLayout {
  pub(super) id: String,
  pub(super) html: String,
  #[serde(default)]
  pub(super) loaders: serde_json::Value,
  pub(super) parent: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct CacheStats {
  pub(super) hits: u32,
  pub(super) misses: u32,
}

#[derive(Deserialize)]
pub(super) struct SkeletonOutput {
  #[serde(default)]
  pub(super) layouts: Vec<SkeletonLayout>,
  pub(super) routes: Vec<SkeletonRoute>,
  #[serde(default)]
  pub(super) warnings: Vec<String>,
  #[serde(rename = "cacheStats", default)]
  pub(super) cache: Option<CacheStats>,
}

#[derive(Deserialize)]
pub(super) struct SkeletonRoute {
  path: String,
  loaders: serde_json::Value,
  axes: Vec<Axis>,
  variants: Vec<RenderedVariant>,
  #[serde(rename = "mockHtml")]
  mock_html: String,
  mock: serde_json::Value,
  #[serde(rename = "pageSchema")]
  page_schema: Option<serde_json::Value>,
  #[serde(default)]
  layout: Option<String>,
}

#[derive(Deserialize)]
struct RenderedVariant {
  #[serde(rename = "variant")]
  _variant: serde_json::Value,
  html: String,
}

// -- Route manifest output --

#[derive(Serialize)]
struct LayoutManifestEntry {
  template: String,
  #[serde(skip_serializing_if = "serde_json::Value::is_null")]
  loaders: serde_json::Value,
  #[serde(skip_serializing_if = "Option::is_none")]
  parent: Option<String>,
}

#[derive(Serialize)]
pub(super) struct RouteManifest {
  #[serde(skip_serializing_if = "BTreeMap::is_empty")]
  layouts: BTreeMap<String, LayoutManifestEntry>,
  routes: BTreeMap<String, RouteManifestEntry>,
  #[serde(skip_serializing_if = "Option::is_none")]
  data_id: Option<String>,
}

#[derive(Serialize)]
struct RouteManifestEntry {
  template: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  layout: Option<String>,
  loaders: serde_json::Value,
  #[serde(skip_serializing_if = "Option::is_none")]
  head_meta: Option<String>,
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
  let runtime = if which_exists("bun") { "bun" } else { "node" };
  let output = Command::new(runtime)
    .arg(script_path)
    .arg(routes_path)
    .arg(manifest_path)
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

#[allow(clippy::too_many_arguments)]
pub(super) fn process_routes(
  layouts: &[SkeletonLayout],
  routes: &[SkeletonRoute],
  templates_dir: &Path,
  assets: &AssetFiles,
  dev_mode: bool,
  vite: Option<&ViteDevInfo>,
  root_id: &str,
  data_id: &str,
) -> Result<RouteManifest> {
  // Process layouts: replace <seam-outlet>, convert sentinels to slots, wrap document
  let mut layout_manifest = BTreeMap::new();
  for layout in layouts {
    let html = layout.html.replace("<seam-outlet></seam-outlet>", "<!--seam:outlet-->");
    // Convert %%SEAM:path%% sentinels to <!--seam:path--> slots for server injection
    let html = sentinel_to_slots(&html);
    let document = wrap_document(&html, &assets.css, &assets.js, dev_mode, vite, root_id);
    let filename = format!("{}.html", layout.id);
    let filepath = templates_dir.join(&filename);
    std::fs::write(&filepath, &document)
      .with_context(|| format!("failed to write {}", filepath.display()))?;
    let template_rel = format!("templates/{filename}");
    ui::detail_ok(&format!("layout {} -> {template_rel}", layout.id));
    layout_manifest.insert(
      layout.id.clone(),
      LayoutManifestEntry {
        template: template_rel,
        loaders: layout.loaders.clone(),
        parent: layout.parent.clone(),
      },
    );
  }

  let manifest_data_id = if data_id == "__SEAM_DATA__" { None } else { Some(data_id.to_string()) };
  let mut manifest =
    RouteManifest { layouts: layout_manifest, routes: BTreeMap::new(), data_id: manifest_data_id };

  for route in routes {
    let processed: Vec<_> = route.variants.iter().map(|v| sentinel_to_slots(&v.html)).collect();
    let template = extract_template(&route.axes, &processed);

    // CTR equivalence check: verify template + mock data == React render
    ctr_check::verify_ctr_equivalence(&route.path, &route.mock_html, &template, &route.mock)?;

    // Warn about open-string fields in style/class contexts
    if let Some(schema) = &route.page_schema {
      for w in slot_warning::check_slot_types(&template, schema) {
        ui::detail(&format!("{YELLOW}warning{RESET}: {} {w}", route.path));
      }
    }

    // Routes with a layout are fragments; the server composes them at runtime.
    // In production, extract <title>/<meta>/<link> from page fragments so the
    // server can inject them into <head> (page metadata would otherwise end up
    // inside the root div via <!--seam:outlet--> substitution).
    // Dev mode skips extraction: lazy getters re-read template files but not
    // manifest strings, so keeping metadata inline avoids stale-manifest issues.
    let (document, head_meta) = if route.layout.is_some() {
      if dev_mode {
        (template.clone(), None)
      } else {
        let (meta, body) = extract_head_metadata(&template);
        let hm = if meta.is_empty() { None } else { Some(meta.to_string()) };
        (body.to_string(), hm)
      }
    } else {
      (wrap_document(&template, &assets.css, &assets.js, dev_mode, vite, root_id), None)
    };

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
      RouteManifestEntry {
        template: template_rel,
        layout: route.layout.clone(),
        loaders: route.loaders.clone(),
        head_meta,
      },
    );
  }
  Ok(manifest)
}

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

fn levenshtein(a: &str, b: &str) -> usize {
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

fn did_you_mean<'a>(name: &str, candidates: &[&'a str]) -> Option<&'a str> {
  candidates
    .iter()
    .map(|c| (*c, levenshtein(name, c)))
    .filter(|(_, d)| *d <= 3 && *d > 0)
    .min_by_key(|(_, d)| *d)
    .map(|(c, _)| c)
}

/// Validate that all procedure references in routes/layouts exist in the manifest.
/// Collects all errors and reports them together.
pub(super) fn validate_procedure_references(
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

  let available: Vec<&str> = manifest.procedures.keys().map(|s| s.as_str()).collect();
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

  bail!("[seam] error: unknown procedure reference\n\n{}", errors.join("\n\n"));
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
pub(super) fn generate_types(
  manifest: &Manifest,
  config: &SeamConfig,
  rpc_hashes: Option<&super::rpc_hash::RpcHashMap>,
) -> Result<()> {
  let out_dir_str = config.generate.out_dir.as_deref().unwrap_or("src/generated");

  let code = codegen::generate_typescript(manifest, rpc_hashes, &config.frontend.data_id)?;
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
  run_command(base_dir, command, "type checker", &[])?;
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

  // -- Levenshtein distance tests --

  #[test]
  fn levenshtein_identical() {
    assert_eq!(levenshtein("abc", "abc"), 0);
  }

  #[test]
  fn levenshtein_single_char() {
    assert_eq!(levenshtein("abc", "abd"), 1);
  }

  #[test]
  fn levenshtein_empty() {
    assert_eq!(levenshtein("", "abc"), 3);
    assert_eq!(levenshtein("abc", ""), 3);
  }

  #[test]
  fn levenshtein_completely_different() {
    assert_eq!(levenshtein("abc", "xyz"), 3);
  }

  #[test]
  fn did_you_mean_close_match() {
    let candidates = vec!["getHomeData", "getSession", "getUser"];
    assert_eq!(did_you_mean("getHomedata", &candidates), Some("getHomeData"));
  }

  #[test]
  fn did_you_mean_no_match() {
    let candidates = vec!["getHomeData", "getSession"];
    assert_eq!(did_you_mean("totallyDifferent", &candidates), None);
  }

  // -- Procedure validation tests --

  fn make_manifest(names: &[&str]) -> Manifest {
    use crate::manifest::ProcedureSchema;
    let mut procedures = BTreeMap::new();
    for name in names {
      procedures.insert(
        name.to_string(),
        ProcedureSchema {
          proc_type: "query".to_string(),
          input: serde_json::Value::Null,
          output: serde_json::Value::Null,
        },
      );
    }
    Manifest { version: "1".to_string(), procedures }
  }

  fn make_skeleton(
    routes: Vec<(&str, serde_json::Value)>,
    layouts: Vec<(&str, serde_json::Value)>,
  ) -> SkeletonOutput {
    SkeletonOutput {
      routes: routes
        .into_iter()
        .map(|(path, loaders)| SkeletonRoute {
          path: path.to_string(),
          loaders,
          axes: vec![],
          variants: vec![],
          mock_html: String::new(),
          mock: serde_json::Value::Null,
          page_schema: None,
          layout: None,
        })
        .collect(),
      layouts: layouts
        .into_iter()
        .map(|(id, loaders)| SkeletonLayout {
          id: id.to_string(),
          html: String::new(),
          loaders,
          parent: None,
        })
        .collect(),
      warnings: vec![],
      cache: None,
    }
  }

  #[test]
  fn validate_all_procedures_exist() {
    let manifest = make_manifest(&["getHomeData", "getSession"]);
    let skeleton = make_skeleton(
      vec![("/", serde_json::json!({ "page": { "procedure": "getHomeData" } }))],
      vec![("_layout_root", serde_json::json!({ "session": { "procedure": "getSession" } }))],
    );
    assert!(validate_procedure_references(&manifest, &skeleton).is_ok());
  }

  #[test]
  fn validate_missing_procedure_in_route() {
    let manifest = make_manifest(&["getHomeData", "getSession"]);
    let skeleton = make_skeleton(
      vec![("/", serde_json::json!({ "page": { "procedure": "getNonexistent" } }))],
      vec![],
    );
    let err = validate_procedure_references(&manifest, &skeleton).unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("Route \"/\""), "should mention route path");
    assert!(msg.contains("\"page\""), "should mention loader name");
    assert!(msg.contains("\"getNonexistent\""), "should mention procedure name");
  }

  #[test]
  fn validate_did_you_mean_suggestion() {
    let manifest = make_manifest(&["getHomeData", "getSession"]);
    let skeleton = make_skeleton(
      vec![("/", serde_json::json!({ "page": { "procedure": "getHomedata" } }))],
      vec![],
    );
    let err = validate_procedure_references(&manifest, &skeleton).unwrap_err();
    assert!(err.to_string().contains("Did you mean: getHomeData?"));
  }

  // -- head_meta extraction tests --

  #[test]
  fn head_meta_extracted_for_page_with_layout() {
    // Simulates what process_routes does for a page fragment with a layout in production mode
    let template = "<title><!--seam:t--></title><div>body</div>";
    let (meta, body) = extract_head_metadata(template);
    assert_eq!(meta, "<title><!--seam:t--></title>");
    assert_eq!(body, "<div>body</div>");
    // head_meta would be Some(meta.to_string())
    let head_meta: Option<String> = if meta.is_empty() { None } else { Some(meta.to_string()) };
    assert_eq!(head_meta, Some("<title><!--seam:t--></title>".to_string()));
  }

  #[test]
  fn head_meta_none_for_page_without_metadata() {
    let template = "<div><p>just body</p></div>";
    let (meta, body) = extract_head_metadata(template);
    assert!(meta.is_empty(), "no metadata to extract");
    assert_eq!(body, template, "body unchanged");
    let head_meta: Option<String> = if meta.is_empty() { None } else { Some(meta.to_string()) };
    assert!(head_meta.is_none());
  }

  #[test]
  fn head_meta_with_conditional_meta_tag() {
    let template =
      "<!--seam:if:og--><!--seam:d:attr:content--><meta name=\"og\"><!--seam:endif:og--><p>body</p>";
    let (meta, body) = extract_head_metadata(template);
    assert!(meta.contains("<!--seam:if:og-->"), "conditional directive extracted");
    assert!(meta.contains("<meta name=\"og\">"), "meta element extracted");
    assert!(meta.contains("<!--seam:endif:og-->"), "endif directive extracted");
    assert_eq!(body, "<p>body</p>");
  }

  #[test]
  fn head_meta_serialization_skips_none() {
    let entry = RouteManifestEntry {
      template: "templates/index.html".to_string(),
      layout: None,
      loaders: serde_json::Value::Null,
      head_meta: None,
    };
    let json = serde_json::to_string(&entry).unwrap();
    assert!(!json.contains("head_meta"), "None head_meta should be skipped in JSON");
  }

  #[test]
  fn head_meta_serialization_includes_some() {
    let entry = RouteManifestEntry {
      template: "templates/index.html".to_string(),
      layout: Some("root".to_string()),
      loaders: serde_json::Value::Null,
      head_meta: Some("<title><!--seam:t--></title>".to_string()),
    };
    let json = serde_json::to_string(&entry).unwrap();
    assert!(json.contains("head_meta"), "Some head_meta should be present in JSON");
    assert!(json.contains("<!--seam:t-->"), "head_meta value preserved");
  }

  #[test]
  fn validate_missing_procedure_in_layout() {
    let manifest = make_manifest(&["getSession"]);
    let skeleton = make_skeleton(
      vec![],
      vec![("_layout_root", serde_json::json!({ "session": { "procedure": "getSesssion" } }))],
    );
    let err = validate_procedure_references(&manifest, &skeleton).unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("Layout \"_layout_root\""), "should mention layout id");
    assert!(msg.contains("Did you mean: getSession?"));
  }
}
