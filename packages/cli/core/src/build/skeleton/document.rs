/* packages/cli/core/src/build/skeleton/document.rs */

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
pub fn wrap_document(
  skeleton: &str,
  css_files: &[String],
  js_files: &[String],
  dev_mode: bool,
) -> String {
  let mut doc = String::from("<!DOCTYPE html><html><head><meta charset=\"utf-8\">");
  for f in css_files {
    doc.push_str(&format!(r#"<link rel="stylesheet" href="/_seam/static/{f}">"#));
  }
  doc.push_str("</head><body><div id=\"__SEAM_ROOT__\">");
  doc.push_str(skeleton);
  doc.push_str("</div>");
  for f in js_files {
    doc.push_str(&format!(r#"<script type="module" src="/_seam/static/{f}"></script>"#));
  }
  if dev_mode {
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
    let result =
      wrap_document("<p>Hello</p>", &["style-abc.css".into()], &["main-xyz.js".into()], false);
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
    let result = wrap_document("<p>Hi</p>", &[], &[], false);
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
    // Float-hoisted metadata stays inside __SEAM_ROOT__, not in <head>
    let skeleton =
      "<title><!--seam:t--></title><!--seam:d:attr:content--><meta name=\"desc\"><p>content</p>";
    let result = wrap_document(skeleton, &["style.css".into()], &[], false);

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
    // <link> slot in skeleton must not conflict with <link> CSS refs in <head>
    let skeleton = "<!--seam:u:attr:href--><link rel=\"canonical\"><p>page</p>";
    let result = wrap_document(skeleton, &["app.css".into()], &[], false);

    let head = result.split("</head>").next().unwrap();
    assert!(head.contains("app.css"));
    assert!(!head.contains("<!--seam:"), "slot markers must stay out of <head>");

    let body = result.split("__SEAM_ROOT__").nth(1).unwrap();
    assert!(body.contains("<!--seam:u:attr:href-->"));
    assert!(body.contains("rel=\"canonical\""));
  }

  #[test]
  fn dev_mode_injects_live_reload_script() {
    let result = wrap_document("<p>dev</p>", &[], &["app.js".into()], true);
    assert!(result.contains("WebSocket"), "dev_mode should inject WebSocket live reload");
    assert!(result.contains("/_seam/dev/ws"));
    // Script must appear after JS modules but before </body>
    let script_pos = result.find("WebSocket").unwrap();
    let module_pos = result.find("app.js").unwrap();
    let body_end = result.find("</body>").unwrap();
    assert!(script_pos > module_pos);
    assert!(script_pos < body_end);
  }

  #[test]
  fn production_mode_no_reload_script() {
    let result = wrap_document("<p>prod</p>", &[], &["app.js".into()], false);
    assert!(!result.contains("WebSocket"), "production mode must not inject live reload");
  }
}
