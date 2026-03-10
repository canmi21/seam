/* src/cli/core/src/build/route/tests/output_mode.rs */

use std::collections::BTreeMap;

use crate::build::route::process::apply_output_mode;
use crate::build::route::types::{RouteManifest, RouteManifestEntry};
use crate::build::run::steps::has_prerender_routes;
use crate::config::OutputMode;

fn make_route_manifest(routes: Vec<(&str, Option<bool>)>) -> RouteManifest {
	RouteManifest {
		_meta: None,
		layouts: BTreeMap::new(),
		routes: routes
			.into_iter()
			.map(|(path, prerender)| {
				(
					path.to_string(),
					RouteManifestEntry {
						template: None,
						templates: None,
						layout: None,
						loaders: serde_json::Value::Null,
						head_meta: None,
						i18n_keys: None,
						assets: None,
						procedures: None,
						projections: None,
						prerender,
					},
				)
			})
			.collect(),
		data_id: None,
		i18n: None,
	}
}

#[test]
fn static_mode_forces_all_prerender() {
	let mut manifest =
		make_route_manifest(vec![("/", None), ("/about", Some(true)), ("/contact", Some(false))]);
	apply_output_mode(&mut manifest, OutputMode::Static);

	assert_eq!(manifest.routes["/"].prerender, Some(true));
	assert_eq!(manifest.routes["/about"].prerender, Some(true));
	assert_eq!(manifest.routes["/contact"].prerender, Some(true));
}

#[test]
fn server_mode_clears_prerender() {
	let mut manifest =
		make_route_manifest(vec![("/", None), ("/about", Some(true)), ("/contact", Some(false))]);
	apply_output_mode(&mut manifest, OutputMode::Server);

	assert_eq!(manifest.routes["/"].prerender, None);
	assert_eq!(manifest.routes["/about"].prerender, None);
	assert_eq!(manifest.routes["/contact"].prerender, None);
}

#[test]
fn hybrid_mode_preserves_explicit() {
	let mut manifest =
		make_route_manifest(vec![("/", None), ("/about", Some(true)), ("/contact", Some(false))]);
	apply_output_mode(&mut manifest, OutputMode::Hybrid);

	assert_eq!(manifest.routes["/"].prerender, None);
	assert_eq!(manifest.routes["/about"].prerender, Some(true));
	assert_eq!(manifest.routes["/contact"].prerender, Some(false));
}

// -- has_prerender_routes --

fn make_skeleton_with_prerender(
	routes: Vec<(&str, Option<bool>)>,
) -> crate::build::route::types::SkeletonOutput {
	use crate::build::route::types::{SkeletonOutput, SkeletonRoute};
	SkeletonOutput {
		routes: routes
			.into_iter()
			.map(|(path, prerender)| SkeletonRoute {
				path: path.to_string(),
				loaders: serde_json::Value::Null,
				axes: None,
				variants: None,
				mock_html: None,
				locale_variants: None,
				mock: serde_json::Value::Null,
				page_schema: None,
				layout: None,
				head_meta: None,
				i18n_keys: None,
				prerender,
			})
			.collect(),
		source_file_map: None,
		layouts: vec![],
		warnings: vec![],
		cache: None,
	}
}

#[test]
fn has_prerender_static_always_true() {
	let skeleton = make_skeleton_with_prerender(vec![("/", None)]);
	assert!(has_prerender_routes(&skeleton, OutputMode::Static));
}

#[test]
fn has_prerender_server_always_false() {
	let skeleton = make_skeleton_with_prerender(vec![("/about", Some(true))]);
	assert!(!has_prerender_routes(&skeleton, OutputMode::Server));
}

#[test]
fn has_prerender_hybrid_with_prerender_route() {
	let skeleton = make_skeleton_with_prerender(vec![("/", None), ("/about", Some(true))]);
	assert!(has_prerender_routes(&skeleton, OutputMode::Hybrid));
}

#[test]
fn has_prerender_hybrid_without_prerender_route() {
	let skeleton = make_skeleton_with_prerender(vec![("/", None), ("/contact", Some(false))]);
	assert!(!has_prerender_routes(&skeleton, OutputMode::Hybrid));
}
