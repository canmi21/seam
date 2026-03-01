/* src/cli/core/src/build/skeleton/extract/combo.rs */

use std::collections::HashMap;

use super::super::Axis;

/// Generate cartesian product of axis values (mirrors the JS variant-generator).
pub(super) fn generate_combos(axes: &[Axis]) -> Vec<Vec<serde_json::Value>> {
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

pub(super) struct AxisGroup {
  pub parent_axis_idx: usize,
  pub children: Vec<usize>,
}

/// Classify axes into top-level and nested groups.
/// Nested axes contain ".$." in their path and are grouped by their parent array axis.
pub(super) fn classify_axes(axes: &[Axis]) -> (Vec<usize>, Vec<AxisGroup>) {
  let mut top_level: Vec<usize> = Vec::new();
  let mut group_map: HashMap<String, AxisGroup> = HashMap::new();

  for (i, axis) in axes.iter().enumerate() {
    if let Some(pos) = axis.path.find(".$.") {
      let parent_path = axis.path[..pos].to_string();
      if let Some(parent_idx) = axes.iter().position(|a| a.path == parent_path) {
        let group = group_map
          .entry(parent_path)
          .or_insert_with(|| AxisGroup { parent_axis_idx: parent_idx, children: Vec::new() });
        group.children.push(i);
      } else {
        // Orphaned nested axis (parent not in axes list): treat as top-level
        top_level.push(i);
      }
    } else {
      top_level.push(i);
    }
  }

  (top_level, group_map.into_values().collect())
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  fn make_axis(path: &str, kind: &str, values: Vec<serde_json::Value>) -> Axis {
    Axis { path: path.to_string(), kind: kind.to_string(), values }
  }

  // -- generate_combos --

  #[test]
  fn combos_single_axis() {
    let axes = vec![make_axis("x", "boolean", vec![json!(true), json!(false)])];
    let combos = generate_combos(&axes);
    assert_eq!(combos.len(), 2);
    assert_eq!(combos[0], vec![json!(true)]);
    assert_eq!(combos[1], vec![json!(false)]);
  }

  #[test]
  fn combos_cartesian_product() {
    let axes = vec![
      make_axis("a", "boolean", vec![json!(true), json!(false)]),
      make_axis("b", "enum", vec![json!("x"), json!("y"), json!("z")]),
    ];
    let combos = generate_combos(&axes);
    // 2 * 3 = 6 combinations
    assert_eq!(combos.len(), 6);
    assert_eq!(combos[0], vec![json!(true), json!("x")]);
    assert_eq!(combos[5], vec![json!(false), json!("z")]);
  }

  #[test]
  fn combos_empty_axes() {
    let combos = generate_combos(&[]);
    // One empty combo (the identity element of cartesian product)
    assert_eq!(combos.len(), 1);
    assert!(combos[0].is_empty());
  }

  // -- classify_axes --

  #[test]
  fn classify_all_top_level() {
    let axes = vec![
      make_axis("a", "boolean", vec![json!(true), json!(false)]),
      make_axis("b", "enum", vec![json!("x"), json!("y")]),
    ];
    let (top, groups) = classify_axes(&axes);
    assert_eq!(top, vec![0, 1]);
    assert!(groups.is_empty());
  }

  #[test]
  fn classify_mixed() {
    let axes = vec![
      make_axis("posts", "array", vec![json!("populated"), json!("empty")]),
      make_axis("posts.$.visible", "boolean", vec![json!(true), json!(false)]),
      make_axis("title", "nullable", vec![json!("present"), json!(null)]),
    ];
    let (top, groups) = classify_axes(&axes);
    // top-level: posts (idx 0) and title (idx 2)
    assert!(top.contains(&0));
    assert!(top.contains(&2));
    assert!(!top.contains(&1));
    // One group: posts with child posts.$.visible
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].parent_axis_idx, 0);
    assert_eq!(groups[0].children, vec![1]);
  }
}
