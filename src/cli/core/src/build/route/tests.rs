/* src/cli/core/src/build/route/tests.rs */

use std::collections::BTreeMap;

use super::helpers::path_to_filename;
use super::manifest::{did_you_mean, extract_manifest_command, levenshtein};
use super::ref_graph::{
  build_reference_graph, validate_handoff_consistency, validate_procedure_references,
  warn_unused_queries,
};
use super::types::{RouteManifestEntry, SkeletonLayout, SkeletonOutput, SkeletonRoute};
use seam_skeleton::extract_head_metadata;

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

fn make_manifest(names: &[&str]) -> seam_codegen::Manifest {
  use seam_codegen::{ProcedureSchema, ProcedureType};
  let mut procedures = BTreeMap::new();
  for name in names {
    procedures.insert(
      name.to_string(),
      ProcedureSchema {
        proc_type: ProcedureType::Query,
        input: serde_json::Value::Null,
        output: Some(serde_json::Value::Null),
        chunk_output: None,
        error: None,
        invalidates: None,
        context: None,
        transport: None,
        suppress: None,
        cache: None,
      },
    );
  }
  seam_codegen::Manifest {
    version: 1,
    context: BTreeMap::new(),
    procedures,
    channels: BTreeMap::new(),
    transport_defaults: BTreeMap::new(),
  }
}

/// Build a skeleton with routes and layouts.
/// Route tuples: (path, loaders, optional_layout_id)
/// Layout tuples: (id, loaders, optional_parent_id)
fn make_skeleton_ext(
  routes: Vec<(&str, serde_json::Value, Option<&str>)>,
  layouts: Vec<(&str, serde_json::Value, Option<&str>)>,
) -> SkeletonOutput {
  SkeletonOutput {
    routes: routes
      .into_iter()
      .map(|(path, loaders, layout)| SkeletonRoute {
        path: path.to_string(),
        loaders,
        axes: Some(vec![]),
        variants: Some(vec![]),
        mock_html: Some(String::new()),
        locale_variants: None,
        mock: serde_json::Value::Null,
        page_schema: None,
        layout: layout.map(String::from),
        i18n_keys: None,
      })
      .collect(),
    source_file_map: None,
    layouts: layouts
      .into_iter()
      .map(|(id, loaders, parent)| SkeletonLayout {
        id: id.to_string(),
        html: Some(String::new()),
        locale_html: None,
        loaders,
        i18n_keys: None,
        parent: parent.map(String::from),
      })
      .collect(),
    warnings: vec![],
    cache: None,
  }
}

fn make_skeleton(
  routes: Vec<(&str, serde_json::Value)>,
  layouts: Vec<(&str, serde_json::Value)>,
) -> SkeletonOutput {
  make_skeleton_ext(
    routes.into_iter().map(|(p, l)| (p, l, None)).collect(),
    layouts.into_iter().map(|(id, l)| (id, l, None)).collect(),
  )
}

#[test]
fn validate_all_procedures_exist() {
  let manifest = make_manifest(&["getHomeData", "getSession"]);
  let skeleton = make_skeleton(
    vec![("/", serde_json::json!({ "page": { "procedure": "getHomeData" } }))],
    vec![("_layout_root", serde_json::json!({ "session": { "procedure": "getSession" } }))],
  );
  let graph = build_reference_graph(&manifest, &skeleton);
  assert!(validate_procedure_references(&graph).is_ok());
}

#[test]
fn validate_missing_procedure_in_route() {
  let manifest = make_manifest(&["getHomeData", "getSession"]);
  let skeleton = make_skeleton(
    vec![("/", serde_json::json!({ "page": { "procedure": "getNonexistent" } }))],
    vec![],
  );
  let graph = build_reference_graph(&manifest, &skeleton);
  let err = validate_procedure_references(&graph).unwrap_err();
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
  let graph = build_reference_graph(&manifest, &skeleton);
  let err = validate_procedure_references(&graph).unwrap_err();
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
    assets: None,
    procedures: None,
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
    assets: None,
    procedures: None,
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
  let graph = build_reference_graph(&manifest, &skeleton);
  let err = validate_procedure_references(&graph).unwrap_err();
  let msg = err.to_string();
  assert!(msg.contains("Layout \"_layout_root\""), "should mention layout id");
  assert!(msg.contains("Did you mean: getSession?"));
}

