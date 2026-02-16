/* packages/cli/core/src/build/skeleton/extract/process.rs */

use super::super::Axis;
use super::combo::AxisGroup;
use super::container::unwrap_container;
use super::diff::{extend_to_balanced, n_way_prefix_suffix, two_way_diff};
use super::variant::{
  find_enum_all_variants_for_axis, find_enum_group_for_axis, find_pair_for_axis,
  find_scoped_variant_indices,
};
use super::{extract_template_inner, AxisEffect};

/// Process a single axis (boolean/nullable/enum/array-without-children).
pub(super) fn process_single_axis(
  axes: &[Axis],
  variants: &[String],
  axis_idx: usize,
  base: &str,
) -> Option<AxisEffect> {
  let axis = &axes[axis_idx];
  match axis.kind.as_str() {
    "boolean" | "nullable" => {
      let (vi_true, vi_false) = find_pair_for_axis(axes, variants.len(), axis_idx)?;
      let html_a = &variants[vi_true];
      let html_b = &variants[vi_false];
      let (start, end_a, end_b) = two_way_diff(html_a, html_b);

      let block_a = &html_a[start..end_a];
      let block_b = &html_b[start..end_b];

      let marker = if block_a.is_empty() && !block_b.is_empty() {
        format!("<!--seam:if:{}-->{}<!--seam:endif:{}-->", axis.path, block_b, axis.path)
      } else if !block_a.is_empty() && block_b.is_empty() {
        format!("<!--seam:if:{}-->{}<!--seam:endif:{}-->", axis.path, block_a, axis.path)
      } else if !block_a.is_empty() && !block_b.is_empty() {
        format!(
          "<!--seam:if:{}-->{}<!--seam:else-->{}<!--seam:endif:{}-->",
          axis.path, block_a, block_b, axis.path
        )
      } else {
        return None;
      };

      let (base_start, base_end, _) = two_way_diff(base, html_b);
      Some(AxisEffect { start: base_start, end: base_end, replacement: marker })
    }
    "enum" => {
      let groups = find_enum_group_for_axis(axes, variants.len(), axis_idx);
      if groups.len() < 2 {
        return None;
      }

      // Use representative variants to compute prefix/suffix boundaries
      let html_strs: Vec<&str> = groups.iter().map(|(_, vi)| variants[*vi].as_str()).collect();
      let (prefix_len, suffix_len) = n_way_prefix_suffix(&html_strs);

      let start = prefix_len;

      // Collect sibling axes (other non-enum axes at the same level)
      let sibling_axes: Vec<Axis> =
        axes.iter().enumerate().filter(|(i, _)| *i != axis_idx).map(|(_, a)| a.clone()).collect();
      let has_siblings = !sibling_axes.is_empty();

      // Collect ALL variants per enum value for recursive processing
      let all_groups = if has_siblings {
        find_enum_all_variants_for_axis(axes, variants.len(), axis_idx)
      } else {
        Vec::new()
      };

      let mut branches = String::new();
      for (idx, (value, _)) in groups.iter().enumerate() {
        if has_siblings {
          // Recursive: extract sibling axes within each match arm.
          // Balance each arm body individually so unclosed tags in the
          // stripped region get their closing tags included.
          // Guard: sibling axis variation may make some variants shorter
          // than the prefix computed from representatives.
          let (_, ref arm_indices) = all_groups[idx];
          let arm_bodies: Vec<String> = arm_indices
            .iter()
            .map(|&i| {
              let v = &variants[i];
              if start >= v.len() {
                return String::new();
              }
              let raw_end = v.len().saturating_sub(suffix_len).max(start);
              let balanced_end = extend_to_balanced(v.as_bytes(), start, raw_end);
              v[start..balanced_end].to_string()
            })
            .collect();
          let arm_body = extract_template_inner(&sibling_axes, &arm_bodies);
          branches.push_str(&format!("<!--seam:when:{value}-->{arm_body}"));
        } else {
          let html = &variants[groups[idx].1];
          let raw_end = html.len().saturating_sub(suffix_len).max(start);
          let balanced_end = extend_to_balanced(html.as_bytes(), start, raw_end);
          let block = &html[start..balanced_end];
          branches.push_str(&format!("<!--seam:when:{value}-->{block}"));
        }
      }

      let marker = format!("<!--seam:match:{}-->{branches}<!--seam:endmatch-->", axis.path);
      let raw_end = base.len().saturating_sub(suffix_len).max(start);
      let base_end = extend_to_balanced(base.as_bytes(), start, raw_end);
      Some(AxisEffect { start, end: base_end, replacement: marker })
    }
    "array" => {
      let (vi_pop, vi_empty) = find_pair_for_axis(axes, variants.len(), axis_idx)?;
      let html_pop = &variants[vi_pop];
      let html_empty = &variants[vi_empty];

      let (start, end_pop, _) = two_way_diff(html_pop, html_empty);
      let block = &html_pop[start..end_pop];
      let field_prefix = format!("<!--seam:{}.", axis.path);
      let renamed = block.replace(&field_prefix, "<!--seam:");

      let marker = if let Some((open, inner, close)) = unwrap_container(&renamed) {
        format!("{open}<!--seam:each:{}-->{inner}<!--seam:endeach-->{close}", axis.path)
      } else {
        format!("<!--seam:each:{}-->{}<!--seam:endeach-->", axis.path, renamed)
      };
      let (base_start, base_end, _) = two_way_diff(base, html_empty);
      Some(AxisEffect { start: base_start, end: base_end, replacement: marker })
    }
    _ => None,
  }
}

