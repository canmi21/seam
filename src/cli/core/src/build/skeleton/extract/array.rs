/* src/cli/core/src/build/skeleton/extract/array.rs */

use std::collections::HashSet;

use super::boolean::insert_boolean_directives;
use super::combo::AxisGroup;
use super::container::{hoist_list_container, unwrap_container_tree};
use super::dom::{DomNode, parse_html, serialize};
use super::tree_diff::{DiffOp, diff_children};
use super::variant::{find_pair_for_axis, find_scoped_variant_indices};
use super::{
  Axis, content_indices, extract_template_inner, navigate_to_children, nth_content_index,
  rename_slot_markers,
};

/// Process a single array axis (without nested children):
/// insert each/endeach directives, rename slot markers, unwrap container.
pub(super) fn process_array(
  result: Vec<DomNode>,
  axes: &[Axis],
  variants: &[String],
  axis_idx: usize,
) -> Vec<DomNode> {
  let axis = &axes[axis_idx];
  let pair = find_pair_for_axis(axes, variants.len(), axis_idx);
  let (vi_pop, vi_empty) = match pair {
    Some(p) => p,
    None => return result,
  };

  let tree_pop = parse_html(&variants[vi_pop]);
  let tree_empty = parse_html(&variants[vi_empty]);

  insert_array_directives(result, &tree_pop, &tree_empty, &axis.path)
}

/// Insert array directives (each/endeach) by comparing populated vs empty trees.
fn insert_array_directives(
  tree: Vec<DomNode>,
  pop_nodes: &[DomNode],
  empty_nodes: &[DomNode],
  path: &str,
) -> Vec<DomNode> {
  let ops = diff_children(pop_nodes, empty_nodes);

  // Collect body nodes (OnlyLeft in populated) and replacement nodes (OnlyRight in empty)
  let mut body_indices: Vec<usize> = Vec::new();
  let mut has_only_right = false;
  let mut has_modified = false;

  for op in &ops {
    match op {
      DiffOp::OnlyLeft(ai) => body_indices.push(*ai),
      DiffOp::OnlyRight(_) => has_only_right = true,
      DiffOp::Modified(_, _) => has_modified = true,
      DiffOp::Identical(_, _) => {}
    }
  }

  // If content only differs inside a shared element, recurse
  if body_indices.is_empty() && has_modified {
    return insert_array_modified(tree, pop_nodes, empty_nodes, path);
  }

  // If there's only a replacement (OnlyLeft + OnlyRight at same position), treat
  // the entire region as a conditional with if/else semantics for the array
  if body_indices.is_empty() && has_only_right {
    // Fall back to treating as boolean-like diff
    return insert_boolean_directives(tree, pop_nodes, empty_nodes, path);
  }

  if body_indices.is_empty() {
    return tree;
  }

  // Extract body nodes and rename slot markers
  let mut body: Vec<DomNode> = body_indices.iter().map(|&i| pop_nodes[i].clone()).collect();
  rename_slot_markers(&mut body, path);

  // Container unwrap + each/endeach wrapping
  let each_nodes = wrap_array_body(&body, path);

  // If empty variant has replacement content, wrap each in if/else
  let final_nodes = if has_only_right {
    let fallback: Vec<DomNode> = ops
      .iter()
      .filter_map(|op| match op {
        DiffOp::OnlyRight(bi) => Some(empty_nodes[*bi].clone()),
        _ => None,
      })
      .collect();

    let mut nodes = vec![DomNode::Comment(format!("seam:if:{path}"))];
    nodes.extend(each_nodes);
    nodes.push(DomNode::Comment("seam:else".into()));
    nodes.extend(fallback);
    nodes.push(DomNode::Comment(format!("seam:endif:{path}")));
    nodes
  } else {
    each_nodes
  };

  // Build result: copy content map approach
  let content_map = content_indices(&tree);

  let mut result = Vec::new();
  let mut tree_content_idx = 0usize;
  let mut tree_pos = 0usize;

  for op in &ops {
    // Copy leading directives
    let target =
      if tree_content_idx < content_map.len() { content_map[tree_content_idx] } else { tree.len() };
    while tree_pos < target {
      result.push(tree[tree_pos].clone());
      tree_pos += 1;
    }

    match op {
      DiffOp::Identical(_, _) => {
        result.push(tree[tree_pos].clone());
        tree_pos += 1;
        tree_content_idx += 1;
      }
      DiffOp::OnlyLeft(ai) => {
        // First body node gets the final_nodes, rest are consumed
        if *ai == body_indices[0] {
          result.extend(final_nodes.iter().cloned());
        }
        tree_pos += 1;
        tree_content_idx += 1;
      }
      DiffOp::OnlyRight(_) => {
        // Empty variant's extra content — skip (replaced by array when populated)
      }
      DiffOp::Modified(_, _) => {
        result.push(tree[tree_pos].clone());
        tree_pos += 1;
        tree_content_idx += 1;
      }
    }
  }

  while tree_pos < tree.len() {
    result.push(tree[tree_pos].clone());
    tree_pos += 1;
  }

  result
}