// -- validate_invalidates tests --

use super::manifest::validate_invalidates;

fn make_manifest_with_procedures(
  entries: Vec<(&str, seam_codegen::ProcedureType, Option<Vec<seam_codegen::InvalidateTarget>>)>,
) -> seam_codegen::Manifest {
  use seam_codegen::ProcedureSchema;
  let mut procedures = BTreeMap::new();
  for (name, proc_type, invalidates) in entries {
    procedures.insert(
      name.to_string(),
      ProcedureSchema {
        proc_type,
        input: serde_json::json!({"properties": {"id": {"type": "string"}}}),
        output: Some(serde_json::Value::Null),
        chunk_output: None,
        error: None,
        invalidates,
        context: None,
        transport: None,
        suppress: None,
        cache: None,
      },
    );
  }
  seam_codegen::Manifest {
    version: 2,
    context: BTreeMap::new(),
    procedures,
    channels: BTreeMap::new(),
    transport_defaults: BTreeMap::new(),
  }
}

#[test]
fn validate_invalidates_valid() {
  use seam_codegen::{InvalidateTarget, ProcedureType};
  let manifest = make_manifest_with_procedures(vec![
    ("getPost", ProcedureType::Query, None),
    (
      "updatePost",
      ProcedureType::Command,
      Some(vec![InvalidateTarget { query: "getPost".to_string(), mapping: None }]),
    ),
  ]);
  assert!(validate_invalidates(&manifest).is_ok());
}

#[test]
fn validate_invalidates_unknown_procedure() {
  use seam_codegen::{InvalidateTarget, ProcedureType};
  let manifest = make_manifest_with_procedures(vec![(
    "updatePost",
    ProcedureType::Command,
    Some(vec![InvalidateTarget { query: "nonExistent".to_string(), mapping: None }]),
  )]);
  let err = validate_invalidates(&manifest).unwrap_err();
  let msg = err.to_string();
  assert!(msg.contains("\"updatePost\""), "should mention command name");
  assert!(msg.contains("\"nonExistent\""), "should mention missing procedure");
}

#[test]
fn validate_invalidates_wrong_kind() {
  use seam_codegen::{InvalidateTarget, ProcedureType};
  let manifest = make_manifest_with_procedures(vec![
    ("otherCommand", ProcedureType::Command, None),
    (
      "updatePost",
      ProcedureType::Command,
      Some(vec![InvalidateTarget { query: "otherCommand".to_string(), mapping: None }]),
    ),
  ]);
  let err = validate_invalidates(&manifest).unwrap_err();
  let msg = err.to_string();
  assert!(msg.contains("command (expected query)"), "should mention wrong kind");
}

#[test]
fn validate_invalidates_did_you_mean() {
  use seam_codegen::{InvalidateTarget, ProcedureType};
  let manifest = make_manifest_with_procedures(vec![
    ("getPost", ProcedureType::Query, None),
    (
      "updatePost",
      ProcedureType::Command,
      Some(vec![InvalidateTarget { query: "getPots".to_string(), mapping: None }]),
    ),
  ]);
  let err = validate_invalidates(&manifest).unwrap_err();
  assert!(err.to_string().contains("Did you mean: getPost?"));
}

#[test]
fn extract_jtd_fields_basic() {
  use super::manifest::extract_jtd_fields;
  let schema = serde_json::json!({
    "properties": { "name": { "type": "string" }, "age": { "type": "int32" } },
    "optionalProperties": { "email": { "type": "string" } }
  });
  let fields = extract_jtd_fields(&schema);
  assert!(fields.contains("name"));
  assert!(fields.contains("age"));
  assert!(fields.contains("email"));
  assert_eq!(fields.len(), 3);
}

// -- validate_handoff_consistency tests --

#[test]
fn handoff_no_conflict() {
  // Same procedure in handoff-only loaders -> no warning (function runs without panic)
  let manifest = make_manifest(&["getTheme"]);
  let skeleton = make_skeleton(
    vec![(
      "/dashboard",
      serde_json::json!({
        "theme": { "procedure": "getTheme", "handoff": "client" },
        "prefs": { "procedure": "getTheme", "handoff": "client" },
      }),
    )],
    vec![],
  );
  let graph = build_reference_graph(&manifest, &skeleton);
  validate_handoff_consistency(&graph);
}

