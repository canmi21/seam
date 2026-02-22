/* packages/cli/core/src/build/skeleton/document.rs */

/// Wrap a skeleton HTML fragment in a compact HTML5 document with asset references.
/// Produces minimal single-line output for production templates.
///
/// `suspense_depth` injects React Suspense boundary markers (`<!--$-->` / `<!--/$-->`)
/// around the skeleton content so that client-side hydration sees the same comment
/// nodes that React's own `<Suspense>` boundaries would produce.
pub fn wrap_document(
  skeleton: &str,
  css_files: &[String],
  js_files: &[String],
  suspense_depth: u32,
) -> String {
  let mut doc = String::from("<!DOCTYPE html><html><head><meta charset=\"utf-8\">");
  for f in css_files {
    doc.push_str(&format!(r#"<link rel="stylesheet" href="/_seam/static/{f}">"#));
  }
  doc.push_str("</head><body><div id=\"__SEAM_ROOT__\">");
  for _ in 0..suspense_depth {
    doc.push_str("<!--$-->");
  }
  doc.push_str(skeleton);
  for _ in 0..suspense_depth {
    doc.push_str("<!--/$-->");
  }
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
    let result =
      wrap_document("<p>Hello</p>", &["style-abc.css".into()], &["main-xyz.js".into()], 0);
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
    let result = wrap_document("<p>Hi</p>", &[], &[], 0);
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
    let result = wrap_document(skeleton, &["style.css".into()], &[], 0);

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
    let result = wrap_document(skeleton, &["app.css".into()], &[], 0);

    let head = result.split("</head>").next().unwrap();
    assert!(head.contains("app.css"));
    assert!(!head.contains("<!--seam:"), "slot markers must stay out of <head>");

    let body = result.split("__SEAM_ROOT__").nth(1).unwrap();
    assert!(body.contains("<!--seam:u:attr:href-->"));
    assert!(body.contains("rel=\"canonical\""));
  }

  #[test]
  fn wraps_with_suspense_markers() {
    let result = wrap_document("<p>Hi</p>", &["app.css".into()], &["app.js".into()], 2);
    assert_eq!(
      result,
      concat!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\">",
        "<link rel=\"stylesheet\" href=\"/_seam/static/app.css\">",
        "</head><body>",
        "<div id=\"__SEAM_ROOT__\">",
        "<!--$--><!--$-->",
        "<p>Hi</p>",
        "<!--/$--><!--/$-->",
        "</div>",
        "<script type=\"module\" src=\"/_seam/static/app.js\"></script>",
        "</body></html>"
      )
    );
  }
}
