/* src/cli/core/src/build/route/process/assets.rs */

use std::collections::BTreeMap;

use super::super::types::RouteAssets;
use crate::build::types::BundleManifest;

/// Compute per-route asset references from the source file map and bundle manifest.
pub(super) fn compute_route_assets(
	route_path: &str,
	source_file_map: Option<&BTreeMap<String, String>>,
	bundle_manifest: Option<&BundleManifest>,
) -> Option<RouteAssets> {
	let sfm = source_file_map?;
	let bm = bundle_manifest?;
	let source_key = sfm.get(route_path)?;
	let entry = bm.entries.get(source_key)?;

	// Exclude current route's own assets + globally-loaded template assets from prefetch
	let mut exclude = std::collections::HashSet::<&str>::new();
	for s in &entry.scripts {
		exclude.insert(s);
	}
	for s in &entry.styles {
		exclude.insert(s);
	}
	for s in &entry.preload {
		exclude.insert(s);
	}
	// Template assets are already in every layout HTML via wrap_document
	for s in &bm.template.js {
		exclude.insert(s);
	}
	for s in &bm.template.css {
		exclude.insert(s);
	}

	let mut prefetch = Vec::new();
	for (key, other_entry) in &bm.entries {
		if key == source_key {
			continue;
		}
		for s in &other_entry.scripts {
			if !exclude.contains(s.as_str()) && !prefetch.contains(s) {
				prefetch.push(s.clone());
			}
		}
		for s in &other_entry.styles {
			if !exclude.contains(s.as_str()) && !prefetch.contains(s) {
				prefetch.push(s.clone());
			}
		}
	}

	Some(RouteAssets {
		styles: entry.styles.clone(),
		scripts: entry.scripts.clone(),
		preload: entry.preload.clone(),
		prefetch,
	})
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::build::types::{AssetFiles, EntryAssets};

	#[test]
	fn compute_route_assets_both_none() {
		let result = compute_route_assets("/", None, None);
		assert!(result.is_none());
	}

	#[test]
	fn compute_route_assets_missing_source_file_map() {
		let bm = BundleManifest {
			global: AssetFiles { js: vec![], css: vec![] },
			entries: BTreeMap::new(),
			template: AssetFiles { js: vec![], css: vec![] },
		};
		let result = compute_route_assets("/", None, Some(&bm));
		assert!(result.is_none());
	}

	#[test]
	fn compute_route_assets_missing_bundle_manifest() {
		let mut sfm = BTreeMap::new();
		sfm.insert("/".to_string(), "src/Home.tsx".to_string());
		let result = compute_route_assets("/", Some(&sfm), None);
		assert!(result.is_none());
	}

	#[test]
	fn compute_route_assets_route_not_in_map() {
		let sfm = BTreeMap::new(); // empty map
		let bm = BundleManifest {
			global: AssetFiles { js: vec![], css: vec![] },
			entries: BTreeMap::new(),
			template: AssetFiles { js: vec![], css: vec![] },
		};
		let result = compute_route_assets("/missing", Some(&sfm), Some(&bm));
		assert!(result.is_none());
	}

	#[test]
	fn compute_route_assets_source_key_not_in_entries() {
		let mut sfm = BTreeMap::new();
		sfm.insert("/".to_string(), "src/Home.tsx".to_string());
		let bm = BundleManifest {
			global: AssetFiles { js: vec![], css: vec![] },
			entries: BTreeMap::new(), // no entry for "src/Home.tsx"
			template: AssetFiles { js: vec![], css: vec![] },
		};
		let result = compute_route_assets("/", Some(&sfm), Some(&bm));
		assert!(result.is_none());
	}

	#[test]
	fn compute_route_assets_two_routes_symmetric() {
		// Two page entries: Home and Dashboard, sharing a chunk, with template assets
		let mut sfm = BTreeMap::new();
		sfm.insert("/".to_string(), "src/Home.tsx".to_string());
		sfm.insert("/dashboard/:user".to_string(), "src/Dashboard.tsx".to_string());

		let home_entry = EntryAssets {
			scripts: vec!["assets/home-abc.js".to_string()],
			styles: vec!["assets/home-abc.css".to_string(), "assets/shared.css".to_string()],
			preload: vec!["assets/shared-xyz.js".to_string()],
		};
		let dash_entry = EntryAssets {
			scripts: vec!["assets/dash-def.js".to_string()],
			styles: vec!["assets/dash-def.css".to_string(), "assets/shared.css".to_string()],
			preload: vec!["assets/shared-xyz.js".to_string()],
		};

		let mut entries = BTreeMap::new();
		entries.insert("src/Home.tsx".to_string(), home_entry);
		entries.insert("src/Dashboard.tsx".to_string(), dash_entry);

		let template = AssetFiles {
			js: vec!["assets/main-tmpl.js".to_string()],
			css: vec!["assets/main-tmpl.css".to_string()],
		};

		let bm = BundleManifest { global: AssetFiles { js: vec![], css: vec![] }, entries, template };

		// Home route
		let home = compute_route_assets("/", Some(&sfm), Some(&bm)).unwrap();
		assert_eq!(home.scripts, vec!["assets/home-abc.js"]);
		assert_eq!(home.styles, vec!["assets/home-abc.css", "assets/shared.css"]);
		assert_eq!(home.preload, vec!["assets/shared-xyz.js"]);
		// Prefetch: dashboard's unique scripts + styles, excluding shared assets and template assets
		assert!(home.prefetch.contains(&"assets/dash-def.js".to_string()));
		assert!(home.prefetch.contains(&"assets/dash-def.css".to_string()));
		// shared.css is in home's own styles -> excluded from prefetch
		assert!(!home.prefetch.contains(&"assets/shared.css".to_string()));
		// template assets excluded
		assert!(!home.prefetch.contains(&"assets/main-tmpl.js".to_string()));
		assert!(!home.prefetch.contains(&"assets/main-tmpl.css".to_string()));
		// own assets excluded
		assert!(!home.prefetch.contains(&"assets/home-abc.js".to_string()));

		// Dashboard route
		let dash = compute_route_assets("/dashboard/:user", Some(&sfm), Some(&bm)).unwrap();
		assert_eq!(dash.scripts, vec!["assets/dash-def.js"]);
		assert_eq!(dash.styles, vec!["assets/dash-def.css", "assets/shared.css"]);
		assert_eq!(dash.preload, vec!["assets/shared-xyz.js"]);
		// Prefetch: home's unique scripts + styles
		assert!(dash.prefetch.contains(&"assets/home-abc.js".to_string()));
		assert!(dash.prefetch.contains(&"assets/home-abc.css".to_string()));
		assert!(!dash.prefetch.contains(&"assets/shared.css".to_string()));
		assert!(!dash.prefetch.contains(&"assets/main-tmpl.js".to_string()));
		assert!(!dash.prefetch.contains(&"assets/dash-def.js".to_string()));
	}
}