/// Handle array where the diff is inside a shared parent element (Modified case).
fn insert_array_modified(
  mut tree: Vec<DomNode>,
  pop_nodes: &[DomNode],
  empty_nodes: &[DomNode],
  path: &str,
) -> Vec<DomNode> {
  let ops = diff_children(pop_nodes, empty_nodes);
  for op in ops {
    if let DiffOp::Modified(ai, bi) = op
      && let (DomNode::Element { children: pc, .. }, DomNode::Element { children: ec, .. }) =
        (&pop_nodes[ai], &empty_nodes[bi])
    {
      // Find corresponding tree node (skip directive comments)
      if let Some(ti) = nth_content_index(&tree, ai)
        && let DomNode::Element { children: tc, .. } = &mut tree[ti]
      {
        *tc = insert_array_directives(std::mem::take(tc), pc, ec, path);
      }
    }
  }
  tree
}

/// Wrap array body nodes with each/endeach, unwrapping container if applicable.
fn wrap_array_body(body: &[DomNode], path: &str) -> Vec<DomNode> {
  // Simple case: single list container
  if let Some((tag, attrs, inner)) = unwrap_container_tree(body) {
    let mut inner_with_directives = vec![DomNode::Comment(format!("seam:each:{path}"))];
    inner_with_directives.extend(inner.iter().cloned());
    inner_with_directives.push(DomNode::Comment("seam:endeach".into()));
    return vec![DomNode::Element {
      tag: tag.to_string(),
      attrs: attrs.to_string(),
      children: inner_with_directives,
      self_closing: false,
    }];
  }

  // Hoist case: directive comments wrap identical list containers
  if let Some((tag, attrs, inner)) = hoist_list_container(body) {
    let mut inner_with_directives = vec![DomNode::Comment(format!("seam:each:{path}"))];
    inner_with_directives.extend(inner);
    inner_with_directives.push(DomNode::Comment("seam:endeach".into()));
    return vec![DomNode::Element {
      tag: tag.to_string(),
      attrs: attrs.to_string(),
      children: inner_with_directives,
      self_closing: false,
    }];
  }

  // No container unwrap
  let mut nodes = vec![DomNode::Comment(format!("seam:each:{path}"))];
  nodes.extend(body.iter().cloned());
  nodes.push(DomNode::Comment("seam:endeach".into()));
  nodes
}

/// Recursively find the body location by diffing populated vs empty trees.
/// Traverses through Modified elements until OnlyLeft items (the body) are found.
struct BodyLocation {
  path: Vec<usize>,
  body_indices: Vec<usize>,
  fallback_indices: Vec<usize>,
}

fn find_body_in_trees(pop: &[DomNode], empty: &[DomNode]) -> Option<BodyLocation> {
  let ops = diff_children(pop, empty);

  let body_idx: Vec<usize> = ops
    .iter()
    .filter_map(|op| if let DiffOp::OnlyLeft(ai) = op { Some(*ai) } else { None })
    .collect();

  if !body_idx.is_empty() {
    let fallback_idx: Vec<usize> = ops
      .iter()
      .filter_map(|op| if let DiffOp::OnlyRight(bi) = op { Some(*bi) } else { None })
      .collect();
    return Some(BodyLocation {
      path: vec![],
      body_indices: body_idx,
      fallback_indices: fallback_idx,
    });
  }

  // Recurse into Modified elements to find body deeper
  for op in &ops {
    if let DiffOp::Modified(ai, bi) = op
      && let (DomNode::Element { children: pc, .. }, DomNode::Element { children: ec, .. }) =
        (&pop[*ai], &empty[*bi])
      && let Some(mut loc) = find_body_in_trees(pc, ec)
    {
      loc.path.insert(0, *ai);
      return Some(loc);
    }
  }

  None
}

