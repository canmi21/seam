/* src/server/engine/rust/src/slots.rs */

use crate::page::PageAssets;

/// Generate `<link rel="stylesheet">` tags for page-specific CSS.
pub fn generate_style_tags(styles: &[String]) -> String {
	let mut out = String::new();
	for f in styles {
		out.push_str(&format!(r#"<link rel="stylesheet" href="/_seam/static/{f}">"#));
	}
	out
}

/// Generate `<link rel="modulepreload">` and `<script type="module">` tags for page JS.
pub fn generate_script_tags(scripts: &[String], preloads: &[String]) -> String {
	let mut out = String::new();
	for f in preloads {
		out.push_str(&format!(r#"<link rel="modulepreload" href="/_seam/static/{f}">"#));
	}
	for f in scripts {
		out.push_str(&format!(r#"<script type="module" src="/_seam/static/{f}"></script>"#));
	}
	out
}

/// Generate `<link rel="prefetch">` tags for other pages' assets (idle prefetch).
pub fn generate_prefetch_tags(prefetch: &[String]) -> String {
	let mut out = String::new();
	for f in prefetch {
		let as_attr = if f.ends_with(".css") { "style" } else { "script" };
		out.push_str(&format!(r#"<link rel="prefetch" href="/_seam/static/{f}" as="{as_attr}">"#));
	}
	out
}

/// Strip asset slot markers from template (replace with empty string).
/// Used when page_assets is not configured to prevent the injector
/// from treating these markers as data slots.
pub fn strip_asset_slots(template: &str) -> String {
	template
		.replace("<!--seam:page-styles-->", "")
		.replace("<!--seam:page-scripts-->", "")
		.replace("<!--seam:prefetch-->", "")
}

/// Replace asset slot markers in template with actual tags.
pub fn replace_asset_slots(template: &str, assets: &PageAssets) -> String {
	template
		.replace("<!--seam:page-styles-->", &generate_style_tags(&assets.styles))
		.replace("<!--seam:page-scripts-->", &generate_script_tags(&assets.scripts, &assets.preload))
		.replace("<!--seam:prefetch-->", &generate_prefetch_tags(&assets.prefetch))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn generate_style_tags_output() {
		let tags = generate_style_tags(&["page-home.css".into()]);
		assert_eq!(tags, r#"<link rel="stylesheet" href="/_seam/static/page-home.css">"#);
	}

	#[test]
	fn generate_script_tags_output() {
		let tags = generate_script_tags(&["page-home.js".into()], &["shared.js".into()]);
		assert!(tags.contains(r#"<link rel="modulepreload" href="/_seam/static/shared.js">"#));
		assert!(tags.contains(r#"<script type="module" src="/_seam/static/page-home.js"></script>"#));
		// modulepreload should come before script
		let preload_pos = tags.find("modulepreload").unwrap();
		let script_pos = tags.find("type=\"module\"").unwrap();
		assert!(preload_pos < script_pos);
	}

	#[test]
	fn generate_prefetch_tags_output() {
		let tags = generate_prefetch_tags(&["other.js".into(), "other.css".into()]);
		assert!(tags.contains(r#"as="script""#));
		assert!(tags.contains(r#"as="style""#));
	}

	#[test]
	fn replace_asset_slots_test() {
		let template = concat!(
			"<head><!--seam:page-styles--><!--seam:prefetch--></head>",
			"<body><!--seam:page-scripts--></body>"
		);
		let assets = PageAssets {
			styles: vec!["page.css".into()],
			scripts: vec!["page.js".into()],
			preload: vec!["shared.js".into()],
			prefetch: vec!["other.js".into()],
		};
		let result = replace_asset_slots(template, &assets);
		assert!(result.contains(r#"href="/_seam/static/page.css""#));
		assert!(result.contains(r#"src="/_seam/static/page.js""#));
		assert!(result.contains(r#"modulepreload"#));
		assert!(result.contains(r#"prefetch"#));
		assert!(!result.contains("<!--seam:page-styles-->"));
		assert!(!result.contains("<!--seam:page-scripts-->"));
		assert!(!result.contains("<!--seam:prefetch-->"));
	}
}