#[test]
fn handoff_conflict_warns() {
  // Same procedure in handoff + non-handoff -> warning (should not panic)
  let manifest = make_manifest(&["getUserPrefs"]);
  let skeleton = make_skeleton(
    vec![(
      "/dashboard",
      serde_json::json!({
        "theme": { "procedure": "getUserPrefs", "handoff": "client" },
        "userData": { "procedure": "getUserPrefs" },
      }),
    )],
    vec![],
  );
  let graph = build_reference_graph(&manifest, &skeleton);
  // This emits a warning via ui::warn but does not error
  validate_handoff_consistency(&graph);
}

#[test]
fn handoff_different_procedures() {
  // Different procedures -> no warning
  let manifest = make_manifest(&["getTheme", "getDashboard"]);
  let skeleton = make_skeleton(
    vec![(
      "/dashboard",
      serde_json::json!({
        "theme": { "procedure": "getTheme", "handoff": "client" },
        "data": { "procedure": "getDashboard" },
      }),
    )],
    vec![],
  );
  let graph = build_reference_graph(&manifest, &skeleton);
  validate_handoff_consistency(&graph);
}

// -- ref_graph tests --

#[test]
fn ref_graph_basic() {
  let manifest = make_manifest(&["getHomeData", "getSession"]);
  let skeleton = make_skeleton_ext(
    vec![("/", serde_json::json!({ "page": { "procedure": "getHomeData" } }), Some("root"))],
    vec![("root", serde_json::json!({ "session": { "procedure": "getSession" } }), None)],
  );
  let graph = build_reference_graph(&manifest, &skeleton);

  // all_procedures from manifest
  assert_eq!(graph.all_procedures.len(), 2);
  assert!(graph.all_procedures.contains("getHomeData"));
  assert!(graph.all_procedures.contains("getSession"));

  // consumers: getHomeData referenced by route, getSession by layout
  assert_eq!(graph.consumers["getHomeData"].len(), 1);
  assert!(!graph.consumers["getHomeData"][0].is_layout);
  assert_eq!(graph.consumers["getSession"].len(), 1);
  assert!(graph.consumers["getSession"][0].is_layout);

  // route_deps: "/" has both procedures (own + layout chain)
  let deps = &graph.route_deps["/"];
  let procs: Vec<&str> = deps.iter().map(|r| r.procedure.as_str()).collect();
  assert!(procs.contains(&"getHomeData"));
  assert!(procs.contains(&"getSession"));
}

#[test]
fn ref_graph_layout_chain() {
  let manifest = make_manifest(&["getData", "getAuth", "getTheme"]);
  let skeleton = make_skeleton_ext(
    vec![("/dashboard", serde_json::json!({ "data": { "procedure": "getData" } }), Some("app"))],
    vec![
      ("app", serde_json::json!({ "auth": { "procedure": "getAuth" } }), Some("root")),
      ("root", serde_json::json!({ "theme": { "procedure": "getTheme" } }), None),
    ],
  );
  let graph = build_reference_graph(&manifest, &skeleton);

  // route_deps for /dashboard should include all 3 procedures
  let deps = &graph.route_deps["/dashboard"];
  let procs: Vec<&str> = deps.iter().map(|r| r.procedure.as_str()).collect();
  assert_eq!(procs.len(), 3);
  assert!(procs.contains(&"getData"));
  assert!(procs.contains(&"getAuth"));
  assert!(procs.contains(&"getTheme"));
}

#[test]
fn ref_graph_handoff_tracking() {
  let manifest = make_manifest(&["getUser"]);
  let skeleton = make_skeleton(
    vec![(
      "/profile",
      serde_json::json!({
        "server": { "procedure": "getUser" },
        "client": { "procedure": "getUser", "handoff": "client" },
      }),
    )],
    vec![],
  );
  let graph = build_reference_graph(&manifest, &skeleton);

  let deps = &graph.route_deps["/profile"];
  let handoff_count = deps.iter().filter(|r| r.handoff).count();
  let non_handoff_count = deps.iter().filter(|r| !r.handoff).count();
  assert_eq!(handoff_count, 1);
  assert_eq!(non_handoff_count, 1);
}

