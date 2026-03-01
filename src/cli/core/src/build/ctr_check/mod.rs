/* src/cli/core/src/build/ctr_check/mod.rs */

// CTR equivalence check: verify that template injection produces
// semantically equivalent HTML to React's renderToString.
//
// Pipeline: parse → normalize → diff → report
// Eliminates false positives from attribute ordering, CSS property
// ordering, comment markers, and resource hint injection.

mod diff;
mod normalize;
mod parse;
mod report;

use anyhow::{Result, bail};
use serde_json::Value;

/// Verify that template injection with mock data produces semantically
/// equivalent HTML to React's renderToString with the same data.
pub(super) fn verify_ctr_equivalence(
  route_path: &str,
  react_html: &str,
  template: &str,
  mock_data: &Value,
  data_id: &str,
) -> Result<()> {
  let injected_raw = seam_injector::inject(template, mock_data, data_id);

  let mut react_tree = parse::parse_ctr_tree(react_html, data_id);
  let mut inject_tree = parse::parse_ctr_tree(&injected_raw, data_id);

  normalize::normalize_tree(&mut react_tree);
  normalize::normalize_tree(&mut inject_tree);

  let result = diff::diff_trees(&react_tree, &inject_tree, "");
  if result.diffs.is_empty() {
    return Ok(());
  }

  bail!("{}", report::format_ctr_report(route_path, &result.diffs, result.total_count));
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn matching_html_passes() {
    let template = "<p><!--seam:name--></p>";
    let data = json!({"name": "Alice"});
    let react_html = "<p>Alice</p>";

    let result = verify_ctr_equivalence("/test", react_html, template, &data, "__data");
    assert!(result.is_ok(), "expected Ok, got: {result:?}");
  }

  #[test]
  fn mismatched_style_fails() {
    let template = r#"<span style="background-color:var(--c-text-muted)"></span>"#;
    let data = json!({});
    let react_html = r#"<span style="background-color:#f1e05a"></span>"#;

    let result = verify_ctr_equivalence("/dashboard", react_html, template, &data, "__data");
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("CTR equivalence check failed"), "error: {err}");
    assert!(err.contains("/dashboard"), "error should mention route: {err}");
    // New: verify path info in error
    assert!(err.contains("span"), "error should contain element path: {err}");
  }

  #[test]
  fn mismatched_text_content_fails() {
    let template = "<p><!--seam:msg--></p>";
    let data = json!({"msg": "hello"});
    let react_html = "<p>world</p>";

    let result = verify_ctr_equivalence("/page", react_html, template, &data, "__data");
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("CTR equivalence check failed"));
    // New: verify path
    assert!(err.contains("p"), "error should contain element path: {err}");
  }

  #[test]
  fn empty_data_handles_gracefully() {
    let template = "<div>static content</div>";
    let data = json!({});
    let react_html = "<div>static content</div>";

    let result = verify_ctr_equivalence("/static", react_html, template, &data, "__data");
    assert!(result.is_ok());
  }

  #[test]
  fn resource_hints_stripped_from_inject_output() {
    // Inject output may contain <link rel="preload"> from sentinel-derived
    // slots that the mock render already stripped. Both sides must match.
    let template = concat!(
      r#"<!--seam:url:attr:href--><link rel="preload" as="image">"#,
      "<div><!--seam:name--></div>"
    );
    let data = json!({"url": "https://example.com/img.png", "name": "Alice"});
    let react_html = "<div>Alice</div>";

    let result = verify_ctr_equivalence("/test", react_html, template, &data, "__data");
    assert!(result.is_ok(), "resource hints should be stripped: {result:?}");
  }

  #[test]
  fn user_authored_links_preserved() {
    // <link rel="canonical"> is NOT a resource hint, must appear in parse output
    let nodes =
      parse::parse_ctr_tree(r#"<link rel="canonical" href="/page"><div>content</div>"#, "__data");
    assert_eq!(nodes.len(), 2);
    match &nodes[0] {
      parse::CtrNode::Element { tag, attrs, .. } => {
        assert_eq!(tag, "link");
        assert_eq!(attrs.get("rel").unwrap(), "canonical");
      }
      _ => panic!("expected link Element"),
    }
  }

  /// Full pipeline: sentinel HTML -> sentinel_to_slots -> inject -> compare.
  #[test]
  fn style_binding_full_pipeline() {
    use crate::build::skeleton::sentinel_to_slots;

    let sentinel_html = r#"<span style="background-color:%%SEAM:color%%">test</span>"#;
    let template = sentinel_to_slots(sentinel_html);
    assert_eq!(template, "<!--seam:color:style:background-color--><span>test</span>");

    let react_html = r#"<span style="background-color:#f1e05a">test</span>"#;
    let data = json!({"color": "#f1e05a"});

    let result = verify_ctr_equivalence("/test", react_html, &template, &data, "__data");
    assert!(result.is_ok(), "style binding round-trip failed: {result:?}");
  }

  /// Different property order in style attributes should pass CTR check.
  #[test]
  fn style_property_order_mismatch_passes() {
    let template =
      r#"<!--seam:color:style:background-color--><span style="display:inline-block"></span>"#;
    let react_html = r#"<span style="background-color:#f1e05a;display:inline-block"></span>"#;
    let data = json!({"color": "#f1e05a"});

    let result = verify_ctr_equivalence("/test", react_html, template, &data, "__data");
    assert!(result.is_ok(), "style order mismatch should pass: {result:?}");
  }

  /// Full pipeline where dynamic property PRECEDES static in JSX order.
  #[test]
  fn style_order_with_real_pipeline() {
    use crate::build::skeleton::sentinel_to_slots;

    let sentinel_html =
      r#"<span style="background-color:%%SEAM:color%%;display:inline-block">test</span>"#;
    let template = sentinel_to_slots(sentinel_html);

    let react_html = r#"<span style="background-color:#f1e05a;display:inline-block">test</span>"#;
    let data = json!({"color": "#f1e05a"});

    let result = verify_ctr_equivalence("/test", react_html, &template, &data, "__data");
    assert!(result.is_ok(), "dynamic-before-static order should pass: {result:?}");
  }

  /// Style binding with mixed static + dynamic properties.
  #[test]
  fn style_binding_mixed_static_dynamic() {
    use crate::build::skeleton::sentinel_to_slots;

    let sentinel_html =
      r#"<span style="display:inline-block;background-color:%%SEAM:color%%">test</span>"#;
    let template = sentinel_to_slots(sentinel_html);
    assert!(template.contains("<!--seam:color:style:background-color-->"));
    assert!(template.contains(r#"style="display:inline-block""#));

    let react_html = r#"<span style="display:inline-block;background-color:#f1e05a">test</span>"#;
    let data = json!({"color": "#f1e05a"});

    let result = verify_ctr_equivalence("/test", react_html, &template, &data, "__data");
    assert!(result.is_ok(), "mixed style binding failed: {result:?}");
  }

  /// Attribute order mismatch should pass (BTreeMap normalizes key order).
  #[test]
  fn attr_order_mismatch_passes() {
    // React outputs class before id, inject might output id before class.
    // Both parse into the same BTreeMap.
    let template = r#"<div id="x" class="red"><!--seam:name--></div>"#;
    let data = json!({"name": "Alice"});
    // React output with different attr order
    let react_html = r#"<div class="red" id="x">Alice</div>"#;

    let result = verify_ctr_equivalence("/test", react_html, template, &data, "__data");
    assert!(result.is_ok(), "attr order mismatch should pass: {result:?}");
  }

  /// Multiple diffs produce numbered list with paths.
  #[test]
  fn multi_diff_error_message() {
    let template = r#"<div><p><!--seam:a--></p><span><!--seam:b--></span></div>"#;
    let data = json!({"a": "wrong_a", "b": "wrong_b"});
    let react_html = r#"<div><p>right_a</p><span>right_b</span></div>"#;

    let result = verify_ctr_equivalence("/multi", react_html, template, &data, "__data");
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("1."), "should have numbered diff: {err}");
    assert!(err.contains("2."), "should have second numbered diff: {err}");
    assert!(err.contains("p"), "should mention <p> path: {err}");
    assert!(err.contains("span"), "should mention <span> path: {err}");
  }
}
