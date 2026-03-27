/* src/server/engine/rust/src/render.rs */

use crate::escape::ascii_escape_json;
use crate::page::{
	I18nOpts, PageConfig, build_seam_data, flatten_for_slots, inject_data_script, inject_head_meta,
	inject_html_lang,
};
use crate::slots::{replace_asset_slots, strip_asset_slots};

/// Render a page: inject data into template, assemble data script,
/// apply head metadata and locale attributes.
///
/// This is the single entry point that replaces ~60 lines of duplicated logic
/// across TS, Rust, and Go backends.
///
/// Arguments are JSON strings for cross-language compatibility:
/// - `template`: pre-resolved HTML template (layout chain already applied)
/// - `loader_data_json`: `{"key": value, ...}` from all loaders (layout + page)
/// - `config_json`: serialized `PageConfig`
/// - `i18n_opts_json`: optional serialized `I18nOpts`
/// - `derives_json`: optional derive definitions `{"name": {"sources":[],"fn":"..."}}`
///
/// When the `quickjs` feature is enabled and `derives_json` is provided,
/// derive functions are executed via QuickJS and results merged under `__derived`.
/// When `quickjs` is not available (WASM builds), callers should pre-compute
/// derive results and include `__derived` in `loader_data_json` directly.
pub fn render_page(
	template: &str,
	loader_data_json: &str,
	config_json: &str,
	i18n_opts_json: Option<&str>,
	derives_json: Option<&str>,
) -> String {
	#[allow(unused_mut)]
	let mut loader_data: serde_json::Value =
		serde_json::from_str(loader_data_json).unwrap_or(serde_json::Value::Null);
	let config: PageConfig = match serde_json::from_str(config_json) {
		Ok(c) => c,
		Err(_) => return template.to_string(),
	};
	let i18n_opts: Option<I18nOpts> = i18n_opts_json.and_then(|s| serde_json::from_str(s).ok());

	// Execute derives when quickjs is available and definitions are provided.
	// Skip if loader_data already contains __derived (pre-computed by adapter).
	#[cfg(feature = "quickjs")]
	if let Some(dj) = derives_json
		&& !dj.is_empty()
		&& dj != "{}"
		&& loader_data.get("__derived").is_none()
		&& let Ok(result_json) = crate::derive::execute_derives(dj, loader_data_json)
		&& let Ok(derived_val) = serde_json::from_str::<serde_json::Value>(&result_json)
		&& let Some(obj) = loader_data.as_object_mut()
	{
		obj.insert("__derived".to_string(), derived_val);
	}
	#[cfg(not(feature = "quickjs"))]
	let _ = derives_json;

	// Step 1: Replace asset slot markers before injector sees them.
	let working = match config.page_assets {
		Some(ref assets) => replace_asset_slots(template, assets),
		None => strip_asset_slots(template),
	};

	// Step 2: Flatten loader data for slot resolution
	let flat_data = flatten_for_slots(&loader_data);

	// Step 3: Inject slots into template (no data script)
	let mut html = seam_injector::inject_no_script(&working, &flat_data);

	// Step 4: Inject page-level head metadata
	if let Some(ref meta) = config.head_meta {
		let injected_meta = seam_injector::inject_no_script(meta, &flat_data);
		html = inject_head_meta(&html, &injected_meta);
	}

	// Step 5: Set <html lang="..."> when locale is known
	if let Some(ref opts) = i18n_opts {
		html = inject_html_lang(&html, &opts.locale);
	}

	// Step 6: Build data JSON and inject script
	let seam_data = build_seam_data(&loader_data, &config, i18n_opts.as_ref());
	let json = serde_json::to_string(&seam_data).unwrap_or_default();
	let escaped = ascii_escape_json(&json);
	inject_data_script(&html, &config.data_id, &escaped)
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;

	fn simple_template() -> String {
		r#"<html><head><meta charset="utf-8"><title>Test</title></head><body><p><!--seam:title--></p></body></html>"#.to_string()
	}

	#[test]
	fn render_basic_page() {
		let template = simple_template();
		let data = json!({"title": "Hello"}).to_string();
		let config = json!({"layout_chain": [], "data_id": "__data"}).to_string();

		let result = render_page(&template, &data, &config, None, None);
		assert!(result.contains("<p>Hello</p>"));
		assert!(result.contains(r#"<script id="__data""#));
		assert!(result.contains(r#""title":"Hello""#));
	}

	#[test]
	fn render_with_layout() {
		let template = simple_template();
		let data = json!({"title": "Page", "nav": "NavData"}).to_string();
		let config = json!({
			"layout_chain": [{"id": "root", "loader_keys": ["nav"]}],
			"data_id": "__data"
		})
		.to_string();

		let result = render_page(&template, &data, &config, None, None);
		// nav should be under _layouts.root, not at top level
		assert!(result.contains(r#""_layouts""#), "missing _layouts key");
		assert!(result.contains(r#""root""#), "missing root layout key");
		// Page data should be at top level
		assert!(result.contains(r#""title":"Page""#), "missing page-level title");
	}

	#[test]
	fn render_with_i18n() {
		let template = simple_template();
		let data = json!({"title": "Hello"}).to_string();
		let config = json!({"layout_chain": [], "data_id": "__data"}).to_string();
		let i18n = json!({
			"locale": "zh",
			"default_locale": "en",
			"messages": {"hello": "你好"}
		})
		.to_string();

		let result = render_page(&template, &data, &config, Some(&i18n), None);
		assert!(result.contains(r#"<html lang="zh""#));
		assert!(result.contains(r#""_i18n""#));
	}

	#[test]
	fn render_with_head_meta() {
		let template = simple_template();
		let data = json!({"title": "Hello"}).to_string();
		let config = json!({
			"layout_chain": [],
			"data_id": "__data",
			"head_meta": r#"<title><!--seam:title--></title>"#
		})
		.to_string();

		let result = render_page(&template, &data, &config, None, None);
		// head_meta should be injected after <meta charset="utf-8">
		assert!(result.contains(r#"<meta charset="utf-8"><title>Hello</title>"#));
	}

	#[test]
	fn render_invalid_config_returns_template() {
		let template = "plain html";
		let result = render_page(template, "{}", "invalid json", None, None);
		assert_eq!(result, "plain html");
	}

	#[test]
	fn render_with_page_assets() {
		let template = concat!(
			r#"<html><head><meta charset="utf-8">"#,
			r#"<link rel="stylesheet" href="/_seam/static/main.css">"#,
			"<!--seam:page-styles--><!--seam:prefetch-->",
			"</head><body>",
			r#"<div id="__seam"><p><!--seam:title--></p></div>"#,
			r#"<script type="module" src="/_seam/static/main.js"></script>"#,
			"<!--seam:page-scripts-->",
			"</body></html>"
		);
		let data = json!({"title": "Hello"}).to_string();
		let config = json!({
			"layout_chain": [],
			"data_id": "__data",
			"page_assets": {
				"styles": ["page-home.css"],
				"scripts": ["page-home.js"],
				"preload": ["shared.js"],
				"prefetch": ["page-other.js"]
			}
		})
		.to_string();

		let result = render_page(template, &data, &config, None, None);

		// Asset slots replaced
		assert!(result.contains(r#"href="/_seam/static/page-home.css""#));
		assert!(result.contains(r#"src="/_seam/static/page-home.js""#));
		assert!(result.contains(r#"modulepreload"#));
		assert!(result.contains(r#"prefetch"#));
		// Slot markers gone
		assert!(!result.contains("<!--seam:page-styles-->"));
		assert!(!result.contains("<!--seam:page-scripts-->"));
		assert!(!result.contains("<!--seam:prefetch-->"));
		// Data injection still works
		assert!(result.contains("<p>Hello</p>"));
		assert!(result.contains(r#"<script id="__data""#));
	}

	#[test]
	fn render_without_page_assets_strips_slots() {
		let template = concat!(
			r#"<html><head><meta charset="utf-8">"#,
			"<!--seam:page-styles--><!--seam:prefetch-->",
			"</head><body>",
			r#"<div id="__seam"><p><!--seam:title--></p></div>"#,
			"<!--seam:page-scripts-->",
			"</body></html>"
		);
		let data = json!({"title": "Hello"}).to_string();
		let config = json!({"layout_chain": [], "data_id": "__data"}).to_string();

		let result = render_page(template, &data, &config, None, None);

		// Slot markers stripped before injector (prevents misinterpretation)
		assert!(!result.contains("<!--seam:page-styles-->"));
		assert!(!result.contains("<!--seam:page-scripts-->"));
		assert!(!result.contains("<!--seam:prefetch-->"));
		// Data injection still works
		assert!(result.contains("<p>Hello</p>"));
	}

	#[cfg(feature = "quickjs")]
	#[test]
	fn render_with_derives() {
		let template = r#"<html><head><meta charset="utf-8"></head><body><p><!--seam:__derived.stats.total--></p></body></html>"#;
		let data = json!({"repos": [{"stars": 100}, {"stars": 42}]}).to_string();
		let config = json!({"layout_chain": [], "data_id": "__data"}).to_string();
		let derives = json!({
			"stats": {
				"sources": ["repos"],
				"fn": "(repos) => ({ total: repos.reduce((s, r) => s + r.stars, 0) })"
			}
		})
		.to_string();

		let result = render_page(template, &data, &config, None, Some(&derives));

		// Slot replaced with computed derive value
		assert!(result.contains("<p>142</p>"), "slot not replaced: {result}");
		// __derived present in __data script
		assert!(result.contains(r#""__derived""#), "missing __derived in data");
		assert!(result.contains(r#""total":142"#), "missing total in derived");
	}

	#[test]
	fn render_with_precomputed_derived() {
		let template = r#"<html><head><meta charset="utf-8"></head><body><p><!--seam:__derived.stats.total--></p></body></html>"#;
		// __derived already in loader data (WASM path: adapter pre-computed)
		let data = json!({
			"repos": [{"stars": 100}],
			"__derived": {"stats": {"total": 100}}
		})
		.to_string();
		let config = json!({"layout_chain": [], "data_id": "__data"}).to_string();

		let result = render_page(template, &data, &config, None, None);

		assert!(result.contains("<p>100</p>"), "precomputed slot not replaced");
		assert!(result.contains(r#""__derived""#), "missing __derived in data");
	}
}
