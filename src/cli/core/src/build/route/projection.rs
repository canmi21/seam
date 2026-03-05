/* src/cli/core/src/build/route/projection.rs */

// Build-time projection generation: analyze template slots and compute
// per-loader field projections for schema narrowing.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use anyhow::Result;

use super::types::RouteManifest;
use seam_skeleton::slot_paths::{collect_slot_paths, group_by_loader};

/// Read a template file and collect its slot paths.
fn template_slot_paths(out_dir: &Path, template_rel: &str) -> BTreeSet<String> {
	let path = out_dir.join(template_rel);
	match std::fs::read_to_string(&path) {
		Ok(content) => collect_slot_paths(&content),
		Err(_) => BTreeSet::new(),
	}
}

/// Collect slot paths from a manifest entry's template(s), unioning across locales.
fn entry_slot_paths(
	template: Option<&str>,
	templates: Option<&BTreeMap<String, String>>,
	out_dir: &Path,
) -> BTreeSet<String> {
	let mut paths = BTreeSet::new();
	if let Some(t) = template {
		paths.extend(template_slot_paths(out_dir, t));
	}
	if let Some(ts) = templates {
		for rel in ts.values() {
			paths.extend(template_slot_paths(out_dir, rel));
		}
	}
	paths
}

/// Check if a loader config has `narrow: false` or `handoff: "client"`.
fn should_skip_loader(loader_val: &serde_json::Value) -> bool {
	if loader_val.get("narrow") == Some(&serde_json::Value::Bool(false)) {
		return true;
	}
	if loader_val.get("handoff").and_then(|v| v.as_str()) == Some("client") {
		return true;
	}
	false
}

/// Find a loader config by key from route loaders or layout chain loaders.
fn find_loader_config<'a>(
	key: &str,
	route_loaders: &'a serde_json::Value,
	layouts: &'a BTreeMap<String, super::types::LayoutManifestEntry>,
	layout_id: Option<&str>,
) -> Option<&'a serde_json::Value> {
	// Check route-level loaders first
	if let Some(val) = route_loaders.as_object().and_then(|obj| obj.get(key)) {
		return Some(val);
	}
	// Walk layout chain
	let mut current = layout_id.map(str::to_string);
	while let Some(id) = current {
		if let Some(layout) = layouts.get(&id) {
			if let Some(val) = layout.loaders.as_object().and_then(|obj| obj.get(key)) {
				return Some(val);
			}
			current = layout.parent.clone();
		} else {
			break;
		}
	}
	None
}

/// Compute projections for all routes and inject into route manifest.
#[allow(clippy::unnecessary_wraps)]
pub(crate) fn inject_route_projections(
	route_manifest: &mut RouteManifest,
	out_dir: &Path,
) -> Result<()> {
	// Pre-compute layout slot paths for reuse
	let layout_slot_paths: BTreeMap<String, BTreeSet<String>> = route_manifest
		.layouts
		.iter()
		.map(|(id, entry)| {
			let paths = entry_slot_paths(entry.template.as_deref(), entry.templates.as_ref(), out_dir);
			(id.clone(), paths)
		})
		.collect();

	// Snapshot layout entries for lookup during mutable iteration over routes
	let layouts_snapshot = route_manifest.layouts.clone();

	for entry in route_manifest.routes.values_mut() {
		let page_paths = entry_slot_paths(entry.template.as_deref(), entry.templates.as_ref(), out_dir);

		if page_paths.is_empty() && entry.layout.is_none() {
			continue;
		}

		// Union page + layout chain slot paths
		let mut all_paths = page_paths;
		if let Some(ref layout_id) = entry.layout {
			let mut current = Some(layout_id.clone());
			while let Some(id) = current {
				if let Some(lp) = layout_slot_paths.get(&id) {
					all_paths.extend(lp.iter().cloned());
				}
				current = layouts_snapshot.get(&id).and_then(|e| e.parent.clone());
			}
		}

		if all_paths.is_empty() {
			continue;
		}

		let grouped = group_by_loader(&all_paths);
		let mut projections: BTreeMap<String, Vec<String>> = BTreeMap::new();

		for (loader_key, fields) in &grouped {
			// Entire value used -> skip narrowing for this loader
			if fields.contains("") {
				continue;
			}

			// Check loader config for narrow: false or handoff: "client"
			if let Some(loader_val) =
				find_loader_config(loader_key, &entry.loaders, &layouts_snapshot, entry.layout.as_deref())
				&& should_skip_loader(loader_val)
			{
				continue;
			}

			let field_list: Vec<String> = fields.iter().cloned().collect();
			projections.insert(loader_key.clone(), field_list);
		}

		if !projections.is_empty() {
			entry.projections = Some(projections);
		}
	}

	Ok(())
}

/// Print info when narrowing applies to any route.
pub(crate) fn report_narrowing_savings(route_manifest: &RouteManifest) {
	let mut narrowed_count = 0u32;
	for entry in route_manifest.routes.values() {
		if entry.projections.is_some() {
			narrowed_count += 1;
		}
	}
	if narrowed_count > 0 {
		crate::ui::detail_ok(&format!("{narrowed_count} routes with schema narrowing"));
	}
}

