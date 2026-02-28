/* packages/cli/core/src/build/route/tests.rs */

use std::collections::BTreeMap;

use super::super::skeleton::extract_head_metadata;
use super::helpers::path_to_filename;
use super::manifest::{
  did_you_mean, extract_manifest_command, levenshtein, validate_procedure_references,
};
use super::types::{RouteManifestEntry, SkeletonLayout, SkeletonOutput, SkeletonRoute};

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

fn make_manifest(names: &[&str]) -> crate::manifest::Manifest {
  use crate::manifest::{ProcedureSchema, ProcedureType};
  let mut procedures = BTreeMap::new();
  for name in names {
    procedures.insert(
      name.to_string(),
      ProcedureSchema {
        proc_type: ProcedureType::Query,
        input: serde_json::Value::Null,
        output: serde_json::Value::Null,
        error: None,
      },
    );
  }
  crate::manifest::Manifest { version: 1, procedures }
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
        axes: Some(vec![]),
        variants: Some(vec![]),
        mock_html: Some(String::new()),
        locale_variants: None,
        mock: serde_json::Value::Null,
        page_schema: None,
        layout: None,
        i18n_keys: None,
      })
      .collect(),
    layouts: layouts
      .into_iter()
      .map(|(id, loaders)| SkeletonLayout {
        id: id.to_string(),
        html: Some(String::new()),
        locale_html: None,
        loaders,
        i18n_keys: None,
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
    template: Some("templates/index.html".to_string()),
    templates: None,
    layout: None,
    loaders: serde_json::Value::Null,
    head_meta: None,
    i18n_keys: None,
  };
  let json = serde_json::to_string(&entry).unwrap();
  assert!(!json.contains("head_meta"), "None head_meta should be skipped in JSON");
}

#[test]
fn head_meta_serialization_includes_some() {
  let entry = RouteManifestEntry {
    template: Some("templates/index.html".to_string()),
    templates: None,
    layout: Some("root".to_string()),
    loaders: serde_json::Value::Null,
    head_meta: Some("<title><!--seam:t--></title>".to_string()),
    i18n_keys: None,
  };
  let json = serde_json::to_string(&entry).unwrap();
  assert!(json.contains("head_meta"), "Some head_meta should be present in JSON");
  assert!(json.contains("<!--seam:t-->"), "head_meta value preserved");
}

#[test]
fn extract_manifest_command_success() {
  let dir = std::env::temp_dir().join("seam-test-manifest-cmd");
  let _ = std::fs::remove_dir_all(&dir);
  std::fs::create_dir_all(&dir).unwrap();
  let out = dir.join("output");

  let manifest_json = r#"{"version":1,"procedures":{"getUser":{"type":"query","input":{"properties":{"username":{"type":"string"}}},"output":{"properties":{"login":{"type":"string"}}}}}}"#;
  let command = format!("echo '{manifest_json}'");

  let manifest = extract_manifest_command(&dir, &command, &out).unwrap();
  assert_eq!(manifest.procedures.len(), 1);
  assert!(manifest.procedures.contains_key("getUser"));

  // Verify seam-manifest.json was written
  let written = std::fs::read_to_string(out.join("seam-manifest.json")).unwrap();
  let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
  assert!(parsed["procedures"]["getUser"].is_object());

  let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn extract_manifest_command_failure() {
  let dir = std::env::temp_dir().join("seam-test-manifest-cmd-fail");
  let _ = std::fs::remove_dir_all(&dir);
  std::fs::create_dir_all(&dir).unwrap();
  let out = dir.join("output");

  let err = extract_manifest_command(&dir, "exit 1", &out).unwrap_err();
  assert!(err.to_string().contains("manifest command failed"));

  let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn extract_manifest_command_invalid_json() {
  let dir = std::env::temp_dir().join("seam-test-manifest-cmd-json");
  let _ = std::fs::remove_dir_all(&dir);
  std::fs::create_dir_all(&dir).unwrap();
  let out = dir.join("output");

  let err = extract_manifest_command(&dir, "echo 'not json'", &out).unwrap_err();
  assert!(err.to_string().contains("failed to parse manifest JSON"));

  let _ = std::fs::remove_dir_all(&dir);
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