#[test]
fn ref_graph_empty_loaders() {
  let manifest = make_manifest(&["getUser"]);
  let skeleton = make_skeleton(vec![("/empty", serde_json::json!({}))], vec![]);
  let graph = build_reference_graph(&manifest, &skeleton);

  assert!(graph.route_deps["/empty"].is_empty());
  assert!(graph.consumers.is_empty());
}

#[test]
fn ref_graph_route_procedures_dedup() {
  // Same procedure referenced in both route and layout -> route_deps has both refs,
  // but inject_route_procedures should produce unique sorted list
  let manifest = make_manifest(&["getUser"]);
  let skeleton = make_skeleton_ext(
    vec![("/", serde_json::json!({ "user": { "procedure": "getUser" } }), Some("root"))],
    vec![("root", serde_json::json!({ "auth": { "procedure": "getUser" } }), None)],
  );
  let graph = build_reference_graph(&manifest, &skeleton);

  // route_deps has 2 refs (one from route, one from layout)
  assert_eq!(graph.route_deps["/"].len(), 2);

  // After inject, procedures should be deduplicated
  use super::ref_graph::inject_route_procedures;
  use super::types::RouteManifest;
  let mut route_manifest = RouteManifest {
    layouts: BTreeMap::new(),
    routes: BTreeMap::from([(
      "/".to_string(),
      RouteManifestEntry {
        template: Some("templates/index.html".to_string()),
        templates: None,
        layout: Some("root".to_string()),
        loaders: serde_json::json!({}),
        head_meta: None,
        i18n_keys: None,
        assets: None,
        procedures: None,
      },
    )]),
    data_id: None,
    i18n: None,
  };
  inject_route_procedures(&mut route_manifest, &graph);
  let procs = route_manifest.routes["/"].procedures.as_ref().unwrap();
  assert_eq!(procs, &["getUser"]);
}

#[test]
fn validate_from_graph_passes() {
  let manifest = make_manifest(&["getHomeData", "getSession"]);
  let skeleton = make_skeleton(
    vec![("/", serde_json::json!({ "page": { "procedure": "getHomeData" } }))],
    vec![("_layout_root", serde_json::json!({ "session": { "procedure": "getSession" } }))],
  );
  let graph = build_reference_graph(&manifest, &skeleton);
  assert!(validate_procedure_references(&graph).is_ok());
}

#[test]
fn validate_from_graph_fails() {
  let manifest = make_manifest(&["getHomeData"]);
  let skeleton = make_skeleton(
    vec![("/", serde_json::json!({ "page": { "procedure": "getMissing" } }))],
    vec![],
  );
  let graph = build_reference_graph(&manifest, &skeleton);
  let err = validate_procedure_references(&graph).unwrap_err();
  let msg = err.to_string();
  assert!(msg.contains("unknown procedure reference"));
  assert!(msg.contains("\"getMissing\""));
  assert!(msg.contains("Route \"/\""));
}

// -- warn_unused_queries tests --

fn make_manifest_typed(
  entries: Vec<(&str, seam_codegen::ProcedureType, Option<Vec<String>>)>,
) -> seam_codegen::Manifest {
  use seam_codegen::ProcedureSchema;
  let mut procedures = BTreeMap::new();
  for (name, proc_type, suppress) in entries {
    procedures.insert(
      name.to_string(),
      ProcedureSchema {
        proc_type,
        input: serde_json::Value::Null,
        output: Some(serde_json::Value::Null),
        chunk_output: None,
        error: None,
        invalidates: None,
        context: None,
        transport: None,
        suppress,
        cache: None,
      },
    );
  }
  seam_codegen::Manifest {
    version: 2,
    context: BTreeMap::new(),
    procedures,
    channels: BTreeMap::new(),
    transport_defaults: BTreeMap::new(),
  }
}

#[test]
fn unused_query_detected() {
  use seam_codegen::ProcedureType;
  let manifest = make_manifest_typed(vec![("getArchive", ProcedureType::Query, None)]);
  let skeleton = make_skeleton(vec![("/", serde_json::json!({}))], vec![]);
  let graph = build_reference_graph(&manifest, &skeleton);
  // Should warn but not panic
  warn_unused_queries(&graph, &manifest);
}

