/* packages/cli/core/src/build/skeleton/extract.rs */

use std::collections::{HashMap, HashSet};

use super::Axis;

// -- Diffing helpers --

/// Snap a prefix-side boundary so it never falls inside `<tag ...>` or inside
/// an element's text content where the text shares a prefix with another element.
/// Scans backwards from `pos`; if the last `<` is unmatched, snap before it.
/// If `pos` is in text content (after `>`, not before `<`), snap back to
/// before the enclosing element's opening tag.
fn snap_prefix_to_tag_boundary(html: &[u8], pos: usize) -> usize {
  let mut i = pos;
  while i > 0 {
    i -= 1;
    match html[i] {
      b'>' => {
        // If we're in text content (next char after `>` is not `<`),
        // snap back to include the enclosing element's opening tag.
        if pos < html.len() && html[pos] != b'<' {
          let mut j = i;
          while j > 0 {
            j -= 1;
            if html[j] == b'<' {
              return j;
            }
          }
        }
        return pos;
      }
      b'<' => return i,
      _ => {}
    }
  }
  pos
}

/// Snap a suffix-side boundary forward so it never falls inside text content
/// or inside a tag. Mirrors `snap_prefix_to_tag_boundary` for the end position.
fn snap_suffix_to_tag_boundary(html: &[u8], end: usize) -> usize {
  if end == 0 || end >= html.len() {
    return end;
  }
  // Scan backward from end to determine context
  let mut i = end;
  while i > 0 {
    i -= 1;
    match html[i] {
      b'>' => {
        // After a closing `>`: check if end is in text content
        if html[end] != b'<' {
          // In text content — snap forward to next `<`
          let mut j = end;
          while j < html.len() && html[j] != b'<' {
            j += 1;
          }
          return j;
        }
        return end;
      }
      b'<' => {
        // Inside a tag — snap forward past the closing `>`
        let mut j = end;
        while j < html.len() && html[j] != b'>' {
          j += 1;
        }
        if j < html.len() {
          return j + 1;
        }
        return end;
      }
      _ => {}
    }
  }
  end
}

/// Count net open-tag depth in a byte slice.
/// Positive result means there are unclosed opening tags.
fn tag_depth(block: &[u8]) -> i32 {
  let mut depth: i32 = 0;
  let mut i = 0;
  while i < block.len() {
    if block[i] == b'<' {
      if i + 1 < block.len() && block[i + 1] == b'!' {
        // HTML comment — skip entirely
        i += 1;
        continue;
      }
      // Find closing `>`
      let mut j = i + 1;
      while j < block.len() && block[j] != b'>' {
        j += 1;
      }
      if i + 1 < block.len() && block[i + 1] == b'/' {
        depth -= 1;
      } else if j > 0 && j < block.len() && block[j - 1] == b'/' {
        // Self-closing tag like <img/> — no depth change
      } else {
        depth += 1;
      }
      i = j;
    }
    i += 1;
  }
  depth
}

/// Extend `end` forward to close any unbalanced opening tags in `html[start..end]`.
fn extend_to_balanced(html: &[u8], start: usize, end: usize) -> usize {
  let depth = tag_depth(&html[start..end]);
  if depth <= 0 {
    return end;
  }

  // Scan forward from end, closing `depth` tags
  let mut remaining = depth;
  let mut j = end;
  while j < html.len() && remaining > 0 {
    if html[j] == b'<' {
      if j + 1 < html.len() && html[j + 1] == b'/' {
        remaining -= 1;
        if remaining == 0 {
          // Advance past the closing `>`
          while j < html.len() && html[j] != b'>' {
            j += 1;
          }
          return j + 1;
        }
      } else if j + 1 < html.len() && html[j + 1] != b'!' {
        // Another opening tag in the suffix — account for it
        let mut k = j + 1;
        while k < html.len() && html[k] != b'>' {
          k += 1;
        }
        if k > 0 && html[k - 1] != b'/' {
          remaining += 1;
        }
      }
    }
    j += 1;
  }
  end
}

/// Only unwrap list-like container elements that hold repeating children.
fn is_list_container(tag: &str) -> bool {
  matches!(
    tag,
    "ul" | "ol" | "dl" | "table" | "tbody" | "thead" | "tfoot" | "select" | "datalist"
  )
}

