/* packages/cli/core/src/build/skeleton/document.rs */

use super::super::types::ViteDevInfo;

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
  }
  doc.push_str("</head><body><div id=\"__SEAM_ROOT__\">");
  doc.push_str(skeleton);
  doc.push_str("</div>");
  if vite.is_none() {
    for f in js_files {
      doc.push_str(&format!(r#"<script type="module" src="/_seam/static/{f}"></script>"#));
    }
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
    );
    assert_eq!(
      result,
      concat!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\">",
        "<link rel=\"stylesheet\" href=\"/_seam/static/style-abc.css\">",
        "</head><body>",
        "<div id=\"__SEAM_ROOT__\"><p>Hello</p></div>",
        "<script type=\"module\" src=\"/_seam/static/main-xyz.js\"></script>",
        "</body></html>"
      )
    );
  }

  #[test]
  fn wraps_without_assets() {
    let result = wrap_document("<p>Hi</p>", &[], &[], false, None);
    assert_eq!(
      result,
      concat!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\">",
        "</head><body>",
        "<div id=\"__SEAM_ROOT__\"><p>Hi</p></div>",
        "</body></html>"
      )
    );
  }

  #[test]
  fn wraps_with_hoisted_metadata() {
    let skeleton =
      "<title><!--seam:t--></title><!--seam:d:attr:content--><meta name=\"desc\"><p>content</p>";
    let result = wrap_document(skeleton, &["style.css".into()], &[], false, None);

    let head = result.split("</head>").next().unwrap();
    assert!(!head.contains("<!--seam:"), "seam markers must not leak into <head>");
    assert!(head.contains("style.css"));

    let root_start = result.find("__SEAM_ROOT__").unwrap();
    let root_section = &result[root_start..];
    assert!(root_section.contains("<!--seam:t-->"));
    assert!(root_section.contains("<!--seam:d:attr:content-->"));
  }

  #[test]
  fn wraps_with_link_in_skeleton() {
    let skeleton = "<!--seam:u:attr:href--><link rel=\"canonical\"><p>page</p>";
    let result = wrap_document(skeleton, &["app.css".into()], &[], false, None);

    let head = result.split("</head>").next().unwrap();
    assert!(head.contains("app.css"));
    assert!(!head.contains("<!--seam:"), "slot markers must stay out of <head>");

    let body = result.split("__SEAM_ROOT__").nth(1).unwrap();
    assert!(body.contains("<!--seam:u:attr:href-->"));
    assert!(body.contains("rel=\"canonical\""));
  }

  #[test]
  fn dev_mode_injects_live_reload_script() {
    let result = wrap_document("<p>dev</p>", &[], &["app.js".into()], true, None);
    assert!(result.contains("WebSocket"), "dev_mode should inject WebSocket live reload");
    assert!(result.contains("/_seam/dev/ws"));
    let script_pos = result.find("WebSocket").unwrap();
    let module_pos = result.find("app.js").unwrap();
    let body_end = result.find("</body>").unwrap();
    assert!(script_pos > module_pos);
    assert!(script_pos < body_end);
  }

  #[test]
  fn production_mode_no_reload_script() {
    let result = wrap_document("<p>prod</p>", &[], &["app.js".into()], false, None);
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
    let result = wrap_document("<p>vite-dev</p>", &[], &[], true, Some(&vite));

    // Vite scripts present
    assert!(result.contains("/@vite/client"));
    // WebSocket live reload must NOT be injected — Vite HMR handles reload
    assert!(!result.contains("/_seam/dev/ws"), "vite mode must not inject WebSocket reload");
  }
}