#[test]
fn used_query_not_warned() {
  use seam_codegen::ProcedureType;
  let manifest = make_manifest_typed(vec![("getHome", ProcedureType::Query, None)]);
  let skeleton =
    make_skeleton(vec![("/", serde_json::json!({ "page": { "procedure": "getHome" } }))], vec![]);
  let graph = build_reference_graph(&manifest, &skeleton);
  warn_unused_queries(&graph, &manifest);
}

#[test]
fn command_not_warned() {
  use seam_codegen::ProcedureType;
  let manifest = make_manifest_typed(vec![("createUser", ProcedureType::Command, None)]);
  let skeleton = make_skeleton(vec![("/", serde_json::json!({}))], vec![]);
  let graph = build_reference_graph(&manifest, &skeleton);
  warn_unused_queries(&graph, &manifest);
}

#[test]
fn subscription_not_warned() {
  use seam_codegen::ProcedureType;
  let manifest = make_manifest_typed(vec![("onUpdate", ProcedureType::Subscription, None)]);
  let skeleton = make_skeleton(vec![("/", serde_json::json!({}))], vec![]);
  let graph = build_reference_graph(&manifest, &skeleton);
  warn_unused_queries(&graph, &manifest);
}

#[test]
fn suppressed_query_skipped() {
  use seam_codegen::ProcedureType;
  let manifest = make_manifest_typed(vec![(
    "getArchive",
    ProcedureType::Query,
    Some(vec!["unused".to_string()]),
  )]);
  let skeleton = make_skeleton(vec![("/", serde_json::json!({}))], vec![]);
  let graph = build_reference_graph(&manifest, &skeleton);
  warn_unused_queries(&graph, &manifest);
}

#[test]
fn empty_manifest_no_warn() {
  let manifest = make_manifest_typed(vec![]);
  let skeleton = make_skeleton(vec![("/", serde_json::json!({}))], vec![]);
  let graph = build_reference_graph(&manifest, &skeleton);
  warn_unused_queries(&graph, &manifest);
}

// -- generate_route_procedures_ts tests --

use super::ref_graph::generate_route_procedures_ts;

fn make_manifest_with_cache(
  entries: Vec<(&str, seam_codegen::ProcedureType, Option<seam_codegen::CacheHint>)>,
) -> seam_codegen::Manifest {
  use seam_codegen::ProcedureSchema;
  let mut procedures: BTreeMap<String, ProcedureSchema> = BTreeMap::new();
  for (name, proc_type, cache) in entries {
    procedures.insert(
      name.to_string(),
      ProcedureSchema {
        proc_type,
        input: serde_json::Value::Null,
        output: Some(serde_json::Value::Null),
        chunk_output: None,
        error: None,
        invalidates: None,
        context: None,
        transport: None,
        suppress: None,
        cache,
      },
    );
  }
  seam_codegen::Manifest {
    version: 2,
    context: BTreeMap::new(),
    procedures,
    channels: BTreeMap::new(),
    transport_defaults: BTreeMap::new(),
  }
}

