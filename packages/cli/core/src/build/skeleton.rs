/* packages/cli/core/src/build/skeleton.rs */

use std::sync::OnceLock;

use regex::Regex;
use serde::Deserialize;

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

// -- Multi-variant diff (CTR v2) --

/// Axis describes one structural dimension that affects template rendering.
#[derive(Debug, Deserialize)]
pub struct Axis {
  pub path: String,
  pub kind: String,
  pub values: Vec<serde_json::Value>,
}

/// Two-way diff: find common prefix/suffix between two strings, return (start, end_a, end_b)
/// where a[start..end_a] and b[start..end_b] are the differing regions.
fn two_way_diff(a: &str, b: &str) -> (usize, usize, usize) {
  let prefix_len = a.bytes().zip(b.bytes()).take_while(|(x, y)| x == y).count();

  let a_rem = &a[prefix_len..];
  let b_rem = &b[prefix_len..];
  let suffix_len = a_rem.bytes().rev().zip(b_rem.bytes().rev()).take_while(|(x, y)| x == y).count();

  let mut start = prefix_len;
  let mut end_a = a.len() - suffix_len;
  let mut end_b = b.len() - suffix_len;

  // Adjust for shared `<` at prefix boundary: the `<` belongs to the block's tag
  if start > 0 && a.as_bytes()[start - 1] == b'<' {
    start -= 1;
  }
  // Adjust for shared `<` at end boundary
  if end_a > start && a.as_bytes()[end_a - 1] == b'<' {
    end_a -= 1;
  }
  if end_b > start && b.as_bytes()[end_b - 1] == b'<' {
    end_b -= 1;
  }
  // Adjust for shared `>` at suffix boundary: the `>` belongs to the block's closing tag
  if end_a < a.len() && a.as_bytes()[end_a] == b'>' {
    end_a += 1;
  }
  if end_b < b.len() && b.as_bytes()[end_b] == b'>' {
    end_b += 1;
  }

  (start, end_a, end_b)
}

/// N-way diff: find common prefix/suffix across all variants.
fn n_way_prefix_suffix(variants: &[&str]) -> (usize, usize) {
  if variants.is_empty() {
    return (0, 0);
  }
  let first = variants[0];

  // Common prefix length
  let mut prefix_len = first.len();
  for v in &variants[1..] {
    let common = first.bytes().zip(v.bytes()).take_while(|(a, b)| a == b).count();
    prefix_len = prefix_len.min(common);
  }

  // Common suffix length (avoiding overlap with prefix)
  let mut suffix_len = 0;
  let min_remaining = variants.iter().map(|v| v.len() - prefix_len).min().unwrap_or(0);
  let first_bytes = first.as_bytes();
  'outer: for i in 0..min_remaining {
    let c = first_bytes[first.len() - 1 - i];
    for v in &variants[1..] {
      if v.as_bytes()[v.len() - 1 - i] != c {
        break 'outer;
      }
    }
    suffix_len += 1;
  }

  (prefix_len, suffix_len)
}

/// Effect to apply to the base HTML.
#[derive(Debug)]
struct AxisEffect {
  start: usize,
  end: usize,
  replacement: String,
}

