/* packages/cli/core/src/build/ctr_check.rs */

// CTR equivalence check: compare React-rendered HTML (with real data)
// against template-injected HTML to detect runtime computations that
// consume sentinel placeholders.

use std::sync::OnceLock;

use anyhow::{bail, Result};
use regex::Regex;
use serde_json::Value;

/// Strip the `__SEAM_DATA__` script appended by `inject()`.
/// The script is always at the end for fragments (no `</body>` tag).
fn strip_data_script(html: &str) -> &str {
  const MARKER: &str = r#"<script id="__SEAM_DATA__""#;
  match html.rfind(MARKER) {
    Some(pos) => html[..pos].trim_end(),
    None => html,
  }
}

fn resource_hint_re() -> &'static Regex {
  static RE: OnceLock<Regex> = OnceLock::new();
  RE.get_or_init(|| {
    Regex::new(
      r#"(?i)<link[^>]+rel\s*=\s*"(?:preload|dns-prefetch|preconnect)"[^>]*>|<link[^>]+data-precedence[^>]*>"#,
    )
    .unwrap()
  })
}

/// Strip React-injected resource hint `<link>` tags.
/// Mirrors the JS-side `stripResourceHints` so both comparison sides
/// receive the same treatment. Without this, sentinel-derived `<link>`
/// slots (e.g. for `<img>` preload hints) would appear in the injected
/// output but not in the mock render (which already strips them).
fn strip_resource_hints(html: &str) -> String {
  resource_hint_re().replace_all(html, "").into_owned()
}

/// Verify that template injection with mock data produces identical
/// HTML to React's `renderToString` with the same mock data.
pub(super) fn verify_ctr_equivalence(
  route_path: &str,
  react_html: &str,
  template: &str,
  mock_data: &Value,
) -> Result<()> {
  let injected_raw = seam_server::injector::inject(template, mock_data);
  let injected_clean = strip_resource_hints(strip_data_script(&injected_raw));

  if react_html == injected_clean {
    return Ok(());
  }

  bail!("{}", format_ctr_error(route_path, react_html, &injected_clean));
}

fn format_ctr_error(route_path: &str, react_html: &str, injected_html: &str) -> String {
  let diff_pos = react_html
    .bytes()
    .zip(injected_html.bytes())
    .position(|(a, b)| a != b)
    .unwrap_or(react_html.len().min(injected_html.len()));

  let context_radius = 30;

  let react_snippet = extract_context(react_html, diff_pos, context_radius);
  let inject_snippet = extract_context(injected_html, diff_pos, context_radius);

  // Caret position: offset from the start of the displayed snippet
  let caret_offset = diff_pos.saturating_sub(diff_pos.saturating_sub(context_radius));
  let caret_line = format!("{}^", " ".repeat(caret_offset));

  format!(
    "\
[seam] error: CTR equivalence check failed

  Route: {route_path}

  React rendered:
    ...{react_snippet}...
    {caret_line}

  Template injected:
    ...{inject_snippet}...
    {caret_line}

  The template output differs from what React produces with the same data.
  This means the component transforms data before rendering -- the sentinel
  placeholder was consumed by a runtime computation (e.g. map lookup,
  string formatting) and the result got hardcoded into the template.

  CTR requires pure data flow: procedure -> data -> template -> HTML.
  Move the computation into your procedure handler and return the
  computed value as a dedicated field."
  )
}

fn extract_context(s: &str, center: usize, radius: usize) -> &str {
  let start = s.floor_char_boundary(center.saturating_sub(radius));
  let end = s.ceil_char_boundary((center + radius).min(s.len()));
  &s[start..end]
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn matching_html_passes() {
    // Template with a simple text slot
    let template = "<p><!--seam:name--></p>";
    let data = json!({"name": "Alice"});
    let react_html = "<p>Alice</p>";

    let result = verify_ctr_equivalence("/test", react_html, template, &data);
    assert!(result.is_ok(), "expected Ok, got: {result:?}");
  }

  #[test]
  fn mismatched_style_fails() {
    // Template has a hardcoded style value where React computes a different one
    let template = r#"<span style="background-color:var(--c-text-muted)"></span>"#;
    let data = json!({});
    let react_html = r#"<span style="background-color:#f1e05a"></span>"#;

    let result = verify_ctr_equivalence("/dashboard", react_html, template, &data);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("CTR equivalence check failed"), "error: {err}");
    assert!(err.contains("/dashboard"), "error should mention route: {err}");
  }

  #[test]
  fn mismatched_text_content_fails() {
    // Template injects "hello", React produces "world"
    let template = "<p><!--seam:msg--></p>";
    let data = json!({"msg": "hello"});
    let react_html = "<p>world</p>";

    let result = verify_ctr_equivalence("/page", react_html, template, &data);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("CTR equivalence check failed"));
  }

  #[test]
  fn empty_data_handles_gracefully() {
    let template = "<div>static content</div>";
    let data = json!({});
    let react_html = "<div>static content</div>";

    let result = verify_ctr_equivalence("/static", react_html, template, &data);
    assert!(result.is_ok());
  }

  #[test]
  fn strip_data_script_removes_appended_script() {
    let html = r#"<p>hello</p><script id="__SEAM_DATA__" type="application/json">{"x":1}</script>"#;
    assert_eq!(strip_data_script(html), "<p>hello</p>");
  }

  #[test]
  fn strip_data_script_no_script_unchanged() {
    let html = "<p>hello</p>";
    assert_eq!(strip_data_script(html), html);
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

    let result = verify_ctr_equivalence("/test", react_html, template, &data);
    assert!(result.is_ok(), "resource hints should be stripped: {result:?}");
  }

  #[test]
  fn user_authored_links_preserved() {
    // <link rel="canonical"> is NOT a resource hint, must not be stripped
    let html = r#"<link rel="canonical" href="/page"><div>content</div>"#;
    assert_eq!(strip_resource_hints(html), html);
  }
}
