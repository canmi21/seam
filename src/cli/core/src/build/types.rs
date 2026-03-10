/* src/cli/core/src/build/types.rs */

// Shared types for the build pipeline.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct SeamManifest {
	pub js: Vec<String>,
	pub css: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct AssetFiles {
	pub css: Vec<String>,
	pub js: Vec<String>,
}

impl From<SeamManifest> for AssetFiles {
	fn from(m: SeamManifest) -> Self {
		Self { css: m.css, js: m.js }
	}
}

/// Single entry in Vite's `.vite/manifest.json`.
#[derive(Debug, Deserialize)]
struct ViteManifestEntry {
	file: String,
	#[serde(default)]
	css: Vec<String>,
	#[serde(default, rename = "isEntry")]
	is_entry: bool,
	#[serde(default, rename = "isDynamicEntry")]
	is_dynamic_entry: bool,
	#[serde(default)]
	imports: Vec<String>,
	#[serde(default, rename = "dynamicImports")]
	#[allow(dead_code)] // reserved for future prefetch graph expansion
	dynamic_imports: Vec<String>,
}

/// Per-entry asset set resolved from Vite manifest dependency graph.
#[derive(Debug, Clone, Default, Serialize)]
pub struct EntryAssets {
	/// Entry JS file
	pub scripts: Vec<String>,
	/// CSS files (entry + transitive)
	pub styles: Vec<String>,
	/// Shared chunk JS for modulepreload
	pub preload: Vec<String>,
}

/// Extended bundle manifest with per-entry asset tracking.
#[derive(Debug, Clone)]
pub struct BundleManifest {
	/// Per-entry assets keyed by Vite source path
	pub entries: BTreeMap<String, EntryAssets>,
	/// Main entry assets only — non-dynamic entries (for template generation)
	pub template: AssetFiles,
}

pub use seam_skeleton::ViteDevInfo;

pub fn read_bundle_manifest(path: &Path) -> Result<AssetFiles> {
	let content = std::fs::read_to_string(path)
		.with_context(|| format!("failed to read bundle manifest at {}", path.display()))?;

	// Try Vite format: { "src/...": { file, css, isEntry } }
	if let Ok(vite) = serde_json::from_str::<HashMap<String, ViteManifestEntry>>(&content)
		&& vite.values().any(|e| e.is_entry)
	{
		let mut js = vec![];
		let mut css = vec![];
		for entry in vite.values() {
			if entry.is_entry {
				js.push(entry.file.clone());
				css.extend(entry.css.iter().cloned());
			}
		}
		return Ok(AssetFiles { js, css });
	}

	// Fallback: Seam format { js: [], css: [] }
	let manifest: SeamManifest =
		serde_json::from_str(&content).context("failed to parse bundle manifest")?;
	Ok(manifest.into())
}

/// Parse a Vite manifest with full dependency graph, producing per-entry asset sets.
pub fn read_bundle_manifest_extended(path: &Path) -> Result<BundleManifest> {
	let content = std::fs::read_to_string(path)
		.with_context(|| format!("failed to read bundle manifest at {}", path.display()))?;

	// Try Vite format
	let vite: HashMap<String, ViteManifestEntry> =
		serde_json::from_str(&content).context("failed to parse Vite manifest for extended reading")?;

	let mut entries = BTreeMap::new();
	// Template assets: only main (non-dynamic) entries
	let mut tmpl_js = Vec::new();
	let mut tmpl_css = HashSet::new();

	for (key, entry) in &vite {
		if !entry.is_entry && !entry.is_dynamic_entry {
			continue;
		}

		let mut styles = Vec::new();
		let mut preload = Vec::new();
		let mut visited = HashSet::new();

		// Recursively collect transitive imports
		collect_imports(key, &vite, &mut styles, &mut preload, &mut visited);

		// Entry's own CSS
		for css in &entry.css {
			if !styles.contains(css) {
				styles.push(css.clone());
			}
		}

		let scripts = vec![entry.file.clone()];

		// Template: only non-dynamic entries go into the global template
		if entry.is_entry && !entry.is_dynamic_entry {
			tmpl_js.push(entry.file.clone());
			tmpl_css.extend(entry.css.iter().cloned());
		}

		entries.insert(key.clone(), EntryAssets { scripts, styles, preload });
	}

	let template = AssetFiles { js: tmpl_js, css: sorted_vec(tmpl_css) };

	Ok(BundleManifest { entries, template })
}