/// Extract a complete Slot Protocol v2 template from variant HTML strings.
/// Uses the axes metadata to determine which variants to diff for each axis.
pub fn extract_template(axes: &[Axis], variants: &[String]) -> String {
  if variants.is_empty() {
    return String::new();
  }
  if variants.len() == 1 || axes.is_empty() {
    return variants[0].clone();
  }

  // Use the first variant as the base
  let base = &variants[0];
  let mut effects: Vec<AxisEffect> = Vec::new();

  for (axis_idx, axis) in axes.iter().enumerate() {
    // Find variant pairs/groups that differ only in this axis
    // Strategy: find the base variant index (first one) and one that differs only in this axis
    match axis.kind.as_str() {
      "boolean" | "nullable" => {
        // Find two variants that differ only in this axis
        if let Some((vi_true, vi_false)) = find_pair_for_axis(axes, variants, axis_idx) {
          let html_a = &variants[vi_true];
          let html_b = &variants[vi_false];
          let (start, end_a, end_b) = two_way_diff(html_a, html_b);

          let block_a = &html_a[start..end_a];
          let block_b = &html_b[start..end_b];

          let marker = if block_a.is_empty() && !block_b.is_empty() {
            // false has content, true is empty — invert
            format!("<!--seam:if:{}-->{}<!--seam:endif:{}-->", axis.path, block_b, axis.path)
          } else if !block_a.is_empty() && block_b.is_empty() {
            // true has content (if-only)
            format!("<!--seam:if:{}-->{}<!--seam:endif:{}-->", axis.path, block_a, axis.path)
          } else if !block_a.is_empty() && !block_b.is_empty() {
            // Both have content (if-else)
            format!(
              "<!--seam:if:{}-->{}<!--seam:else-->{}<!--seam:endif:{}-->",
              axis.path, block_a, block_b, axis.path
            )
          } else {
            continue;
          };

          // Use the start position relative to the base variant
          // Find where this diff occurs in the base
          let (base_start, base_end, _) = two_way_diff(base, html_b);
          effects.push(AxisEffect { start: base_start, end: base_end, replacement: marker });
        }
      }
      "enum" => {
        // Find N variants, one per enum value
        let groups = find_enum_group_for_axis(axes, variants, axis_idx);
        if groups.len() < 2 {
          continue;
        }

        let html_strs: Vec<&str> = groups.iter().map(|(_, vi)| variants[*vi].as_str()).collect();
        let (prefix_len, suffix_len) = n_way_prefix_suffix(&html_strs);

        let mut start = prefix_len;
        // Adjust for shared `<` at boundary
        if start > 0 && html_strs[0].as_bytes()[start - 1] == b'<' {
          start -= 1;
        }

        let mut branches = String::new();
        for (value, vi) in &groups {
          let html = &variants[*vi];
          let block = &html[start..html.len() - suffix_len];
          branches.push_str(&format!("<!--seam:when:{value}-->{block}"));
        }

        let marker = format!("<!--seam:match:{}-->{branches}<!--seam:endmatch-->", axis.path);

        // Find corresponding region in base
        let base_end = base.len() - suffix_len;
        effects.push(AxisEffect { start, end: base_end, replacement: marker });
      }
      "array" => {
        // Find populated vs empty variant
        if let Some((vi_pop, vi_empty)) = find_pair_for_axis(axes, variants, axis_idx) {
          let html_pop = &variants[vi_pop];
          let html_empty = &variants[vi_empty];

          let (start, end_pop, _end_empty) = two_way_diff(html_pop, html_empty);

          let block = &html_pop[start..end_pop];
          // Rename internal paths: field.$.xxx -> $.xxx
          let field_prefix = format!("<!--seam:{}.", axis.path);
          let renamed = block.replace(&field_prefix, "<!--seam:");

          let marker = format!("<!--seam:each:{}-->{}<!--seam:endeach-->", axis.path, renamed);

          // Find corresponding region in base
          let (base_start, base_end, _) = two_way_diff(base, html_empty);
          effects.push(AxisEffect { start: base_start, end: base_end, replacement: marker });
        }
      }
      _ => {}
    }
  }

  // Sort effects by start position descending to apply from end to beginning
  effects.sort_by(|a, b| b.start.cmp(&a.start));

  let mut result = base.to_string();
  for effect in &effects {
    result = format!("{}{}{}", &result[..effect.start], effect.replacement, &result[effect.end..]);
  }

  result
}

/// Find a pair of variant indices that differ only in the given axis.
/// Returns (index_for_first_value, index_for_second_value).
fn find_pair_for_axis(
  axes: &[Axis],
  variants: &[String],
  target_axis: usize,
) -> Option<(usize, usize)> {
  let axis = &axes[target_axis];
  if axis.values.len() < 2 {
    return None;
  }

  // Generate all combos to find indices
  let combos = generate_combos(axes);
  let first_val = &axis.values[0];
  let second_val = &axis.values[1];

  // Find two combos that are identical except for the target axis
  for (i, combo_a) in combos.iter().enumerate() {
    for (j, combo_b) in combos.iter().enumerate() {
      if i == j || i >= variants.len() || j >= variants.len() {
        continue;
      }
      let mut differs_only_in_target = true;
      for (k, (va, vb)) in combo_a.iter().zip(combo_b.iter()).enumerate() {
        if k == target_axis {
          if va != first_val || vb != second_val {
            differs_only_in_target = false;
            break;
          }
        } else if va != vb {
          differs_only_in_target = false;
          break;
        }
      }
      if differs_only_in_target {
        return Some((i, j));
      }
    }
  }

  None
}

/// Find N variant indices for each enum value on the given axis.
fn find_enum_group_for_axis(
  axes: &[Axis],
  variants: &[String],
  target_axis: usize,
) -> Vec<(String, usize)> {
  let axis = &axes[target_axis];
  let combos = generate_combos(axes);
  let mut result = Vec::new();

  // For each enum value, find the first variant that uses it
  // while other axes match the first combo's values
  let reference_combo = if combos.is_empty() {
    return result;
  } else {
    &combos[0]
  };

  for value in &axis.values {
    let val_str = match value {
      serde_json::Value::String(s) => s.clone(),
      other => other.to_string(),
    };

    for (i, combo) in combos.iter().enumerate() {
      if i >= variants.len() {
        break;
      }
      let mut matches = true;
      for (k, v) in combo.iter().enumerate() {
        if k == target_axis {
          if v != value {
            matches = false;
            break;
          }
        } else if v != &reference_combo[k] {
          matches = false;
          break;
        }
      }
      if matches {
        result.push((val_str, i));
        break;
      }
    }
  }

  result
}

