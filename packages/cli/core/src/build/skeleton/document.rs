/* packages/cli/core/src/build/skeleton/document.rs */

/// Wrap a skeleton HTML fragment in a full HTML5 document with asset references.
pub fn wrap_document(skeleton: &str, css_files: &[String], js_files: &[String]) -> String {
  let css_links: String = css_files
    .iter()
    .map(|f| format!(r#"<link rel="stylesheet" href="/_seam/static/{f}">"#))
    .collect::<Vec<_>>()
    .join("\n    ");

  let js_scripts: String = js_files
    .iter()
    .map(|f| format!(r#"<script type="module" src="/_seam/static/{f}"></script>"#))
    .collect::<Vec<_>>()
    .join("\n    ");

  let mut doc = String::from("<!DOCTYPE html>\n<html>\n<head>\n    <meta charset=\"utf-8\">\n");
  if !css_links.is_empty() {
    doc.push_str("    ");
    doc.push_str(&css_links);
    doc.push('\n');
  }
  doc.push_str("</head>\n<body>\n    <div id=\"__SEAM_ROOT__\">");
  doc.push_str(skeleton);
  doc.push_str("</div>\n");
  if !js_scripts.is_empty() {
    doc.push_str("    ");
    doc.push_str(&js_scripts);
    doc.push('\n');
  }
  doc.push_str("</body>\n</html>");
  doc
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn wraps_with_assets() {
    let result = wrap_document("<p>Hello</p>", &["style-abc.css".into()], &["main-xyz.js".into()]);
    assert!(result.starts_with("<!DOCTYPE html>"));
    assert!(result.contains(r#"<link rel="stylesheet" href="/_seam/static/style-abc.css">"#));
    assert!(result.contains("<div id=\"__SEAM_ROOT__\"><p>Hello</p></div>"));
    assert!(result.contains(r#"<script type="module" src="/_seam/static/main-xyz.js">"#));
    assert!(result.ends_with("</body>\n</html>"));
  }

  #[test]
  fn wraps_without_assets() {
    let result = wrap_document("<p>Hi</p>", &[], &[]);
    assert!(result.contains("<p>Hi</p>"));
    assert!(!result.contains("<link"));
    assert!(!result.contains("<script"));
  }
}