#[test]
fn route_procedures_ts_output_format() {
  use seam_codegen::{CacheHint, ProcedureType};
  let manifest = make_manifest_with_cache(vec![
    ("getHomeData", ProcedureType::Query, Some(CacheHint::Config { ttl: 60 })),
    ("getSession", ProcedureType::Query, None),
  ]);
  let skeleton = make_skeleton_ext(
    vec![(
      "/",
      serde_json::json!({ "page": { "procedure": "getHomeData" }, "session": { "procedure": "getSession" } }),
      None,
    )],
    vec![],
  );
  let graph = build_reference_graph(&manifest, &skeleton);

  let dir = std::env::temp_dir().join("seam-test-rp-format");
  let _ = std::fs::remove_dir_all(&dir);
  std::fs::create_dir_all(&dir).unwrap();
  let output = dir.join("route-procedures.ts");
  generate_route_procedures_ts(&graph, &manifest, &output).unwrap();

  let content = std::fs::read_to_string(&output).unwrap();
  assert!(content.contains("export const seamRouteProcedures = {"));
  assert!(content.contains("\"getHomeData\""));
  assert!(content.contains("\"getSession\""));
  assert!(content.contains("ttl: 60"));
  assert!(content.contains("} as const;"));
  assert!(content.contains("export type SeamRouteProcedures"));

  let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn route_procedures_only_cached_queries_in_prefetchable() {
  use seam_codegen::{CacheHint, ProcedureType};
  let manifest = make_manifest_with_cache(vec![
    ("getUser", ProcedureType::Query, Some(CacheHint::Config { ttl: 30 })),
    ("createUser", ProcedureType::Command, None),
    ("onUpdate", ProcedureType::Subscription, None),
    ("listPosts", ProcedureType::Query, None), // no cache
  ]);
  let skeleton = make_skeleton(
    vec![(
      "/",
      serde_json::json!({
        "user": { "procedure": "getUser" },
        "create": { "procedure": "createUser" },
        "update": { "procedure": "onUpdate" },
        "posts": { "procedure": "listPosts" },
      }),
    )],
    vec![],
  );
  let graph = build_reference_graph(&manifest, &skeleton);

  let dir = std::env::temp_dir().join("seam-test-rp-filter");
  let _ = std::fs::remove_dir_all(&dir);
  std::fs::create_dir_all(&dir).unwrap();
  let output = dir.join("route-procedures.ts");
  generate_route_procedures_ts(&graph, &manifest, &output).unwrap();

  let content = std::fs::read_to_string(&output).unwrap();
  // Only getUser in prefetchable (has cache config)
  assert!(content.contains("\"getUser\": { ttl: 30"));
  // createUser, onUpdate, listPosts not in prefetchable
  let prefetchable_section = content.split("prefetchable:").nth(1).unwrap();
  let section_end = prefetchable_section.find("},").unwrap();
  let prefetchable_block = &prefetchable_section[..section_end];
  assert!(!prefetchable_block.contains("createUser"));
  assert!(!prefetchable_block.contains("onUpdate"));
  assert!(!prefetchable_block.contains("listPosts"));

  let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn route_procedures_params_extracted() {
  use seam_codegen::{CacheHint, ProcedureType};
  let manifest = make_manifest_with_cache(vec![(
    "getUser",
    ProcedureType::Query,
    Some(CacheHint::Config { ttl: 30 }),
  )]);
  let skeleton = make_skeleton(
    vec![(
      "/user/:id",
      serde_json::json!({
        "user": { "procedure": "getUser", "params": { "id": { "from": "path" } } }
      }),
    )],
    vec![],
  );
  let graph = build_reference_graph(&manifest, &skeleton);

  let dir = std::env::temp_dir().join("seam-test-rp-params");
  let _ = std::fs::remove_dir_all(&dir);
  std::fs::create_dir_all(&dir).unwrap();
  let output = dir.join("route-procedures.ts");
  generate_route_procedures_ts(&graph, &manifest, &output).unwrap();

  let content = std::fs::read_to_string(&output).unwrap();
  assert!(content.contains("params: [\"id\"]"));

  let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn route_procedures_empty_without_cache() {
  use seam_codegen::ProcedureType;
  let manifest = make_manifest_with_cache(vec![("getUser", ProcedureType::Query, None)]);
  let skeleton =
    make_skeleton(vec![("/", serde_json::json!({ "user": { "procedure": "getUser" } }))], vec![]);
  let graph = build_reference_graph(&manifest, &skeleton);

  let dir = std::env::temp_dir().join("seam-test-rp-empty");
  let _ = std::fs::remove_dir_all(&dir);
  std::fs::create_dir_all(&dir).unwrap();
  let output = dir.join("route-procedures.ts");
  generate_route_procedures_ts(&graph, &manifest, &output).unwrap();

  let content = std::fs::read_to_string(&output).unwrap();
  // prefetchable block should be empty (no entries)
  assert!(content.contains("prefetchable: {"));
  let prefetchable_section = content.split("prefetchable: {").nth(1).unwrap();
  let section_end = prefetchable_section.find('}').unwrap();
  let inner = prefetchable_section[..section_end].trim();
  assert!(inner.is_empty(), "expected empty prefetchable, got: {inner}");

  let _ = std::fs::remove_dir_all(&dir);
}
