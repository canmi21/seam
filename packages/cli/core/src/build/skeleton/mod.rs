/* packages/cli/core/src/build/skeleton/mod.rs */

mod document;
mod extract;
mod slot;

pub use document::wrap_document;
pub use extract::extract_template;
pub use slot::sentinel_to_slots;

use serde::Deserialize;

/// Axis describes one structural dimension that affects template rendering.
#[derive(Debug, Clone, Deserialize)]
pub struct Axis {
  pub path: String,
  pub kind: String,
  pub values: Vec<serde_json::Value>,
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
    let doc = wrap_document(&template, &["app.css".into()], &["app.js".into()]);
    assert!(doc.starts_with("<!DOCTYPE html>"));
    assert!(doc.contains("__SEAM_ROOT__"));
    assert!(doc.contains("<!--seam:user.name-->"));
    assert!(doc.contains("<!--seam:if:user.avatar-->"));
    assert!(doc.contains("app.css"));
    assert!(doc.contains("app.js"));
  }

  #[test]
  fn attribute_and_text_mixed_pipeline() {
    let html = r#"<div><a href="%%SEAM:link.url%%">%%SEAM:link.text%%</a></div>"#;
    let result = sentinel_to_slots(html);
    let doc = wrap_document(&result, &[], &[]);
    assert!(doc.contains("<!--seam:link.url:attr:href-->"));
    assert!(doc.contains("<!--seam:link.text-->"));
    assert!(!doc.contains("%%SEAM:"));
  }
}
