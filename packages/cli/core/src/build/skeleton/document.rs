/* packages/cli/core/src/build/skeleton/document.rs */

/// Wrap a skeleton HTML fragment in a compact HTML5 document with asset references.
/// Produces minimal single-line output for production templates.
pub fn wrap_document(skeleton: &str, css_files: &[String], js_files: &[String]) -> String {
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
  doc.push_str("</body></html>");
  doc
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn wraps_with_assets() {
    let result = wrap_document("<p>Hello</p>", &["style-abc.css".into()], &["main-xyz.js".into()]);
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
    let result = wrap_document("<p>Hi</p>", &[], &[]);
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
}
