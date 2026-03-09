/* src/cli/skeleton/src/document.rs */

use crate::ViteDevInfo;

const LIVE_RELOAD_SCRIPT: &str = concat!(
	r#"<script>(function(){var ws,t;function c(){"#,
	r#"ws=new WebSocket((location.protocol==="https:"?"wss:":"ws:")"#,
	r#"+"//"+location.host+"/_seam/dev/ws");"#,
	r#"ws.onmessage=function(){location.reload()};"#,
	r#"ws.onclose=function(){t=setTimeout(c,1000)}}c()})()</script>"#
);

/// Wrap a skeleton HTML fragment in a compact HTML5 document with asset references.
/// Produces minimal single-line output for production templates.
/// When `dev_mode` is true, injects a live reload WebSocket script before `</body>`.
/// When `vite` is Some, replaces static CSS/JS refs with Vite dev server scripts.
pub fn wrap_document(
	skeleton: &str,
	css_files: &[String],
	js_files: &[String],
	dev_mode: bool,
	vite: Option<&ViteDevInfo>,
	root_id: &str,
) -> String {
	let mut doc = String::from("<!DOCTYPE html><html><head><meta charset=\"utf-8\">");
	if let Some(v) = vite {
		// React Fast Refresh preamble
		doc.push_str(&format!(
			concat!(
				"<script type=\"module\">",
				"import RefreshRuntime from '{origin}/@react-refresh';",
				"RefreshRuntime.injectIntoGlobalHook(window);",
				"window.$RefreshReg$ = () => {{}};",
				"window.$RefreshSig$ = () => (type) => type;",
				"window.__vite_plugin_react_preamble_installed__ = true",
				"</script>"
			),
			origin = v.origin,
		));
		// Vite HMR client
		doc.push_str(&format!(
			r#"<script type="module" src="{origin}/@vite/client"></script>"#,
			origin = v.origin,
		));
		// App entry
		doc.push_str(&format!(
			r#"<script type="module" src="{origin}/{entry}"></script>"#,
			origin = v.origin,
			entry = v.entry,
		));
	} else {
		for f in css_files {
			doc.push_str(&format!(r#"<link rel="stylesheet" href="/_seam/static/{f}">"#));
		}
		// Per-page asset slots (replaced at runtime by engine when page_assets is present)
		doc.push_str("<!--seam:page-styles-->");
		doc.push_str("<!--seam:prefetch-->");
	}
	doc.push_str(&format!("</head><body><div id=\"{root_id}\">"));
	doc.push_str(skeleton);
	doc.push_str("</div>");
	if vite.is_none() {
		for f in js_files {
			doc.push_str(&format!(r#"<script type="module" src="/_seam/static/{f}"></script>"#));
		}
		doc.push_str("<!--seam:page-scripts-->");
	}
	if dev_mode && vite.is_none() {
		doc.push_str(LIVE_RELOAD_SCRIPT);
	}
	doc.push_str("</body></html>");
	doc
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn wraps_with_assets() {
		let result = wrap_document(
			"<p>Hello</p>",
			&["style-abc.css".into()],
			&["main-xyz.js".into()],
			false,
			None,
			"__seam",
		);
		assert_eq!(
			result,
			concat!(
				"<!DOCTYPE html><html><head><meta charset=\"utf-8\">",
				"<link rel=\"stylesheet\" href=\"/_seam/static/style-abc.css\">",
				"<!--seam:page-styles--><!--seam:prefetch-->",
				"</head><body>",
				"<div id=\"__seam\"><p>Hello</p></div>",
				"<script type=\"module\" src=\"/_seam/static/main-xyz.js\"></script>",
				"<!--seam:page-scripts-->",
				"</body></html>"
			)
		);
	}

	#[test]
	fn wraps_without_assets() {
		let result = wrap_document("<p>Hi</p>", &[], &[], false, None, "__seam");
		assert_eq!(
			result,
			concat!(
				"<!DOCTYPE html><html><head><meta charset=\"utf-8\">",
				"<!--seam:page-styles--><!--seam:prefetch-->",
				"</head><body>",
				"<div id=\"__seam\"><p>Hi</p></div>",
				"<!--seam:page-scripts-->",
				"</body></html>"
			)
		);
	}

	#[test]
	fn skeleton_with_metadata_stays_in_body() {
		// With structured head, metadata in skeleton JSX stays in body (not extracted)
		let skeleton = "<title>My Page</title><meta name=\"desc\"><p>content</p>";
		let result = wrap_document(skeleton, &["style.css".into()], &[], false, None, "__seam");

		let root_start = result.find("__seam").unwrap();
		let root_section = &result[root_start..];
		assert!(root_section.contains("<title>My Page</title>"), "title stays in body");
		assert!(root_section.contains("<p>content</p>"), "body content in root div");
	}

	#[test]
	fn dev_mode_injects_live_reload_script() {
		let result = wrap_document("<p>dev</p>", &[], &["app.js".into()], true, None, "__seam");
		assert!(result.contains("WebSocket"), "dev_mode should inject WebSocket live reload");
		assert!(result.contains("/_seam/dev/ws"));
		let script_pos = result.find("WebSocket").unwrap();
		let module_pos = result.find("app.js").unwrap();
		let page_scripts_pos = result.find("<!--seam:page-scripts-->").unwrap();
		let body_end = result.find("</body>").unwrap();
		assert!(module_pos < page_scripts_pos);
		assert!(script_pos > page_scripts_pos);
		assert!(script_pos < body_end);
	}

	#[test]
	fn production_mode_no_reload_script() {
		let result = wrap_document("<p>prod</p>", &[], &["app.js".into()], false, None, "__seam");
		assert!(!result.contains("WebSocket"), "production mode must not inject live reload");
	}

	#[test]
	fn vite_mode_injects_three_scripts() {
		let vite = ViteDevInfo {
			origin: "http://localhost:5173".to_string(),
			entry: "src/client/main.tsx".to_string(),
		};
		let result = wrap_document(
			"<p>vite</p>",
			&["ignored.css".into()],
			&["ignored.js".into()],
			false,
			Some(&vite),
			"__seam",
		);

		// All three Vite scripts present
		assert!(result.contains("@react-refresh"), "must inject React Refresh preamble");
		assert!(result.contains("/@vite/client"), "must inject Vite HMR client");
		assert!(result.contains("src/client/main.tsx"), "must inject app entry");

		// No static asset references
		assert!(!result.contains("/_seam/static/"), "vite mode must not reference static assets");
		assert!(!result.contains("ignored.css"));
		assert!(!result.contains("ignored.js"));
	}

	#[test]
	fn vite_mode_skips_websocket_reload() {
		let vite = ViteDevInfo {
			origin: "http://localhost:5173".to_string(),
			entry: "src/client/main.tsx".to_string(),
		};
		let result = wrap_document("<p>vite-dev</p>", &[], &[], true, Some(&vite), "__seam");

		// Vite scripts present
		assert!(result.contains("/@vite/client"));
		// WebSocket live reload must NOT be injected — Vite HMR handles reload
		assert!(!result.contains("/_seam/dev/ws"), "vite mode must not inject WebSocket reload");
	}

	#[test]
	fn no_metadata_passes_through() {
		let result = wrap_document("<div><p>Hello</p></div>", &[], &[], false, None, "__seam");
		assert!(result.contains("<div id=\"__seam\"><div><p>Hello</p></div></div>"));
	}

	#[test]
	fn slot_markers_present_in_production() {
		let result =
			wrap_document("<p>test</p>", &["a.css".into()], &["a.js".into()], false, None, "__seam");
		assert!(result.contains("<!--seam:page-styles-->"));
		assert!(result.contains("<!--seam:prefetch-->"));
		assert!(result.contains("<!--seam:page-scripts-->"));
		// Verify ordering: page-styles before </head>, page-scripts before </body>
		let head_end = result.find("</head>").unwrap();
		let page_styles = result.find("<!--seam:page-styles-->").unwrap();
		let page_scripts = result.find("<!--seam:page-scripts-->").unwrap();
		assert!(page_styles < head_end);
		assert!(page_scripts > head_end);
	}

	#[test]
	fn slot_markers_absent_in_vite_mode() {
		let vite = ViteDevInfo {
			origin: "http://localhost:5173".to_string(),
			entry: "src/main.tsx".to_string(),
		};
		let result = wrap_document("<p>test</p>", &[], &[], false, Some(&vite), "__seam");
		assert!(!result.contains("<!--seam:page-styles-->"));
		assert!(!result.contains("<!--seam:prefetch-->"));
		assert!(!result.contains("<!--seam:page-scripts-->"));
	}

	#[test]
	fn skeleton_with_conditional_stays_in_body() {
		// Conditional directives in skeleton are no longer extracted to head
		let skeleton =
			"<!--seam:if:x--><!--seam:d:attr:content--><meta name=\"og\"><!--seam:endif:x--><p>body</p>";
		let result = wrap_document(skeleton, &[], &[], false, None, "__seam");

		let root_start = result.find("__seam").unwrap();
		let root_section = &result[root_start..];
		assert!(root_section.contains("<!--seam:if:x-->"), "conditional stays in body");
		assert!(root_section.contains("<meta name=\"og\">"), "meta stays in body");
		assert!(root_section.contains("<p>body</p>"), "body content in root div");
	}
}