/// Try to unwrap a single list-container element from an array body.
/// If `block` is `<ul ...>inner</ul>`, returns `Some((open, inner, close))`.
/// Only applies to known list containers (ul, ol, table, etc.).
fn unwrap_container(block: &str) -> Option<(&str, &str, &str)> {
  let bytes = block.as_bytes();
  if bytes.is_empty() || bytes[0] != b'<' || bytes[1] == b'/' || bytes[1] == b'!' {
    return None;
  }

  // Extract tag name from opening tag
  let mut name_end = 1;
  while name_end < bytes.len() && bytes[name_end] != b' ' && bytes[name_end] != b'>' {
    name_end += 1;
  }
  let tag_name = &block[1..name_end];

  if !is_list_container(tag_name) {
    return None;
  }

  // Find end of opening tag
  let mut i = 1;
  while i < bytes.len() && bytes[i] != b'>' {
    i += 1;
  }
  if i >= bytes.len() {
    return None;
  }
  let open_end = i + 1; // position after '>'

  // Find matching closing tag from end
  let close_tag = format!("</{tag_name}>");
  if !block.ends_with(&close_tag) {
    return None;
  }
  let inner_end = block.len() - close_tag.len();

  // Verify the inner content is tag-balanced
  if inner_end <= open_end {
    return None;
  }
  let inner = &block[open_end..inner_end];
  if tag_depth(inner.as_bytes()) != 0 {
    return None;
  }

  Some((&block[..open_end], inner, &block[inner_end..]))
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

  // Snap prefix so it never falls inside `<tag attrs...>`
  start = snap_prefix_to_tag_boundary(a.as_bytes(), start);

  // Adjust for shared `<` at end boundary: the `<` belongs to the suffix's tag
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

  // Snap suffix so it never falls inside text content or a tag
  end_a = snap_suffix_to_tag_boundary(a.as_bytes(), end_a);
  end_b = snap_suffix_to_tag_boundary(b.as_bytes(), end_b);

  // If snap_prefix opened a tag, ensure the block includes the matching close tag
  end_a = extend_to_balanced(a.as_bytes(), start, end_a);
  end_b = extend_to_balanced(b.as_bytes(), start, end_b);

  (start, end_a, end_b)
}

/// N-way diff: find common prefix/suffix across all variants.
fn n_way_prefix_suffix(variants: &[&str]) -> (usize, usize) {
  if variants.is_empty() {
    return (0, 0);
  }
  let first = variants[0];

  let mut prefix_len = first.len();
  for v in &variants[1..] {
    let common = first.bytes().zip(v.bytes()).take_while(|(a, b)| a == b).count();
    prefix_len = prefix_len.min(common);
  }

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

  // Snap prefix so it never falls inside a tag
  let snapped_prefix = snap_prefix_to_tag_boundary(first.as_bytes(), prefix_len);

  // Adjust suffix: if `<` at end-1, exclude it (belongs to suffix's tag)
  let mut end = first.len() - suffix_len;
  if end > snapped_prefix && first.as_bytes()[end - 1] == b'<' {
    end -= 1;
  }

  // Snap suffix so it never falls inside text content or a tag
  end = snap_suffix_to_tag_boundary(first.as_bytes(), end);

  (snapped_prefix, first.len() - end)
}

// -- Combo generation --

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

// -- Effect type --

#[derive(Debug)]
struct AxisEffect {
  start: usize,
  end: usize,
  replacement: String,
}

// -- Axis classification --

struct AxisGroup {
  parent_axis_idx: usize,
  children: Vec<usize>,
}

