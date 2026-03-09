/* src/cli/core/src/build/route/tests/validation.rs */

use std::collections::BTreeMap;

use super::super::manifest::{extract_manifest_command, validate_invalidates};
use super::super::ref_graph::{build_reference_graph, validate_procedure_references};
use super::super::types::RouteManifestEntry;
use super::{make_manifest, make_skeleton};
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

// -- head_meta serialization tests --

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
		projections: None,
		prerender: None,
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
		projections: None,
		prerender: None,
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
fn validate_invalidates_warns_on_query() {
	use seam_codegen::{InvalidateTarget, ProcedureType};
	let manifest = make_manifest_with_procedures(vec![(
		"getPost",
		ProcedureType::Query,
		Some(vec![InvalidateTarget { query: "getPost".to_string(), mapping: None }]),
	)]);
	// Non-command with invalidates should warn but not error
	assert!(validate_invalidates(&manifest).is_ok());
}

#[test]
fn extract_jtd_fields_basic() {
	use super::super::manifest::extract_jtd_fields;
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