/// Navigate into a tree at a path and replace the body nodes with replacement.
fn replace_body_at_path(
  result: &mut Vec<DomNode>,
  path: &[usize],
  body_indices: &[usize],
  replacement: Vec<DomNode>,
) {
  if path.is_empty() {
    let body_set: HashSet<usize> = body_indices.iter().copied().collect();
    let mut new = Vec::new();
    for (i, node) in result.iter().enumerate() {
      if body_set.contains(&i) {
        if i == body_indices[0] {
          new.extend(replacement.iter().cloned());
        }
      } else {
        new.push(node.clone());
      }
    }
    *result = new;
  } else {
    // Navigate to the content node at index path[0] (skip directive comments)
    if let Some(ci) = nth_content_index(result, path[0])
      && let DomNode::Element { children, .. } = &mut result[ci]
    {
      replace_body_at_path(children, &path[1..], body_indices, replacement);
    }
  }
}

/// Process an array axis that has nested child axes.
pub(super) fn process_array_with_children(
  mut result: Vec<DomNode>,
  axes: &[Axis],
  variants: &[String],
  group: &AxisGroup,
) -> Vec<DomNode> {
  let array_axis = &axes[group.parent_axis_idx];
  if array_axis.kind != "array" {
    return result;
  }

  // 1. Find populated/empty pair
  let pair = find_pair_for_axis(axes, variants.len(), group.parent_axis_idx);
  let (_, vi_empty) = match pair {
    Some(p) => p,
    None => return result,
  };
  let tree_empty = parse_html(&variants[vi_empty]);

  // 2. Find all scoped variants (array=populated, non-child axes at reference)
  let scoped_indices =
    find_scoped_variant_indices(axes, variants.len(), group.parent_axis_idx, &group.children);
  if scoped_indices.is_empty() {
    return result;
  }

  // 3. Parse all scoped variants
  let scoped_trees: Vec<Vec<DomNode>> =
    scoped_indices.iter().map(|&i| parse_html(&variants[i])).collect();
  let first_pop = &scoped_trees[0];

  // 4. Find body location by recursively traversing Modified elements
  let body_loc = match find_body_in_trees(first_pop, &tree_empty) {
    Some(loc) => loc,
    None => return result,
  };

  // 5. Extract body from each scoped variant at the found path
  let body_variants: Vec<String> = scoped_trees
    .iter()
    .map(|tree| {
      let parent = navigate_to_children(tree, &body_loc.path);
      let body_nodes: Vec<DomNode> = body_loc
        .body_indices
        .iter()
        .filter(|&&i| i < parent.len())
        .map(|&i| parent[i].clone())
        .collect();
      serialize(&body_nodes)
    })
    .collect();

  // 6. Build child axes with stripped parent prefix
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

  // 6b. Pre-rename slot markers in body variants
  let slot_prefix = format!("<!--seam:{}.", array_axis.path);
  let body_variants: Vec<String> =
    body_variants.into_iter().map(|b| b.replace(&slot_prefix, "<!--seam:")).collect();

  // 7. Recursively extract template from body variants
  let template_body = extract_template_inner(&child_axes, &body_variants);
  let mut body_tree = parse_html(&template_body);
  rename_slot_markers(&mut body_tree, &array_axis.path);

  // 8. Wrap with each markers, adding if/else fallback when present
  let each_nodes = wrap_array_body(&body_tree, &array_axis.path);

  let final_nodes = if !body_loc.fallback_indices.is_empty() {
    let empty_children = navigate_to_children(&tree_empty, &body_loc.path);
    let fallback: Vec<DomNode> = body_loc
      .fallback_indices
      .iter()
      .filter(|&&i| i < empty_children.len())
      .map(|&i| empty_children[i].clone())
      .collect();

    let mut nodes = vec![DomNode::Comment(format!("seam:if:{}", array_axis.path))];
    nodes.extend(each_nodes);
    nodes.push(DomNode::Comment("seam:else".into()));
    nodes.extend(fallback);
    nodes.push(DomNode::Comment(format!("seam:endif:{}", array_axis.path)));
    nodes
  } else {
    each_nodes
  };

  // 9. Insert into result tree at the body location
  replace_body_at_path(&mut result, &body_loc.path, &body_loc.body_indices, final_nodes);
  result
}
