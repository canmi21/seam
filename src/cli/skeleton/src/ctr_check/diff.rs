/* src/cli/skeleton/src/ctr_check/diff.rs */

// Positional tree diff for CTR equivalence checking.
// Both sides should have identical structure (CTR guarantees this),
// so we walk child lists by index rather than using LCS alignment.

use std::collections::BTreeMap;

use super::parse::CtrNode;

const MAX_DIFFS: usize = 5;

#[derive(Debug)]
pub(super) enum CtrDiff {
  TagMismatch { path: String, expected: String, actual: String },
  AttrMissing { path: String, attr: String, expected_value: String },
  AttrExtra { path: String, attr: String, actual_value: String },
  AttrValueMismatch { path: String, attr: String, expected: String, actual: String },
  TextMismatch { path: String, expected: String, actual: String },
  TypeMismatch { path: String, expected_kind: &'static str, actual_kind: &'static str },
  NodeMissing { path: String, expected_tag: String },
  NodeExtra { path: String, actual_tag: String },
}

pub(super) struct DiffResult {
  pub diffs: Vec<CtrDiff>,
  pub total_count: usize,
}

/// Diff two CtrNode trees. Returns at most MAX_DIFFS detailed diffs,
/// plus a total_count of all differences found.
pub(super) fn diff_trees(
  expected: &[CtrNode],
  actual: &[CtrNode],
  parent_path: &str,
) -> DiffResult {
  let mut diffs = Vec::new();
  let mut total = 0;
  diff_children(expected, actual, parent_path, &mut diffs, &mut total);
  DiffResult { diffs, total_count: total }
}

fn diff_children(
  expected: &[CtrNode],
  actual: &[CtrNode],
  parent_path: &str,
  diffs: &mut Vec<CtrDiff>,
  total: &mut usize,
) {
  let min_len = expected.len().min(actual.len());

  // Build tag frequency maps for nth-child disambiguation
  let expected_tags = tag_counts(expected);
  let _actual_tags = tag_counts(actual);

  for i in 0..min_len {
    if diffs.len() >= MAX_DIFFS {
      // Continue counting but stop collecting
    }
    match (&expected[i], &actual[i]) {
      (
        CtrNode::Element { tag: et, attrs: ea, children: ec },
        CtrNode::Element { tag: at, attrs: aa, children: ac },
      ) => {
        if et != at {
          *total += 1;
          if diffs.len() < MAX_DIFFS {
            let path = build_element_path(parent_path, et, ea, i, &expected_tags);
            diffs.push(CtrDiff::TagMismatch { path, expected: et.clone(), actual: at.clone() });
          }
          continue;
        }

        let path = build_element_path(parent_path, et, ea, i, &expected_tags);
        diff_attrs(ea, aa, &path, diffs, total);
        diff_children(ec, ac, &path, diffs, total);
      }
      (CtrNode::Text(et), CtrNode::Text(at)) => {
        if et != at {
          *total += 1;
          if diffs.len() < MAX_DIFFS {
            diffs.push(CtrDiff::TextMismatch {
              path: format_text_path(parent_path),
              expected: et.clone(),
              actual: at.clone(),
            });
          }
        }
      }
      (CtrNode::Element { .. }, CtrNode::Text(_)) => {
        *total += 1;
        if diffs.len() < MAX_DIFFS {
          diffs.push(CtrDiff::TypeMismatch {
            path: format!("{} > [child {}]", parent_path, i),
            expected_kind: "Element",
            actual_kind: "Text",
          });
        }
      }
      (CtrNode::Text(_), CtrNode::Element { .. }) => {
        *total += 1;
        if diffs.len() < MAX_DIFFS {
          diffs.push(CtrDiff::TypeMismatch {
            path: format!("{} > [child {}]", parent_path, i),
            expected_kind: "Text",
            actual_kind: "Element",
          });
        }
      }
    }
  }

  // Extra nodes in expected (missing from actual)
  for node in expected.iter().skip(min_len) {
    *total += 1;
    if diffs.len() < MAX_DIFFS {
      let tag = match node {
        CtrNode::Element { tag, .. } => tag.clone(),
        CtrNode::Text(t) => format!("text(\"{}\")", truncate(t, 20)),
      };
      diffs.push(CtrDiff::NodeMissing { path: parent_path.to_string(), expected_tag: tag });
    }
  }

  // Extra nodes in actual (not in expected)
  for node in actual.iter().skip(min_len) {
    *total += 1;
    if diffs.len() < MAX_DIFFS {
      let tag = match node {
        CtrNode::Element { tag, .. } => tag.clone(),
        CtrNode::Text(t) => format!("text(\"{}\")", truncate(t, 20)),
      };
      diffs.push(CtrDiff::NodeExtra { path: parent_path.to_string(), actual_tag: tag });
    }
  }
}