/// Recursively walk the `imports` chain to collect transitive CSS and shared chunks.
fn collect_imports(
	key: &str,
	manifest: &HashMap<String, ViteManifestEntry>,
	styles: &mut Vec<String>,
	preload: &mut Vec<String>,
	visited: &mut HashSet<String>,
) {
	if !visited.insert(key.to_string()) {
		return;
	}
	let Some(entry) = manifest.get(key) else { return };

	for import_key in &entry.imports {
		if let Some(imported) = manifest.get(import_key.as_str()) {
			// Shared chunk JS -> modulepreload
			if !imported.is_entry && !imported.is_dynamic_entry && !preload.contains(&imported.file) {
				preload.push(imported.file.clone());
			}
			// Transitive CSS
			for css in &imported.css {
				if !styles.contains(css) {
					styles.push(css.clone());
				}
			}
			collect_imports(import_key, manifest, styles, preload, visited);
		}
	}
}

fn sorted_vec(set: HashSet<String>) -> Vec<String> {
	let mut v: Vec<_> = set.into_iter().collect();
	v.sort();
	v
}

#[cfg(test)]
mod tests {
	use super::*;
	#[test]
	fn parse_extended_manifest_single_entry() {
		let json = r#"{
      "src/main.tsx": {
        "file": "assets/main-abc.js",
        "css": ["assets/main-abc.css"],
        "isEntry": true,
        "imports": []
      }
    }"#;
		let dir = tempfile::tempdir().unwrap();
		let path = dir.path().join("manifest.json");
		std::fs::write(&path, json).unwrap();

		let result = read_bundle_manifest_extended(&path).unwrap();
		assert_eq!(result.entries.len(), 1);
		let entry = &result.entries["src/main.tsx"];
		assert_eq!(entry.scripts, vec!["assets/main-abc.js"]);
		assert_eq!(entry.styles, vec!["assets/main-abc.css"]);
		assert!(entry.preload.is_empty());

		// Template: non-dynamic entry only
		assert_eq!(result.template.js, vec!["assets/main-abc.js"]);
		assert_eq!(result.template.css, vec!["assets/main-abc.css"]);
	}

	#[test]
	fn parse_extended_manifest_multi_entry_with_shared_chunk() {
		let json = r#"{
      "src/main.tsx": {
        "file": "assets/main-abc.js",
        "css": ["assets/main-abc.css"],
        "isEntry": true,
        "imports": ["_shared-xyz"]
      },
      "src/pages/home.tsx": {
        "file": "assets/home-def.js",
        "css": ["assets/home-def.css"],
        "isDynamicEntry": true,
        "imports": ["_shared-xyz"]
      },
      "_shared-xyz": {
        "file": "assets/shared-xyz.js",
        "css": ["assets/shared-xyz.css"]
      }
    }"#;
		let dir = tempfile::tempdir().unwrap();
		let path = dir.path().join("manifest.json");
		std::fs::write(&path, json).unwrap();

		let result = read_bundle_manifest_extended(&path).unwrap();
		assert_eq!(result.entries.len(), 2);

		let main = &result.entries["src/main.tsx"];
		assert_eq!(main.scripts, vec!["assets/main-abc.js"]);
		assert!(main.styles.contains(&"assets/main-abc.css".to_string()));
		assert!(main.styles.contains(&"assets/shared-xyz.css".to_string()));
		assert_eq!(main.preload, vec!["assets/shared-xyz.js"]);

		let home = &result.entries["src/pages/home.tsx"];
		assert_eq!(home.scripts, vec!["assets/home-def.js"]);
		assert!(home.styles.contains(&"assets/home-def.css".to_string()));
		assert!(home.styles.contains(&"assets/shared-xyz.css".to_string()));
		assert_eq!(home.preload, vec!["assets/shared-xyz.js"]);

		// Template: only main entry (non-dynamic), excludes home page entry
		assert_eq!(result.template.js, vec!["assets/main-abc.js"]);
		assert_eq!(result.template.css, vec!["assets/main-abc.css"]);
	}

	#[test]
	fn parse_extended_manifest_entry_no_imports() {
		let json = r#"{
      "src/main.tsx": {
        "file": "assets/main.js",
        "isEntry": true
      }
    }"#;
		let dir = tempfile::tempdir().unwrap();
		let path = dir.path().join("manifest.json");
		std::fs::write(&path, json).unwrap();

		let result = read_bundle_manifest_extended(&path).unwrap();
		let entry = &result.entries["src/main.tsx"];
		assert_eq!(entry.scripts, vec!["assets/main.js"]);
		assert!(entry.styles.is_empty());
		assert!(entry.preload.is_empty());

		// Template matches single entry
		assert_eq!(result.template.js, vec!["assets/main.js"]);
		assert!(result.template.css.is_empty());
	}
}
