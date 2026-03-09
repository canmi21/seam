/* src/cli/core/src/build/route/tests/ref_graph.rs */

use std::collections::BTreeMap;

use super::super::ref_graph::{
	build_reference_graph, generate_route_procedures_ts, inject_route_procedures,
	validate_handoff_consistency, validate_procedure_references, warn_unused_queries,
};
use super::super::types::{RouteManifest, RouteManifestEntry};
use super::{make_manifest, make_skeleton, make_skeleton_ext};

// -- validate_handoff_consistency tests --

#[test]
fn handoff_no_conflict() {
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
	validate_handoff_consistency(&graph);
}

#[test]
fn handoff_different_procedures() {
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

	assert_eq!(graph.all_procedures.len(), 2);
	assert!(graph.all_procedures.contains("getHomeData"));
	assert!(graph.all_procedures.contains("getSession"));

	assert_eq!(graph.consumers["getHomeData"].len(), 1);
	assert!(graph.consumers["getHomeData"][0].source.starts_with("Route"));
	assert_eq!(graph.consumers["getSession"].len(), 1);
	assert!(graph.consumers["getSession"][0].source.starts_with("Layout"));

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
	let manifest = make_manifest(&["getUser"]);
	let skeleton = make_skeleton_ext(
		vec![("/", serde_json::json!({ "user": { "procedure": "getUser" } }), Some("root"))],
		vec![("root", serde_json::json!({ "auth": { "procedure": "getUser" } }), None)],
	);
	let graph = build_reference_graph(&manifest, &skeleton);

	assert_eq!(graph.route_deps["/"].len(), 2);

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
				projections: None,
				prerender: None,
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
	assert!(content.contains("\"getUser\": { ttl: 30"));
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
	assert!(content.contains("prefetchable: {"));
	let prefetchable_section = content.split("prefetchable: {").nth(1).unwrap();
	let section_end = prefetchable_section.find('}').unwrap();
	let inner = prefetchable_section[..section_end].trim();
	assert!(inner.is_empty(), "expected empty prefetchable, got: {inner}");

	let _ = std::fs::remove_dir_all(&dir);
}
