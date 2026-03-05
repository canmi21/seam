/* src/cli/core/src/build/route/process/i18n_export.rs */

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::Result;

use super::super::fnv;
use super::super::helpers::{LocaleRouteMessages, export_i18n_memory, export_i18n_paged};
use super::super::i18n_resolve;
use super::super::types::{LayoutManifestEntry, RouteManifest};
use crate::config::{I18nMode, I18nSection};
use crate::ui;

/// Resolve, hash, and export i18n messages based on the route manifest.
///
/// 1. Resolve fallback chain (every locale gets every key)
/// 2. Compute route hashes and content hashes
/// 3. Export messages in memory or paged mode
/// 4. Update manifest with route_hashes and content_hashes
pub(crate) fn export_i18n(
	out_dir: &Path,
	messages: &BTreeMap<String, serde_json::Value>,
	manifest: &mut RouteManifest,
	i18n: &I18nSection,
) -> Result<()> {
	// 1. Resolve fallback chain
	let resolved = i18n_resolve::resolve_fallback(messages, &i18n.locales);

	// 2. Collect i18n_keys per route (merged with layout chain keys)
	let i18n_manifest = manifest.i18n.as_mut().expect("i18n manifest must exist");
	let layout_keys = collect_layout_keys(&manifest.layouts);

	let mut route_hashes = BTreeMap::new();
	let mut content_hashes: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
	let mut per_locale: BTreeMap<String, LocaleRouteMessages> = BTreeMap::new();

	// Initialize per_locale for each locale
	for locale in &i18n.locales {
		per_locale.insert(locale.clone(), BTreeMap::new());
	}

	for (pattern, route_entry) in &manifest.routes {
		// Compute route hash
		let rh = fnv::route_hash(pattern);
		route_hashes.insert(pattern.clone(), rh.clone());

		// Merge route keys + all ancestor layout keys
		let combined_keys = merge_route_layout_keys(
			route_entry.i18n_keys.as_deref().unwrap_or(&[]),
			route_entry.layout.as_deref(),
			&layout_keys,
			&manifest.layouts,
		);

		// For each locale: extract messages, compute content hash, store
		let mut locale_hashes = BTreeMap::new();
		for locale in &i18n.locales {
			let locale_resolved = &resolved[locale];
			let msgs = extract_route_messages(locale_resolved, &combined_keys);

			// Content hash: sort keys, concatenate "key=value" pairs, hash
			let content_str: String =
				msgs.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("\n");
			let ch = fnv::content_hash(&content_str);
			locale_hashes.insert(locale.clone(), ch);

			// Store in per-locale map
			per_locale.get_mut(locale).expect("locale initialized above").insert(rh.clone(), msgs);
		}
		content_hashes.insert(rh.clone(), locale_hashes);
	}

	// 3. Export based on mode
	match i18n.mode {
		I18nMode::Memory => export_i18n_memory(out_dir, &per_locale)?,
		I18nMode::Paged => export_i18n_paged(out_dir, &per_locale)?,
	}

	// 4. Update manifest
	i18n_manifest.route_hashes = route_hashes;
	i18n_manifest.content_hashes = content_hashes;

	let route_count = manifest.routes.len();
	let locale_count = i18n.locales.len();
	let mode = i18n.mode.as_str();
	ui::detail_ok(&format!("i18n: {route_count} routes x {locale_count} locales ({mode} mode)"));

	Ok(())
}

/// Collect i18n_keys for each layout, keyed by layout id.
fn collect_layout_keys(
	layouts: &BTreeMap<String, LayoutManifestEntry>,
) -> BTreeMap<String, Vec<String>> {
	layouts
		.iter()
		.map(|(id, entry)| {
			let keys = entry.i18n_keys.clone().unwrap_or_default();
			(id.clone(), keys)
		})
		.collect()
}

/// Merge a route's own i18n_keys with all ancestor layout keys.
fn merge_route_layout_keys(
	route_keys: &[String],
	layout_id: Option<&str>,
	layout_keys: &BTreeMap<String, Vec<String>>,
	layouts: &BTreeMap<String, LayoutManifestEntry>,
) -> Vec<String> {
	let mut combined = BTreeMap::<String, ()>::new();
	for key in route_keys {
		combined.insert(key.clone(), ());
	}

	// Walk layout chain upward
	let mut current = layout_id;
	while let Some(lid) = current {
		if let Some(keys) = layout_keys.get(lid) {
			for key in keys {
				combined.insert(key.clone(), ());
			}
		}
		current = layouts.get(lid).and_then(|e| e.parent.as_deref());
	}

	combined.into_keys().collect()
}

/// Extract messages for a set of keys from resolved locale data.
/// If keys is empty, include all messages.
fn extract_route_messages(
	locale_data: &serde_json::Value,
	keys: &[String],
) -> BTreeMap<String, String> {
	let Some(obj) = locale_data.as_object() else {
		return BTreeMap::new();
	};

	if keys.is_empty() {
		// No key filtering -- include all messages
		return obj
			.iter()
			.filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
			.collect();
	}

	keys
		.iter()
		.filter_map(|k| obj.get(k).and_then(|v| v.as_str()).map(|s| (k.clone(), s.to_string())))
		.collect()
}
