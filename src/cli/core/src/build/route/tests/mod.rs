/* src/cli/core/src/build/route/tests/mod.rs */

mod ref_graph;
mod validation;

use std::collections::BTreeMap;

use super::helpers::path_to_filename;
use super::manifest::{did_you_mean, levenshtein};
use super::types::{SkeletonLayout, SkeletonOutput, SkeletonRoute};

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

// -- Shared test fixtures --

pub(super) fn make_manifest(names: &[&str]) -> seam_codegen::Manifest {
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
pub(super) fn make_skeleton_ext(
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
				head_meta: None,
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

pub(super) fn make_skeleton(
	routes: Vec<(&str, serde_json::Value)>,
	layouts: Vec<(&str, serde_json::Value)>,
) -> SkeletonOutput {
	make_skeleton_ext(
		routes.into_iter().map(|(p, l)| (p, l, None)).collect(),
		layouts.into_iter().map(|(id, l)| (id, l, None)).collect(),
	)
}