fn diff_attrs(
  expected: &BTreeMap<String, String>,
  actual: &BTreeMap<String, String>,
  path: &str,
  diffs: &mut Vec<CtrDiff>,
  total: &mut usize,
) {
  // Missing or mismatched attrs
  for (key, eval) in expected {
    match actual.get(key) {
      None => {
        *total += 1;
        if diffs.len() < MAX_DIFFS {
          diffs.push(CtrDiff::AttrMissing {
            path: path.to_string(),
            attr: key.clone(),
            expected_value: eval.clone(),
          });
        }
      }
      Some(aval) if aval != eval => {
        *total += 1;
        if diffs.len() < MAX_DIFFS {
          diffs.push(CtrDiff::AttrValueMismatch {
            path: path.to_string(),
            attr: key.clone(),
            expected: eval.clone(),
            actual: aval.clone(),
          });
        }
      }
      _ => {}
    }
  }

  // Extra attrs
  for (key, aval) in actual {
    if !expected.contains_key(key) {
      *total += 1;
      if diffs.len() < MAX_DIFFS {
        diffs.push(CtrDiff::AttrExtra {
          path: path.to_string(),
          attr: key.clone(),
          actual_value: aval.clone(),
        });
      }
    }
  }
}

/// Count how many times each tag appears at the same level.
fn tag_counts(nodes: &[CtrNode]) -> BTreeMap<String, usize> {
  let mut counts = BTreeMap::new();
  for node in nodes {
    if let CtrNode::Element { tag, .. } = node {
      *counts.entry(tag.clone()).or_insert(0) += 1;
    }
  }
  counts
}

/// Build a CSS-selector-style path for an element.
fn build_element_path(
  parent_path: &str,
  tag: &str,
  attrs: &BTreeMap<String, String>,
  index: usize,
  tag_counts: &BTreeMap<String, usize>,
) -> String {
  let mut selector = tag.to_string();

  // Add first class token for readability
  if let Some(class) = attrs.get("class")
    && let Some(first_class) = class.split_whitespace().next()
  {
    selector.push('.');
    selector.push_str(first_class);
  }

  // Add :nth-child(N) when there are multiple siblings with same tag
  if tag_counts.get(tag).copied().unwrap_or(0) > 1 {
    selector.push_str(&format!(":nth-child({})", index + 1));
  }

  if parent_path.is_empty() { selector } else { format!("{} > {}", parent_path, selector) }
}

fn format_text_path(parent_path: &str) -> String {
  if parent_path.is_empty() { "[text]".to_string() } else { format!("{} > [text]", parent_path) }
}

fn truncate(s: &str, max: usize) -> String {
  if s.len() <= max { s.to_string() } else { format!("{}...", &s[..s.floor_char_boundary(max)]) }
}

#[cfg(test)]
mod tests {
  use super::super::parse::CtrNode;
  use super::*;

  fn elem(tag: &str, attrs: Vec<(&str, &str)>, children: Vec<CtrNode>) -> CtrNode {
    let map: BTreeMap<String, String> =
      attrs.into_iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    CtrNode::Element { tag: tag.to_string(), attrs: map, children }
  }

  fn text(s: &str) -> CtrNode {
    CtrNode::Text(s.to_string())
  }