/// Process an array axis that has nested child axes.
/// Extracts the array body, recursively processes children within it.
pub(super) fn process_array_with_children(
  axes: &[Axis],
  variants: &[String],
  group: &AxisGroup,
  base: &str,
) -> Option<AxisEffect> {
  let array_axis = &axes[group.parent_axis_idx];
  if array_axis.kind != "array" {
    return None;
  }

  // 1. Find populated/empty pair for the array itself
  let (_, vi_empty) = find_pair_for_axis(axes, variants.len(), group.parent_axis_idx)?;
  let html_empty = &variants[vi_empty];

  // 2. Find all variants where array=populated, non-child axes match reference
  let scoped_indices =
    find_scoped_variant_indices(axes, variants.len(), group.parent_axis_idx, &group.children);
  if scoped_indices.is_empty() {
    return None;
  }

  // 3. Compute stable body boundaries using N-way prefix/suffix across ALL
  //    populated variants + the empty variant. This ensures boundaries are
  //    independent of child-axis variation (fixes overlapping effect ranges).
  let mut boundary_strs: Vec<&str> = scoped_indices.iter().map(|&i| variants[i].as_str()).collect();
  boundary_strs.push(html_empty.as_str());
  let (prefix_len, suffix_len) = n_way_prefix_suffix(&boundary_strs);

  // 4. Extract body from each scoped variant using stable boundaries
  let body_variants: Vec<String> = scoped_indices
    .iter()
    .map(|&i| {
      let v = &variants[i];
      v[prefix_len..v.len() - suffix_len].to_string()
    })
    .collect();

  // 5. Build child axes with stripped parent prefix (posts.$.x -> $.x)
  let parent_dot = format!("{}.", array_axis.path);
  let child_axes: Vec<Axis> = group
    .children
    .iter()
    .map(|&i| {
      let orig = &axes[i];
      Axis {
        path: orig.path.strip_prefix(&parent_dot).unwrap_or(&orig.path).to_string(),
        kind: orig.kind.clone(),
        values: orig.values.clone(),
      }
    })
    .collect();

  // 5b. Pre-rename slot markers in body variants so inner recursive
  //     extraction can match child axis paths (e.g. posts.$.tags.$.name -> $.tags.$.name)
  let slot_prefix = format!("<!--seam:{}.", array_axis.path);
  let body_variants: Vec<String> =
    body_variants.into_iter().map(|b| b.replace(&slot_prefix, "<!--seam:")).collect();

  // 6. Recursively extract template from body variants
  let template_body = extract_template_inner(&child_axes, &body_variants);

  // 7. Wrap with each markers, unwrapping container if present
  let marker = if let Some((open, inner, close)) = unwrap_container(&template_body) {
    format!("{open}<!--seam:each:{}-->{inner}<!--seam:endeach-->{close}", array_axis.path)
  } else {
    format!("<!--seam:each:{}-->{}<!--seam:endeach-->", array_axis.path, template_body)
  };

  let (base_start, base_end, _) = two_way_diff(base, html_empty);
  Some(AxisEffect { start: base_start, end: base_end, replacement: marker })
}