#[cfg(test)]
mod tests {
	use super::super::types::RouteManifestEntry;
	use super::*;
	use serde_json::json;

	fn make_entry(
		template_content: &str,
		loaders: serde_json::Value,
		layout: Option<String>,
	) -> (RouteManifest, tempfile::TempDir) {
		let dir = tempfile::tempdir().unwrap();
		let templates = dir.path().join("templates");
		std::fs::create_dir_all(&templates).unwrap();
		let tmpl_file = templates.join("test.html");
		std::fs::write(&tmpl_file, template_content).unwrap();

		let manifest = RouteManifest {
			layouts: BTreeMap::new(),
			routes: BTreeMap::from([(
				"/test".to_string(),
				RouteManifestEntry {
					template: Some("templates/test.html".to_string()),
					templates: None,
					layout,
					loaders,
					head_meta: None,
					i18n_keys: None,
					assets: None,
					procedures: None,
					projections: None,
				},
			)]),
			data_id: None,
			i18n: None,
		};
		(manifest, dir)
	}

	#[test]
	fn basic_projection() {
		let tmpl = "<h1><!--seam:user.name--></h1><p><!--seam:user.email--></p>";
		let loaders = json!({ "user": { "procedure": "getUser" } });
		let (mut manifest, dir) = make_entry(tmpl, loaders, None);

		inject_route_projections(&mut manifest, dir.path()).unwrap();

		let entry = &manifest.routes["/test"];
		let proj = entry.projections.as_ref().expect("projections should exist");
		let user_fields = &proj["user"];
		assert!(user_fields.contains(&"name".to_string()));
		assert!(user_fields.contains(&"email".to_string()));
	}

	#[test]
	fn handoff_skip() {
		let tmpl = "<h1><!--seam:user.name--></h1>";
		let loaders = json!({ "user": { "procedure": "getUser", "handoff": "client" } });
		let (mut manifest, dir) = make_entry(tmpl, loaders, None);

		inject_route_projections(&mut manifest, dir.path()).unwrap();

		let entry = &manifest.routes["/test"];
		assert!(entry.projections.is_none());
	}

	#[test]
	fn narrow_false_skip() {
		let tmpl = "<h1><!--seam:user.name--></h1>";
		let loaders = json!({ "user": { "procedure": "getUser", "narrow": false } });
		let (mut manifest, dir) = make_entry(tmpl, loaders, None);

		inject_route_projections(&mut manifest, dir.path()).unwrap();

		let entry = &manifest.routes["/test"];
		assert!(entry.projections.is_none());
	}

	#[test]
	fn single_segment_skip() {
		let tmpl = "<!--seam:each:items-->item<!--seam:endeach-->";
		let loaders = json!({ "items": { "procedure": "getItems" } });
		let (mut manifest, dir) = make_entry(tmpl, loaders, None);

		inject_route_projections(&mut manifest, dir.path()).unwrap();

		let entry = &manifest.routes["/test"];
		// "items" without a dot -> entire value used -> skip narrowing
		assert!(entry.projections.is_none());
	}

	#[test]
	fn layout_chain_merge() {
		let dir = tempfile::tempdir().unwrap();
		let templates = dir.path().join("templates");
		std::fs::create_dir_all(&templates).unwrap();

		std::fs::write(templates.join("page.html"), "<p><!--seam:user.name--></p>").unwrap();
		std::fs::write(
			templates.join("layout.html"),
			"<nav><!--seam:user.avatar:attr:src--><img></nav><!--seam:outlet-->",
		)
		.unwrap();

		use super::super::types::LayoutManifestEntry;
		let mut manifest = RouteManifest {
			layouts: BTreeMap::from([(
				"root".to_string(),
				LayoutManifestEntry {
					template: Some("templates/layout.html".to_string()),
					templates: None,
					loaders: json!({}),
					parent: None,
					i18n_keys: None,
					projections: None,
				},
			)]),
			routes: BTreeMap::from([(
				"/test".to_string(),
				RouteManifestEntry {
					template: Some("templates/page.html".to_string()),
					templates: None,
					layout: Some("root".to_string()),
					loaders: json!({ "user": { "procedure": "getUser" } }),
					head_meta: None,
					i18n_keys: None,
					assets: None,
					procedures: None,
					projections: None,
				},
			)]),
			data_id: None,
			i18n: None,
		};

		inject_route_projections(&mut manifest, dir.path()).unwrap();

		let entry = &manifest.routes["/test"];
		let proj = entry.projections.as_ref().expect("projections should exist");
		let user_fields = &proj["user"];
		// Union of page (name) + layout (avatar) slots
		assert!(user_fields.contains(&"name".to_string()));
		assert!(user_fields.contains(&"avatar".to_string()));
	}

	#[test]
	fn no_slot_refs_no_projection() {
		let tmpl = "<div>Static content</div>";
		let loaders = json!({ "user": { "procedure": "getUser" } });
		let (mut manifest, dir) = make_entry(tmpl, loaders, None);

		inject_route_projections(&mut manifest, dir.path()).unwrap();

		let entry = &manifest.routes["/test"];
		assert!(entry.projections.is_none());
	}
}
