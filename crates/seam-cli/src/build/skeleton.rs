/* crates/seam-cli/src/build/skeleton.rs */

use std::sync::OnceLock;

use regex::Regex;

fn attr_re() -> &'static Regex {
  static RE: OnceLock<Regex> = OnceLock::new();
  RE.get_or_init(|| Regex::new(r#"(\w+)="%%SEAM:([^%]+)%%""#).unwrap())
}

fn text_re() -> &'static Regex {
  static RE: OnceLock<Regex> = OnceLock::new();
  RE.get_or_init(|| Regex::new(r"%%SEAM:([^%]+)%%").unwrap())
}

fn tag_re() -> &'static Regex {
  static RE: OnceLock<Regex> = OnceLock::new();
  RE.get_or_init(|| Regex::new(r"<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>").unwrap())
}

/// Replace text sentinels `%%SEAM:path%%` with slot markers `<!--seam:path-->`.
/// Also handle attribute sentinels: `attr="%%SEAM:path%%"` inside tags
/// becomes a `<!--seam:path:attr:attrName-->` comment before the tag.
pub fn sentinel_to_slots(html: &str) -> String {
  let attr_re = attr_re();
  let text_re = text_re();
  let tag_re = tag_re();

  let mut result = String::with_capacity(html.len());
  let mut last_end = 0;

  for cap in tag_re.captures_iter(html) {
    let full_match = cap.get(0).unwrap();
    let attrs_part = cap.get(2).unwrap().as_str();

    // Check if this tag contains attribute sentinels
    if !attr_re.is_match(attrs_part) {
      // No attribute sentinels, copy as-is up to end of this match
      result.push_str(&html[last_end..full_match.end()]);
      last_end = full_match.end();
      continue;
    }

    // Copy text between previous match and start of this tag
    result.push_str(&html[last_end..full_match.start()]);

    // Collect attribute sentinel comments to insert before the tag
    let mut comments = Vec::new();
    for attr_cap in attr_re.captures_iter(attrs_part) {
      let attr_name = &attr_cap[1];
      let path = &attr_cap[2];
      comments.push(format!("<!--seam:{path}:attr:{attr_name}-->"));
    }

    // Insert comments before the tag
    for comment in &comments {
      result.push_str(comment);
    }

    // Rebuild the tag without the sentinel attributes
    let tag_name = cap.get(1).unwrap().as_str();
    let cleaned_attrs = attr_re.replace_all(attrs_part, "");
    let cleaned_attrs = cleaned_attrs.trim();

    if cleaned_attrs.is_empty() {
      result.push_str(&format!("<{tag_name}>"));
    } else {
      result.push_str(&format!("<{tag_name} {cleaned_attrs}>"));
    }

    last_end = full_match.end();
  }

  // Copy remaining text after last tag match
  result.push_str(&html[last_end..]);

  // Second pass: replace remaining text sentinels
  let output = text_re.replace_all(&result, "<!--seam:$1-->");
  output.into_owned()
}

/// Detect conditional block by diffing full HTML against nulled HTML.
/// Returns the full HTML with the disappearing block wrapped in if/endif markers.
pub fn detect_conditional(
  full_html: &str,
  nulled_html: &str,
  field: &str,
) -> Option<ConditionalBlock> {
  if full_html == nulled_html {
    return None;
  }

  // Find longest common prefix
  let prefix_len = full_html.bytes().zip(nulled_html.bytes()).take_while(|(a, b)| a == b).count();

  // Find longest common suffix (avoiding overlap with prefix)
  let full_remaining = &full_html[prefix_len..];
  let nulled_remaining = &nulled_html[prefix_len..];
  let suffix_len = full_remaining
    .bytes()
    .rev()
    .zip(nulled_remaining.bytes().rev())
    .take_while(|(a, b)| a == b)
    .count();

  let block_start = prefix_len;
  let block_end = full_html.len() - suffix_len;

  if block_start >= block_end {
    return None;
  }

  Some(ConditionalBlock { start: block_start, end: block_end, field: field.to_string() })
}

#[derive(Debug)]
pub struct ConditionalBlock {
  pub start: usize,
  pub end: usize,
  pub field: String,
}

/// Apply conditional blocks to HTML. Blocks must be sorted by position descending
/// to preserve offsets during insertion.
pub fn apply_conditionals(html: &str, mut blocks: Vec<ConditionalBlock>) -> String {
  let mut result = html.to_string();
  // Sort by start position descending so insertions don't shift earlier positions
  blocks.sort_by(|a, b| b.start.cmp(&a.start));

  for block in &blocks {
    let endif = format!("<!--seam:endif:{}-->", block.field);
    let ifstart = format!("<!--seam:if:{}-->", block.field);
    result.insert_str(block.end, &endif);
    result.insert_str(block.start, &ifstart);
  }
  result
}

