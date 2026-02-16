/* packages/cli/core/src/build/skeleton/extract/variant.rs */

use std::collections::HashSet;

use super::super::Axis;
use super::combo::generate_combos;

/// Find a pair of variant indices that differ only in the given axis.
/// Returns (index_for_first_value, index_for_second_value).
pub(super) fn find_pair_for_axis(
  axes: &[Axis],
  variant_count: usize,
  target_axis: usize,
) -> Option<(usize, usize)> {
  let axis = &axes[target_axis];
  if axis.values.len() < 2 {
    return None;
  }

  let combos = generate_combos(axes);
  let first_val = &axis.values[0];
  let second_val = &axis.values[1];

  for (i, combo_a) in combos.iter().enumerate() {
    for (j, combo_b) in combos.iter().enumerate() {
      if i == j || i >= variant_count || j >= variant_count {
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

/// Find one representative variant index per enum value (other axes at reference).
pub(super) fn find_enum_group_for_axis(
  axes: &[Axis],
  variant_count: usize,
  target_axis: usize,
) -> Vec<(String, usize)> {
  let axis = &axes[target_axis];
  let combos = generate_combos(axes);
  let mut result = Vec::new();

  let reference_combo = if combos.is_empty() { return result } else { &combos[0] };

  for value in &axis.values {
    let val_str = match value {
      serde_json::Value::String(s) => s.clone(),
      other => other.to_string(),
    };

    for (i, combo) in combos.iter().enumerate() {
      if i >= variant_count {
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

/// Find ALL variant indices for each enum value (other axes vary freely).
pub(super) fn find_enum_all_variants_for_axis(
  axes: &[Axis],
  variant_count: usize,
  target_axis: usize,
) -> Vec<(String, Vec<usize>)> {
  let axis = &axes[target_axis];
  let combos = generate_combos(axes);
  let mut result = Vec::new();

  for value in &axis.values {
    let val_str = match value {
      serde_json::Value::String(s) => s.clone(),
      other => other.to_string(),
    };
    let indices: Vec<usize> = combos
      .iter()
      .enumerate()
      .filter(|&(i, _)| i < variant_count)
      .filter(|(_, combo)| &combo[target_axis] == value)
      .map(|(i, _)| i)
      .collect();
    result.push((val_str, indices));
  }

  result
}

/// Find variant indices where the parent array is populated,
/// non-child top-level axes match the reference combo, and child axes vary freely.
pub(super) fn find_scoped_variant_indices(
  axes: &[Axis],
  variant_count: usize,
  parent_axis_idx: usize,
  children: &[usize],
) -> Vec<usize> {
  let combos = generate_combos(axes);
  let reference = if combos.is_empty() { return Vec::new() } else { &combos[0] };
  let child_set: HashSet<usize> = children.iter().copied().collect();

  combos
    .iter()
    .enumerate()
    .filter(|&(i, _)| i < variant_count)
    .filter(|(_, combo)| {
      combo.iter().enumerate().all(|(k, v)| {
        if k == parent_axis_idx {
          // Must be populated (first value)
          v == &axes[parent_axis_idx].values[0]
        } else if child_set.contains(&k) {
          true
        } else {
          v == &reference[k]
        }
      })
    })
    .map(|(i, _)| i)
    .collect()
}
