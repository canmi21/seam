/* packages/cli/core/src/build/skeleton/extract/enum_axis.rs */

use super::dom::{self, parse_html, serialize, DomNode};
use super::variant::{find_enum_all_variants_for_axis, find_enum_group_for_axis};
use super::{extract_template_inner, navigate_to_children, Axis};

struct EnumRegion {
  parent_path: Vec<usize>,
  prefix: usize,
  suffix: usize,
}

/// Walk the tree to find the level where enum variants diverge.
fn find_enum_region(base: &[DomNode], others: &[Vec<DomNode>]) -> Option<EnumRegion> {
  let all_same = others.iter().all(|o| o == base);
  if all_same {
    return None;
  }

  // Find common prefix and suffix across all variants
  let min_len =
    std::iter::once(base.len()).chain(others.iter().map(|o| o.len())).min().unwrap_or(0);

  let mut common_prefix = 0;
  'prefix: for i in 0..min_len {
    let fp_base = dom::fingerprint(&base[i]);
    for other in others {
      if dom::fingerprint(&other[i]) != fp_base {
        break 'prefix;
      }
    }
    common_prefix += 1;
  }

  let mut common_suffix = 0;
  'suffix: for i in 0..min_len - common_prefix {
    let bi = base.len() - 1 - i;
    let fp_base = dom::fingerprint(&base[bi]);
    for other in others {
      let oi = other.len() - 1 - i;
      if dom::fingerprint(&other[oi]) != fp_base {
        break 'suffix;
      }
    }
    common_suffix += 1;
  }

  if common_prefix + common_suffix >= base.len() {
    // All content is shared — recurse into shared elements
    for i in 0..base.len() {
      if let DomNode::Element { children: ref bc, .. } = base[i] {
        let child_others: Vec<Vec<DomNode>> = others
          .iter()
          .filter_map(|o| {
            if let DomNode::Element { children: ref oc, .. } = o[i] {
              Some(oc.clone())
            } else {
              None
            }
          })
          .collect();
        if child_others.len() == others.len() {
          if let Some(region) = find_enum_region(bc, &child_others) {
            let mut path = vec![i];
            path.extend(region.parent_path);
            return Some(EnumRegion {
              parent_path: path,
              prefix: region.prefix,
              suffix: region.suffix,
            });
          }
        }
      }
    }
    return None;
  }

  Some(EnumRegion { parent_path: Vec::new(), prefix: common_prefix, suffix: common_suffix })
}

/// Process a single enum axis: insert match/when/endmatch directives.
pub(super) fn process_enum(
  result: Vec<DomNode>,
  axes: &[Axis],
  variants: &[String],
  axis_idx: usize,
) -> Vec<DomNode> {
  let axis = &axes[axis_idx];
  let groups = find_enum_group_for_axis(axes, variants.len(), axis_idx);
  if groups.len() < 2 {
    return result;
  }

  // Parse all representative variant trees
  let trees: Vec<Vec<DomNode>> = groups.iter().map(|(_, vi)| parse_html(&variants[*vi])).collect();
  let base_tree = &trees[0];

  let other_trees: Vec<Vec<DomNode>> = trees[1..].to_vec();
  let region = match find_enum_region(base_tree, &other_trees) {
    Some(r) => r,
    None => return result,
  };

  // Collect sibling axes for recursive processing within each arm
  let sibling_axes: Vec<Axis> =
    axes.iter().enumerate().filter(|(i, _)| *i != axis_idx).map(|(_, a)| a.clone()).collect();
  let has_siblings = !sibling_axes.is_empty();
  let all_groups = if has_siblings {
    find_enum_all_variants_for_axis(axes, variants.len(), axis_idx)
  } else {
    Vec::new()
  };

  // Build match/when branches
  let mut branches = Vec::new();
  for (idx, (value, _)) in groups.iter().enumerate() {
    let arm_tree = &trees[idx];
    let arm_children = navigate_to_children(arm_tree, &region.parent_path);
    let body_start = region.prefix;
    let body_end = arm_children.len() - region.suffix;
    let arm_body_nodes = &arm_children[body_start..body_end];

    let arm_body = if has_siblings {
      // Serialize each arm body, recursively extract sibling axes
      let (_, ref arm_indices) = all_groups[idx];
      let arm_bodies: Vec<String> = arm_indices
        .iter()
        .map(|&i| {
          let v_tree = parse_html(&variants[i]);
          let v_children = navigate_to_children(&v_tree, &region.parent_path);
          let end = v_children.len().saturating_sub(region.suffix).max(body_start);
          serialize(&v_children[body_start..end])
        })
        .collect();
      let inner_template = extract_template_inner(&sibling_axes, &arm_bodies);
      parse_html(&inner_template)
    } else {
      arm_body_nodes.to_vec()
    };

    branches.push((value.clone(), arm_body));
  }

  // Insert match/when/endmatch into the result tree at the region location
  apply_enum_directives(result, &region, &axis.path, &branches)
}

/// Apply enum directives (match/when/endmatch) at a specific region in the result tree.
fn apply_enum_directives(
  mut result: Vec<DomNode>,
  region: &EnumRegion,
  path: &str,
  branches: &[(String, Vec<DomNode>)],
) -> Vec<DomNode> {
  if region.parent_path.is_empty() {
    // Directives go at this level
    let body_end = result.len() - region.suffix;
    let mut new = Vec::new();
    new.extend_from_slice(&result[..region.prefix]);
    new.push(DomNode::Comment(format!("seam:match:{path}")));
    for (value, body) in branches {
      new.push(DomNode::Comment(format!("seam:when:{value}")));
      new.extend(body.iter().cloned());
    }
    new.push(DomNode::Comment("seam:endmatch".into()));
    new.extend_from_slice(&result[body_end..]);
    new
  } else {
    // Navigate into the target element
    let idx = region.parent_path[0];
    if let DomNode::Element { tag, attrs, children, self_closing } = &mut result[idx] {
      let sub_region = EnumRegion {
        parent_path: region.parent_path[1..].to_vec(),
        prefix: region.prefix,
        suffix: region.suffix,
      };
      *children = apply_enum_directives(std::mem::take(children), &sub_region, path, branches);
      let _ = (tag, attrs, self_closing); // suppress unused warnings
    }
    result
  }
}