/// Wrap a skeleton HTML fragment in a full HTML5 document with asset references.
pub fn wrap_document(skeleton: &str, css_files: &[String], js_files: &[String]) -> String {
  let css_links: String = css_files
    .iter()
    .map(|f| format!(r#"<link rel="stylesheet" href="/seam/assets/{f}">"#))
    .collect::<Vec<_>>()
    .join("\n    ");

  let js_scripts: String = js_files
    .iter()
    .map(|f| format!(r#"<script type="module" src="/seam/assets/{f}"></script>"#))
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

  // -- sentinel_to_slots --

  #[test]
  fn text_sentinels() {
    let html = "<p>%%SEAM:user.name%%</p>";
    assert_eq!(sentinel_to_slots(html), "<p><!--seam:user.name--></p>");
  }

  #[test]
  fn attribute_sentinels() {
    let html = r#"<img src="%%SEAM:user.avatar%%" alt="avatar">"#;
    let result = sentinel_to_slots(html);
    assert!(result.contains("<!--seam:user.avatar:attr:src-->"));
    assert!(!result.contains("%%SEAM:"));
    assert!(result.contains(r#"alt="avatar">"#));
  }

  #[test]
  fn mixed_sentinels() {
    let html = r#"<a href="%%SEAM:url%%">%%SEAM:label%%</a>"#;
    let result = sentinel_to_slots(html);
    assert!(result.contains("<!--seam:url:attr:href-->"));
    assert!(result.contains("<!--seam:label-->"));
    assert!(!result.contains("%%SEAM:"));
  }

  #[test]
  fn no_sentinels() {
    let html = "<p>Hello world</p>";
    assert_eq!(sentinel_to_slots(html), html);
  }

  #[test]
  fn multiple_text_sentinels() {
    let html = "<div>%%SEAM:a%% and %%SEAM:b%%</div>";
    let result = sentinel_to_slots(html);
    assert_eq!(result, "<div><!--seam:a--> and <!--seam:b--></div>");
  }

  // -- detect_conditional --

  #[test]
  fn simple_conditional() {
    // Boundaries must differ at the branch point for clean extraction.
    // React output typically has distinct characters at conditional edges.
    let full = "<div>Hello<span>Avatar</span>World</div>";
    let nulled = "<div>HelloWorld</div>";
    let block = detect_conditional(full, nulled, "user.avatar").unwrap();
    assert_eq!(&full[block.start..block.end], "<span>Avatar</span>");
  }

  #[test]
  fn identical_html_no_conditional() {
    let html = "<div>Same</div>";
    assert!(detect_conditional(html, html, "field").is_none());
  }

  #[test]
  fn apply_multiple_conditionals() {
    let html = "<div><p>A</p><p>B</p><p>C</p></div>";
    let blocks = vec![
      ConditionalBlock { start: 5, end: 13, field: "a".into() },
      ConditionalBlock { start: 13, end: 21, field: "b".into() },
    ];
    let result = apply_conditionals(html, blocks);
    assert!(result.contains("<!--seam:if:a--><p>A</p><!--seam:endif:a-->"));
    assert!(result.contains("<!--seam:if:b--><p>B</p><!--seam:endif:b-->"));
  }

  // -- wrap_document --

  #[test]
  fn wraps_with_assets() {
    let result = wrap_document("<p>Hello</p>", &["style-abc.css".into()], &["main-xyz.js".into()]);
    assert!(result.starts_with("<!DOCTYPE html>"));
    assert!(result.contains(r#"<link rel="stylesheet" href="/seam/assets/style-abc.css">"#));
    assert!(result.contains("<div id=\"__SEAM_ROOT__\"><p>Hello</p></div>"));
    assert!(result.contains(r#"<script type="module" src="/seam/assets/main-xyz.js">"#));
    assert!(result.ends_with("</body>\n</html>"));
  }

  #[test]
  fn wraps_without_assets() {
    let result = wrap_document("<p>Hi</p>", &[], &[]);
    assert!(result.contains("<p>Hi</p>"));
    assert!(!result.contains("<link"));
    assert!(!result.contains("<script"));
  }

  // -- Full pipeline snapshot --

  #[test]
  fn full_pipeline_snapshot() {
    // Use space separator so conditional boundary is clean
    // (shared `<` between `<span>` and `</div>` causes off-by-one otherwise)
    let sentinel_html =
      r#"<div><h1>%%SEAM:user.name%%</h1><p>%%SEAM:user.email%%</p> <span>Has avatar</span></div>"#;
    let nulled_html = r#"<div><h1>%%SEAM:user.name%%</h1><p>%%SEAM:user.email%%</p></div>"#;

    // Step 1: sentinel -> slots
    let slotted = sentinel_to_slots(sentinel_html);
    assert_eq!(
      slotted,
      r#"<div><h1><!--seam:user.name--></h1><p><!--seam:user.email--></p> <span>Has avatar</span></div>"#
    );

    // Step 2: conditional detection
    let nulled_slotted = sentinel_to_slots(nulled_html);
    let block = detect_conditional(&slotted, &nulled_slotted, "user.avatar").unwrap();
    let with_conditional = apply_conditionals(&slotted, vec![block]);
    assert!(with_conditional.contains("<!--seam:if:user.avatar-->"));
    assert!(with_conditional.contains("<!--seam:endif:user.avatar-->"));
    assert!(with_conditional.contains("<span>Has avatar</span>"));

    // Step 3: document wrapping
    let doc = wrap_document(&with_conditional, &["app.css".into()], &["app.js".into()]);
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