/// Generate cartesian product of axis values (mirrors the JS variant-generator).
fn generate_combos(axes: &[Axis]) -> Vec<Vec<serde_json::Value>> {
  let mut combos: Vec<Vec<serde_json::Value>> = vec![vec![]];
  for axis in axes {
    let mut next = Vec::new();
    for existing in &combos {
      for value in &axis.values {
        let mut combo = existing.clone();
        combo.push(value.clone());
        next.push(combo);
      }
    }
    combos = next;
  }
  combos
}

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
  use serde_json::json;

  // -- Legacy v1 helpers (test-only) --

  fn detect_conditional(full_html: &str, nulled_html: &str, field: &str) -> Option<ConditionalBlock> {
    if full_html == nulled_html {
      return None;
    }
    let prefix_len = full_html.bytes().zip(nulled_html.bytes()).take_while(|(a, b)| a == b).count();
    let full_remaining = &full_html[prefix_len..];
    let nulled_remaining = &nulled_html[prefix_len..];
    let suffix_len = full_remaining
      .bytes()
      .rev()
      .zip(nulled_remaining.bytes().rev())
      .take_while(|(a, b)| a == b)
      .count();
    let mut block_start = prefix_len;
    let mut block_end = full_html.len() - suffix_len;
    if block_start > 0 && full_html.as_bytes()[block_start - 1] == b'<' {
      block_start -= 1;
    }
    if block_end > block_start && full_html.as_bytes()[block_end - 1] == b'<' {
      block_end -= 1;
    }
    if block_start >= block_end {
      return None;
    }
    Some(ConditionalBlock { start: block_start, end: block_end, field: field.to_string() })
  }

  #[derive(Debug)]
  struct ConditionalBlock {
    start: usize,
    end: usize,
    field: String,
  }

  fn apply_conditionals(html: &str, mut blocks: Vec<ConditionalBlock>) -> String {
    let mut result = html.to_string();
    blocks.sort_by(|a, b| b.start.cmp(&a.start));
    for block in &blocks {
      let endif = format!("<!--seam:endif:{}-->", block.field);
      let ifstart = format!("<!--seam:if:{}-->", block.field);
      result.insert_str(block.end, &endif);
      result.insert_str(block.start, &ifstart);
    }
    result
  }

  fn detect_array_block(full_html: &str, emptied_html: &str, field: &str) -> Option<ArrayBlock> {
    if full_html == emptied_html {
      return None;
    }
    let prefix_len = full_html.bytes().zip(emptied_html.bytes()).take_while(|(a, b)| a == b).count();
    let full_remaining = &full_html[prefix_len..];
    let emptied_remaining = &emptied_html[prefix_len..];
    let suffix_len = full_remaining
      .bytes()
      .rev()
      .zip(emptied_remaining.bytes().rev())
      .take_while(|(a, b)| a == b)
      .count();
    let mut block_start = prefix_len;
    let mut block_end = full_html.len() - suffix_len;
    if block_start > 0 && full_html.as_bytes()[block_start - 1] == b'<' {
      block_start -= 1;
    }
    if block_end > block_start && full_html.as_bytes()[block_end - 1] == b'<' {
      block_end -= 1;
    }
    if block_start >= block_end {
      return None;
    }
    Some(ArrayBlock { start: block_start, end: block_end, field: field.to_string() })
  }

  #[derive(Debug)]
  struct ArrayBlock {
    start: usize,
    end: usize,
    field: String,
  }

  fn apply_array_blocks(html: &str, mut blocks: Vec<ArrayBlock>) -> String {
    let mut result = html.to_string();
    blocks.sort_by(|a, b| b.start.cmp(&a.start));
    for block in &blocks {
      let body = &result[block.start..block.end];
      let field_prefix = format!("<!--seam:{}.", block.field);
      let replacement_prefix = "<!--seam:";
      let renamed = body.replace(&field_prefix, replacement_prefix);
      let wrapped = format!("<!--seam:each:{}-->{}<!--seam:endeach-->", block.field, renamed);
      result = format!("{}{}{}", &result[..block.start], wrapped, &result[block.end..]);
    }
    result
  }

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

  // -- detect_array_block --

  #[test]
  fn array_block_detection() {
    let full = "before<li><!--seam:items.$.name--></li>after";
    let emptied = "beforeafter";
    let block = detect_array_block(full, emptied, "items").unwrap();
    assert_eq!(&full[block.start..block.end], "<li><!--seam:items.$.name--></li>");
  }

  #[test]
  fn array_block_detection_shared_angle_bracket() {
    // Shared `<` between <li> and </ul> -- boundary adjustment needed
    let full = "<ul><li><!--seam:items.$.name--></li></ul>";
    let emptied = "<ul></ul>";
    let block = detect_array_block(full, emptied, "items").unwrap();
    assert_eq!(&full[block.start..block.end], "<li><!--seam:items.$.name--></li>");
  }

  #[test]
  fn array_block_identical_no_detection() {
    assert!(detect_array_block("<ul></ul>", "<ul></ul>", "items").is_none());
  }

  #[test]
  fn apply_array_blocks_wraps_and_renames() {
    let html = "<ul><li><!--seam:items.$.name--></li></ul>";
    let blocks = vec![ArrayBlock { start: 4, end: 37, field: "items".into() }];
    let result = apply_array_blocks(html, blocks);
    assert!(result.contains("<!--seam:each:items-->"));
    assert!(result.contains("<!--seam:endeach-->"));
    assert!(result.contains("<!--seam:$.name-->"));
    assert!(!result.contains("items.$.name"));
  }

  #[test]
  fn apply_array_blocks_renames_attr_paths() {
    let html = "<ul><!--seam:items.$.url:attr:href--><a><!--seam:items.$.text--></a></ul>";
    let block_start = 4;
    let block_end = html.len() - 5; // before </ul>
    let blocks = vec![ArrayBlock { start: block_start, end: block_end, field: "items".into() }];
    let result = apply_array_blocks(html, blocks);
    assert!(result.contains("<!--seam:$.url:attr:href-->"));
    assert!(result.contains("<!--seam:$.text-->"));
    assert!(!result.contains("items.$"));
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

  // -- extract_template (multi-variant diff) --

  fn make_axis(path: &str, kind: &str, values: Vec<serde_json::Value>) -> Axis {
    Axis { path: path.to_string(), kind: kind.to_string(), values }
  }

  #[test]
  fn extract_boolean_if_only() {
    let axes = vec![make_axis("isAdmin", "boolean", vec![json!(true), json!(false)])];
    let variants =
      vec!["<div>Hello<span>Admin</span></div>".to_string(), "<div>Hello</div>".to_string()];
    let result = extract_template(&axes, &variants);
    assert!(result.contains("<!--seam:if:isAdmin-->"));
    assert!(result.contains("<span>Admin</span>"));
    assert!(result.contains("<!--seam:endif:isAdmin-->"));
  }

  #[test]
  fn extract_boolean_if_else() {
    let axes = vec![make_axis("isLoggedIn", "boolean", vec![json!(true), json!(false)])];
    let variants =
      vec!["<div><b>Welcome</b></div>".to_string(), "<div><i>Login</i></div>".to_string()];
    let result = extract_template(&axes, &variants);
    assert!(result.contains("<!--seam:if:isLoggedIn-->"));
    assert!(result.contains("<b>Welcome</b>"));
    assert!(result.contains("<!--seam:else-->"));
    assert!(result.contains("<i>Login</i>"));
    assert!(result.contains("<!--seam:endif:isLoggedIn-->"));
  }

  #[test]
  fn extract_enum_match() {
    let axes =
      vec![make_axis("role", "enum", vec![json!("admin"), json!("member"), json!("guest")])];
    let variants = vec![
      "<div><b>Admin Panel</b></div>".to_string(),
      "<div><i>Member Area</i></div>".to_string(),
      "<div><span>Guest View</span></div>".to_string(),
    ];
    let result = extract_template(&axes, &variants);
    assert!(result.contains("<!--seam:match:role-->"));
    assert!(result.contains("<!--seam:when:admin-->"));
    assert!(result.contains("<!--seam:when:member-->"));
    assert!(result.contains("<!--seam:when:guest-->"));
    assert!(result.contains("<!--seam:endmatch-->"));
  }

  #[test]
  fn extract_array_each() {
    let axes = vec![make_axis("posts", "array", vec![json!("populated"), json!("empty")])];
    let variants =
      vec!["<ul><li><!--seam:posts.$.name--></li></ul>".to_string(), "<ul></ul>".to_string()];
    let result = extract_template(&axes, &variants);
    assert!(result.contains("<!--seam:each:posts-->"));
    assert!(result.contains("<!--seam:$.name-->"));
    assert!(result.contains("<!--seam:endeach-->"));
    assert!(!result.contains("posts.$.name"));
  }

  #[test]
  fn extract_single_variant_passthrough() {
    let axes: Vec<Axis> = vec![];
    let variants = vec!["<div>Hello</div>".to_string()];
    assert_eq!(extract_template(&axes, &variants), "<div>Hello</div>");
  }
}