  #[test]
  fn identical_trees_no_diffs() {
    let a = vec![elem("div", vec![("class", "red")], vec![text("hello")])];
    let b = vec![elem("div", vec![("class", "red")], vec![text("hello")])];
    let result = diff_trees(&a, &b, "");
    assert!(result.diffs.is_empty());
    assert_eq!(result.total_count, 0);
  }

  #[test]
  fn attr_order_no_diffs() {
    // BTreeMap auto-sorts, so insertion order doesn't matter
    let a = vec![elem("img", vec![("alt", "x"), ("src", "y")], vec![])];
    let b = vec![elem("img", vec![("src", "y"), ("alt", "x")], vec![])];
    let result = diff_trees(&a, &b, "");
    assert!(result.diffs.is_empty());
  }

  #[test]
  fn text_mismatch_detected() {
    let a = vec![elem("p", vec![], vec![text("hello")])];
    let b = vec![elem("p", vec![], vec![text("world")])];
    let result = diff_trees(&a, &b, "");
    assert_eq!(result.total_count, 1);
    assert!(matches!(&result.diffs[0], CtrDiff::TextMismatch { expected, actual, .. }
      if expected == "hello" && actual == "world"));
  }

  #[test]
  fn attr_value_mismatch_detected() {
    let a = vec![elem("span", vec![("style", "color:red")], vec![])];
    let b = vec![elem("span", vec![("style", "color:blue")], vec![])];
    let result = diff_trees(&a, &b, "");
    assert_eq!(result.total_count, 1);
    assert!(matches!(&result.diffs[0], CtrDiff::AttrValueMismatch { attr, .. } if attr == "style"));
  }

  #[test]
  fn attr_missing_detected() {
    let a = vec![elem("img", vec![("alt", "photo"), ("src", "x")], vec![])];
    let b = vec![elem("img", vec![("src", "x")], vec![])];
    let result = diff_trees(&a, &b, "");
    assert_eq!(result.total_count, 1);
    assert!(matches!(&result.diffs[0], CtrDiff::AttrMissing { attr, .. } if attr == "alt"));
  }

  #[test]
  fn tag_mismatch_detected() {
    let a = vec![elem("div", vec![], vec![])];
    let b = vec![elem("span", vec![], vec![])];
    let result = diff_trees(&a, &b, "");
    assert_eq!(result.total_count, 1);
    assert!(matches!(&result.diffs[0], CtrDiff::TagMismatch { expected, actual, .. }
      if expected == "div" && actual == "span"));
  }

  #[test]
  fn node_missing_detected() {
    let a = vec![elem("div", vec![], vec![]), elem("span", vec![], vec![])];
    let b = vec![elem("div", vec![], vec![])];
    let result = diff_trees(&a, &b, "");
    assert_eq!(result.total_count, 1);
    assert!(
      matches!(&result.diffs[0], CtrDiff::NodeMissing { expected_tag, .. } if expected_tag == "span")
    );
  }

  #[test]
  fn nested_diff_path() {
    let a = vec![elem(
      "div",
      vec![("class", "grid")],
      vec![elem("a", vec![], vec![elem("span", vec![], vec![text("hello")])])],
    )];
    let b = vec![elem(
      "div",
      vec![("class", "grid")],
      vec![elem("a", vec![], vec![elem("span", vec![], vec![text("world")])])],
    )];
    let result = diff_trees(&a, &b, "");
    assert_eq!(result.total_count, 1);
    match &result.diffs[0] {
      CtrDiff::TextMismatch { path, .. } => {
        assert!(path.contains("div.grid"), "path should contain div.grid: {path}");
        assert!(path.contains("span"), "path should contain span: {path}");
      }
      other => panic!("expected TextMismatch, got: {other:?}"),
    }
  }

  #[test]
  fn diff_caps_at_five() {
    // Create trees with 8 text mismatches
    let make = |prefix: &str| -> Vec<CtrNode> {
      (0..8).map(|i| elem("p", vec![], vec![text(&format!("{}{}", prefix, i))])).collect()
    };
    let a = make("a");
    let b = make("b");
    let result = diff_trees(&a, &b, "");
    assert_eq!(result.diffs.len(), MAX_DIFFS);
    assert_eq!(result.total_count, 8);
  }
}