/// Classify axes into top-level and nested groups.
/// Nested axes contain ".$." in their path and are grouped by their parent array axis.
fn classify_axes(axes: &[Axis]) -> (Vec<usize>, Vec<AxisGroup>) {
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

// -- Variant pair/group finding --

/// Find a pair of variant indices that differ only in the given axis.
/// Returns (index_for_first_value, index_for_second_value).
fn find_pair_for_axis(
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
fn find_enum_group_for_axis(
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
fn find_enum_all_variants_for_axis(
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
fn find_scoped_variant_indices(
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

// -- Single axis processing --

/// Process a single axis (boolean/nullable/enum/array-without-children).
fn process_single_axis(
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
      let sibling_axes: Vec<Axis> = axes
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != axis_idx)
        .map(|(_, a)| a.clone())
        .collect();
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

// -- Array with children processing --

/// Process an array axis that has nested child axes.
/// Extracts the array body, recursively processes children within it.
fn process_array_with_children(
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
  let mut boundary_strs: Vec<&str> = scoped_indices
    .iter()
    .map(|&i| variants[i].as_str())
    .collect();
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

// -- Core recursive extraction --

fn extract_template_inner(axes: &[Axis], variants: &[String]) -> String {
  if variants.is_empty() {
    return String::new();
  }
  if variants.len() == 1 || axes.is_empty() {
    return variants[0].clone();
  }

  let base = &variants[0];
  let mut effects: Vec<AxisEffect> = Vec::new();

  // 1. Classify axes into top-level and nested groups
  let (top_level, groups) = classify_axes(axes);

  // 2. Track axes handled by groups (parent + all children)
  let mut handled: HashSet<usize> = HashSet::new();
  for group in &groups {
    handled.insert(group.parent_axis_idx);
    for &child in &group.children {
      handled.insert(child);
    }
    if let Some(effect) = process_array_with_children(axes, variants, group, base) {
      effects.push(effect);
    }
  }

  // 3. Process remaining top-level axes not owned by any group
  for &idx in &top_level {
    if handled.contains(&idx) {
      continue;
    }
    if let Some(effect) = process_single_axis(axes, variants, idx, base) {
      effects.push(effect);
    }
  }

  // 4. Apply effects back-to-front, adjusting indices for overlapping ranges.
  //    When a higher-start effect is applied first and a lower-start effect's
  //    end extends past it (overlap), the lower effect's end must be adjusted
  //    by the length delta of the higher effect's replacement.
  effects.sort_by(|a, b| b.start.cmp(&a.start));

  let mut result = base.to_string();
  for i in 0..effects.len() {
    let start = effects[i].start;
    let end = effects[i].end;
    let old_len = end - start;
    let new_len = effects[i].replacement.len();
    result = format!("{}{}{}", &result[..start], effects[i].replacement, &result[end..]);

    // Adjust subsequent effects whose end extends past this effect's start
    if old_len != new_len {
      let delta = new_len as isize - old_len as isize;
      for effect in effects.iter_mut().skip(i + 1) {
        if effect.end > start {
          effect.end = (effect.end as isize + delta) as usize;
        }
      }
    }
  }

  result
}

/// Extract a complete Slot Protocol v2 template from variant HTML strings.
/// Uses the axes metadata to determine which variants to diff for each axis.
/// Handles nested axes (e.g. `posts.$.author` inside a `posts` array)
/// via recursive sub-extraction.
pub fn extract_template(axes: &[Axis], variants: &[String]) -> String {
  extract_template_inner(axes, variants)
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  // -- Legacy v1 helpers (test-only, kept for regression coverage) --

  fn detect_conditional(
    full_html: &str,
    nulled_html: &str,
    field: &str,
  ) -> Option<ConditionalBlock> {
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
    let prefix_len =
      full_html.bytes().zip(emptied_html.bytes()).take_while(|(a, b)| a == b).count();
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

  fn make_axis(path: &str, kind: &str, values: Vec<serde_json::Value>) -> Axis {
    Axis { path: path.to_string(), kind: kind.to_string(), values }
  }

  // -- Legacy v1 detect/apply tests --

  #[test]
  fn simple_conditional() {
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

  #[test]
  fn array_block_detection() {
    let full = "before<li><!--seam:items.$.name--></li>after";
    let emptied = "beforeafter";
    let block = detect_array_block(full, emptied, "items").unwrap();
    assert_eq!(&full[block.start..block.end], "<li><!--seam:items.$.name--></li>");
  }

  #[test]
  fn array_block_detection_shared_angle_bracket() {
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
    let block_end = html.len() - 5;
    let blocks = vec![ArrayBlock { start: block_start, end: block_end, field: "items".into() }];
    let result = apply_array_blocks(html, blocks);
    assert!(result.contains("<!--seam:$.url:attr:href-->"));
    assert!(result.contains("<!--seam:$.text-->"));
    assert!(!result.contains("items.$"));
  }

  // -- extract_template: flat axis tests --

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

  // -- extract_template: nested axis tests --

  #[test]
  fn extract_array_with_nested_boolean() {
    let axes = vec![
      make_axis("posts", "array", vec![json!("populated"), json!("empty")]),
      make_axis("posts.$.hasAuthor", "boolean", vec![json!(true), json!(false)]),
    ];
    // Cartesian product: (posts, hasAuthor)
    // 0: (populated, true)   1: (populated, false)
    // 2: (empty, true)       3: (empty, false)
    let variants = vec![
      "<ul><li>Title<span>Author</span></li></ul>".to_string(),
      "<ul><li>Title</li></ul>".to_string(),
      "<ul></ul>".to_string(),
      "<ul></ul>".to_string(),
    ];
    let result = extract_template(&axes, &variants);
    assert!(result.contains("<!--seam:each:posts-->"), "missing each:posts in: {result}");
    assert!(result.contains("<!--seam:if:$.hasAuthor-->"), "missing if:$.hasAuthor in: {result}");
    assert!(result.contains("<span>Author</span>"), "missing Author block in: {result}");
    assert!(
      result.contains("<!--seam:endif:$.hasAuthor-->"),
      "missing endif:$.hasAuthor in: {result}"
    );
    assert!(result.contains("<!--seam:endeach-->"), "missing endeach in: {result}");
    // Nested paths must be fully renamed
    assert!(!result.contains("posts.$.hasAuthor"), "leaked full path in: {result}");
  }

  #[test]
  fn extract_array_with_nested_nullable() {
    let axes = vec![
      make_axis("items", "array", vec![json!("populated"), json!("empty")]),
      make_axis("items.$.subtitle", "nullable", vec![json!("present"), json!(null)]),
    ];
    let variants = vec![
      "<ol><li>Main<em>Sub</em></li></ol>".to_string(),
      "<ol><li>Main</li></ol>".to_string(),
      "<ol></ol>".to_string(),
      "<ol></ol>".to_string(),
    ];
    let result = extract_template(&axes, &variants);
    assert!(result.contains("<!--seam:each:items-->"), "missing each in: {result}");
    assert!(result.contains("<!--seam:if:$.subtitle-->"), "missing if in: {result}");
    assert!(result.contains("<em>Sub</em>"), "missing Sub block in: {result}");
    assert!(result.contains("<!--seam:endif:$.subtitle-->"), "missing endif in: {result}");
    assert!(result.contains("<!--seam:endeach-->"), "missing endeach in: {result}");
  }

  #[test]
  fn extract_mixed_toplevel_and_nested() {
    let axes = vec![
      make_axis("isAdmin", "boolean", vec![json!(true), json!(false)]),
      make_axis("posts", "array", vec![json!("populated"), json!("empty")]),
      make_axis("posts.$.hasImage", "boolean", vec![json!(true), json!(false)]),
      make_axis("posts.$.caption", "nullable", vec![json!("present"), json!(null)]),
    ];

    // Helper to build variant HTML from axis values
    fn gen(is_admin: bool, posts_pop: bool, has_image: bool, has_caption: bool) -> String {
      let admin = if is_admin { "<b>Admin</b>" } else { "" };
      let img = if has_image { "<img/>" } else { "" };
      let cap = if has_caption { "<em>Cap</em>" } else { "" };
      let items = if posts_pop { format!("<li>Post{img}{cap}</li>") } else { String::new() };
      format!("<div>{admin}<ul>{items}</ul></div>")
    }

    // 16 variants: cartesian product of (isAdmin, posts, hasImage, caption)
    let variants = vec![
      gen(true, true, true, true),     // 0
      gen(true, true, true, false),    // 1
      gen(true, true, false, true),    // 2
      gen(true, true, false, false),   // 3
      gen(true, false, true, true),    // 4
      gen(true, false, true, false),   // 5
      gen(true, false, false, true),   // 6
      gen(true, false, false, false),  // 7
      gen(false, true, true, true),    // 8
      gen(false, true, true, false),   // 9
      gen(false, true, false, true),   // 10
      gen(false, true, false, false),  // 11
      gen(false, false, true, true),   // 12
      gen(false, false, true, false),  // 13
      gen(false, false, false, true),  // 14
      gen(false, false, false, false), // 15
    ];

    let result = extract_template(&axes, &variants);

    // Top-level boolean
    assert!(result.contains("<!--seam:if:isAdmin-->"), "missing if:isAdmin in: {result}");
    assert!(result.contains("<b>Admin</b>"), "missing Admin block in: {result}");
    assert!(result.contains("<!--seam:endif:isAdmin-->"), "missing endif:isAdmin in: {result}");

    // Array
    assert!(result.contains("<!--seam:each:posts-->"), "missing each:posts in: {result}");
    assert!(result.contains("<!--seam:endeach-->"), "missing endeach in: {result}");

    // Nested boolean inside array
    assert!(result.contains("<!--seam:if:$.hasImage-->"), "missing if:$.hasImage in: {result}");
    assert!(result.contains("<img/>"), "missing img in: {result}");
    assert!(
      result.contains("<!--seam:endif:$.hasImage-->"),
      "missing endif:$.hasImage in: {result}"
    );

    // Nested nullable inside array
    assert!(result.contains("<!--seam:if:$.caption-->"), "missing if:$.caption in: {result}");
    assert!(result.contains("<em>Cap</em>"), "missing Cap block in: {result}");
    assert!(result.contains("<!--seam:endif:$.caption-->"), "missing endif:$.caption in: {result}");

    // No leaked full paths
    assert!(!result.contains("posts.$."), "leaked nested path in: {result}");
  }

  #[test]
  fn extract_array_without_children_unchanged() {
    // Regression guard: arrays without nested children still work correctly
    let axes = vec![make_axis("posts", "array", vec![json!("populated"), json!("empty")])];
    let variants =
      vec!["<ul><li><!--seam:posts.$.name--></li></ul>".to_string(), "<ul></ul>".to_string()];
    let result = extract_template(&axes, &variants);
    assert_eq!(
      result,
      "<ul><!--seam:each:posts--><li><!--seam:$.name--></li><!--seam:endeach--></ul>"
    );
  }


  // -- HomeSkeleton regression: exercises all 4 extraction bugs --

  #[test]
  fn extract_home_skeleton_regression() {
    // Models the actual HomeSkeleton component: top-level boolean that causes
    // class-attribute splitting (Bug 4), array with nested boolean + enum
    // causing overlapping effects (Bugs 2 & 3), and container duplication (Bug 1).
    let axes = vec![
      make_axis("isLoggedIn", "boolean", vec![json!(true), json!(false)]),
      make_axis("posts", "array", vec![json!("populated"), json!("empty")]),
      make_axis("posts.$.isPublished", "boolean", vec![json!(true), json!(false)]),
      make_axis("posts.$.priority", "enum", vec![json!("high"), json!("medium"), json!("low")]),
    ];

    // Variant HTML mimics the skeleton renderer output.
    // The isLoggedIn axis changes a class value AND text content (triggers Bug 4).
    // The posts array wraps <li> items in <ul> (triggers Bug 1).
    // Nested isPublished + priority overlap in the <li> body (triggers Bugs 2 & 3).
    fn gen(logged_in: bool, posts_pop: bool, published: bool, priority: &str) -> String {
      let status = if logged_in {
        r#"<p class="text-green">Signed in</p>"#
      } else {
        r#"<p class="text-gray">Please sign in</p>"#
      };
      let posts_html = if posts_pop {
        let border = match priority {
          "high" => "border-red",
          "medium" => "border-amber",
          _ => "border-gray",
        };
        let pri_label = match priority {
          "high" => "High",
          "medium" => "Medium",
          _ => "Low",
        };
        let pub_html = if published { "<span>Published</span>" } else { "" };
        format!(
          r#"<ul class="list"><li class="{border}"><!--seam:posts.$.title-->{pub_html}<span>Priority: {pri_label}</span></li></ul>"#
        )
      } else {
        "<p>No posts</p>".to_string()
      };
      format!("<div>{status}{posts_html}</div>")
    }

    // Cartesian product: isLoggedIn(2) * posts(2) * isPublished(2) * priority(3) = 24
    let mut variants = Vec::new();
    for &logged_in in &[true, false] {
      for &posts_pop in &[true, false] {
        for &published in &[true, false] {
          for priority in &["high", "medium", "low"] {
            variants.push(gen(logged_in, posts_pop, published, priority));
          }
        }
      }
    }

    let result = extract_template(&axes, &variants);

    // Bug 4: diff boundary must not split inside class attribute
    assert!(
      !result.contains(r#"class="text-<!--seam:"#),
      "Bug 4: diff split inside class attribute in:\n{result}"
    );

    // Bug 1: <ul> must NOT be inside the each loop (container should stay outside)
    assert!(
      !result.contains("<!--seam:each:posts--><ul"),
      "Bug 1: container duplicated inside each loop in:\n{result}"
    );

    // Bug 2: all seam comments must be well-formed (no broken "-seam:" without "<!--")
    for (i, _) in result.match_indices("-seam:endif") {
      assert!(
        i >= 3 && &result[i - 3..i] == "<!-",
        "Bug 2: malformed endif comment at byte {i} in:\n{result}"
      );
    }

    // Bug 3: no stale content leaking after endmatch
    if let Some(after) = result.split("<!--seam:endmatch-->").nth(1) {
      let before_next_tag = after.split('<').next().unwrap_or("");
      assert!(
        !before_next_tag.contains("Priority:"),
        "Bug 3: stale content after endmatch in:\n{result}"
      );
    }

    // Positive structural assertions
    assert!(result.contains("<!--seam:if:isLoggedIn-->"), "missing if:isLoggedIn in:\n{result}");
    assert!(result.contains("<!--seam:else-->"), "missing else in:\n{result}");
    assert!(result.contains("<!--seam:endif:isLoggedIn-->"), "missing endif:isLoggedIn in:\n{result}");
    assert!(result.contains("<!--seam:each:posts-->"), "missing each:posts in:\n{result}");
    assert!(result.contains("<!--seam:endeach-->"), "missing endeach in:\n{result}");
    assert!(result.contains("<!--seam:if:$.isPublished-->"), "missing if:$.isPublished in:\n{result}");
    assert!(result.contains("<!--seam:endif:$.isPublished-->"), "missing endif:$.isPublished in:\n{result}");
    assert!(result.contains("<!--seam:match:$.priority-->"), "missing match:$.priority in:\n{result}");
    assert!(result.contains("<!--seam:when:high-->"), "missing when:high in:\n{result}");
    assert!(result.contains("<!--seam:endmatch-->"), "missing endmatch in:\n{result}");
    assert!(!result.contains("posts.$."), "leaked nested path in:\n{result}");
  }

  #[test]
  fn extract_boolean_if_else_in_class_attribute() {
    // Targeted Bug 4 test: boolean axis where diff falls inside a class attribute
    let axes = vec![make_axis("dark", "boolean", vec![json!(true), json!(false)])];
    let variants = vec![
      r#"<div class="bg-black text-white">Dark</div>"#.to_string(),
      r#"<div class="bg-white text-black">Light</div>"#.to_string(),
    ];
    let result = extract_template(&axes, &variants);
    // The entire <div> should be wrapped, not just partial class values
    assert!(
      !result.contains(r#"class=""#) || !result.contains("<!--seam:if:dark-->text-"),
      "diff boundary inside class attribute in:\n{result}"
    );
    // The if/else should wrap complete elements
    assert!(result.contains("<!--seam:if:dark-->"), "missing if in:\n{result}");
    assert!(result.contains("<!--seam:else-->"), "missing else in:\n{result}");
    assert!(result.contains("<!--seam:endif:dark-->"), "missing endif in:\n{result}");
  }

  #[test]
  fn extract_array_container_unwrap() {
    // Targeted Bug 1 test: array body captured with its <ul> container
    let axes = vec![
      make_axis("items", "array", vec![json!("populated"), json!("empty")]),
    ];
    let variants = vec![
      r#"<div><ul class="list"><li><!--seam:items.$.name--></li></ul></div>"#.to_string(),
      r#"<div><p>No items</p></div>"#.to_string(),
    ];
    let result = extract_template(&axes, &variants);
    // The <ul> should be OUTSIDE the each loop, only <li> inside
    assert!(
      result.contains("<ul") && result.contains("<!--seam:each:items-->"),
      "missing structure in:\n{result}"
    );
    assert!(
      !result.contains("<!--seam:each:items--><ul"),
      "container inside each loop in:\n{result}"
    );
  }
}
