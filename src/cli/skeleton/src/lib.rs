/* src/cli/skeleton/src/lib.rs */

mod document;
mod extract;
mod slot;

pub use document::{extract_head_metadata, wrap_document};
pub use extract::extract_template;
pub use slot::sentinel_to_slots;

pub mod ctr_check;
pub mod slot_warning;

use serde::Deserialize;

/// Axis describes one structural dimension that affects template rendering.
#[derive(Debug, Clone, Deserialize)]
pub struct Axis {
  pub path: String,
  pub kind: String,
  pub values: Vec<serde_json::Value>,
}

/// Vite dev server info, threaded through the build pipeline to replace
/// static asset references with Vite-served modules.
#[derive(Debug, Clone)]
pub struct ViteDevInfo {
  pub origin: String,
  pub entry: String,
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  // -- Integration tests spanning multiple sub-modules --

  fn make_axis(path: &str, kind: &str, values: Vec<serde_json::Value>) -> Axis {
    Axis { path: path.to_string(), kind: kind.to_string(), values }
  }

  #[test]
  fn full_pipeline_snapshot() {
    let sentinel_html =
      r#"<div><h1>%%SEAM:user.name%%</h1><p>%%SEAM:user.email%%</p> <span>Has avatar</span></div>"#;
    let nulled_html = r#"<div><h1>%%SEAM:user.name%%</h1><p>%%SEAM:user.email%%</p></div>"#;

    // Step 1: sentinel -> slots
    let slotted = sentinel_to_slots(sentinel_html);
    assert_eq!(
      slotted,
      r#"<div><h1><!--seam:user.name--></h1><p><!--seam:user.email--></p> <span>Has avatar</span></div>"#
    );

    let nulled_slotted = sentinel_to_slots(nulled_html);

    // Step 2: template extraction via multi-variant diff
    let axes = vec![make_axis("user.avatar", "nullable", vec![json!("present"), json!(null)])];
    let variants = vec![slotted, nulled_slotted];
    let template = extract_template(&axes, &variants);
    assert!(template.contains("<!--seam:if:user.avatar-->"));
    assert!(template.contains("<!--seam:endif:user.avatar-->"));
    assert!(template.contains("<span>Has avatar</span>"));

    // Step 3: document wrapping
    let doc =
      wrap_document(&template, &["app.css".into()], &["app.js".into()], false, None, "__seam");
    assert!(doc.starts_with("<!DOCTYPE html>"));
    assert!(doc.contains("__seam"));
    assert!(doc.contains("<!--seam:user.name-->"));
    assert!(doc.contains("<!--seam:if:user.avatar-->"));
    assert!(doc.contains("app.css"));
    assert!(doc.contains("app.js"));
  }

  #[test]
  fn attribute_and_text_mixed_pipeline() {
    let html = r#"<div><a href="%%SEAM:link.url%%">%%SEAM:link.text%%</a></div>"#;
    let result = sentinel_to_slots(html);
    let doc = wrap_document(&result, &[], &[], false, None, "__seam");
    assert!(doc.contains("<!--seam:link.url:attr:href-->"));
    assert!(doc.contains("<!--seam:link.text-->"));
    assert!(!doc.contains("%%SEAM:"));
  }

  #[test]
  fn float_hoisted_metadata_pipeline() {
    // Float metadata: title + meta + link alongside regular content
    let html = r#"<title>%%SEAM:t%%</title><meta name="desc" content="%%SEAM:d%%"><link rel="canonical" href="%%SEAM:u%%"><div><p>%%SEAM:body%%</p></div>"#;

    let slotted = sentinel_to_slots(html);
    assert!(slotted.contains("<!--seam:t-->"));
    assert!(slotted.contains("<!--seam:d:attr:content-->"));
    assert!(slotted.contains("<!--seam:u:attr:href-->"));

    let doc =
      wrap_document(&slotted, &["style.css".into()], &["app.js".into()], false, None, "__seam");
    assert!(doc.starts_with("<!DOCTYPE html>"));

    // Markers extracted into <head>
    let head = doc.split("</head>").next().unwrap();
    assert!(head.contains("<!--seam:t-->"), "title slot in <head>");
    assert!(head.contains("<!--seam:d:attr:content-->"), "meta slot in <head>");
    assert!(head.contains("<!--seam:u:attr:href-->"), "link slot in <head>");
    assert!(head.contains("style.css"));

    let root = &doc[doc.find("__seam").unwrap()..];
    assert!(!root.contains("<title>"), "title not in root");
    assert!(root.contains("<!--seam:body-->"), "body content in root");
  }

  #[test]
  fn float_metadata_with_boolean_axis() {
    // Conditional <meta> tag via nullable axis
    let with_meta = sentinel_to_slots(
      r#"<title>%%SEAM:t%%</title><meta name="og" content="%%SEAM:og%%"><p>%%SEAM:body%%</p>"#,
    );
    let without_meta = sentinel_to_slots(r#"<title>%%SEAM:t%%</title><p>%%SEAM:body%%</p>"#);

    let axes = vec![make_axis("og", "nullable", vec![json!("present"), json!(null)])];
    let variants = vec![with_meta, without_meta];
    let template = extract_template(&axes, &variants);

    assert!(template.contains("<!--seam:if:og-->"));
    assert!(template.contains("<!--seam:endif:og-->"));
    assert!(template.contains("<!--seam:t-->"));
    assert!(template.contains("<!--seam:body-->"));

    let doc = wrap_document(&template, &[], &[], false, None, "__seam");
    let head = doc.split("</head>").next().unwrap();
    assert!(head.contains("<!--seam:t-->"), "title slot in <head>");
    // Conditional meta also extracted since if/endif + meta are all metadata-like
    assert!(head.contains("<!--seam:if:og-->"), "conditional in <head>");
  }
}
