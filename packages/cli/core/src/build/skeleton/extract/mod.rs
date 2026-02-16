/* packages/cli/core/src/build/skeleton/extract/mod.rs */

mod combo;
mod container;
mod dom;
mod tree_diff;
mod variant;

use std::collections::HashSet;

use super::Axis;
use combo::classify_axes;
use container::unwrap_container_tree;
use dom::{parse_html, serialize, DomNode};
use tree_diff::{diff_children, DiffOp};
use variant::{
  find_enum_all_variants_for_axis, find_enum_group_for_axis, find_pair_for_axis,
  find_scoped_variant_indices,
};

/// True if a Comment node is a seam directive (if/else/endif/each/match/when/...).
fn is_directive_comment(node: &DomNode) -> bool {
  match node {
    DomNode::Comment(c) => {
      c.starts_with("seam:if:")
        || c.starts_with("seam:endif:")
        || c == "seam:else"
        || c.starts_with("seam:each:")
        || c == "seam:endeach"
        || c.starts_with("seam:match:")
        || c.starts_with("seam:when:")
        || c == "seam:endmatch"
    }
    _ => false,
  }
}

/// Insert boolean/nullable directives into a node list.
/// `tree` corresponds to `a_nodes` structurally (ignoring previously-inserted
/// directive Comments). Walks the diff between `a_nodes` and `b_nodes`, and
/// inserts if/else/endif Comment nodes into the result.
fn insert_boolean_directives(
  tree: Vec<DomNode>,
  a_nodes: &[DomNode],
  b_nodes: &[DomNode],
  path: &str,
) -> Vec<DomNode> {
  let ops = diff_children(a_nodes, b_nodes);

  // Map content nodes in `tree` (skipping directive comments) to tree indices.
  // content_map[k] = index in `tree` of the k-th content node.
  let content_map: Vec<usize> =
    tree.iter().enumerate().filter(|(_, n)| !is_directive_comment(n)).map(|(i, _)| i).collect();

  // Build new children list by walking ops and copying from tree
  let mut result = Vec::new();
  let mut tree_content_idx = 0usize; // which content node we're at in tree
  let mut tree_pos = 0usize; // raw index into tree

  // Helper: advance tree_pos to copy any directive comments before the next content node
  fn copy_leading_directives(
    tree: &[DomNode],
    tree_pos: &mut usize,
    content_map: &[usize],
    tree_content_idx: usize,
    result: &mut Vec<DomNode>,
  ) {
    let target =
      if tree_content_idx < content_map.len() { content_map[tree_content_idx] } else { tree.len() };
    while *tree_pos < target {
      result.push(tree[*tree_pos].clone());
      *tree_pos += 1;
    }
  }

  let mut op_idx = 0;
  while op_idx < ops.len() {
    match &ops[op_idx] {
      DiffOp::Identical(_, _) => {
        copy_leading_directives(&tree, &mut tree_pos, &content_map, tree_content_idx, &mut result);
        result.push(tree[tree_pos].clone());
        tree_pos += 1;
        tree_content_idx += 1;
        op_idx += 1;
      }
      DiffOp::Modified(ai, bi) => {
        copy_leading_directives(&tree, &mut tree_pos, &content_map, tree_content_idx, &mut result);
        // Same tag, different content — try to recurse into children
        match (&tree[tree_pos], &a_nodes[*ai], &b_nodes[*bi]) {
          (
            DomNode::Element { tag, attrs, children: tc, self_closing },
            DomNode::Element { attrs: aa, children: ac, .. },
            DomNode::Element { attrs: ab, children: bc, .. },
          ) if aa == ab => {
            // Same attrs — recurse into children
            let merged = insert_boolean_directives(tc.clone(), ac, bc, path);
            result.push(DomNode::Element {
              tag: tag.clone(),
              attrs: attrs.clone(),
              children: merged,
              self_closing: *self_closing,
            });
          }
          _ => {
            // Different attrs or different node types — wrap in if/else
            result.push(DomNode::Comment(format!("seam:if:{path}")));
            result.push(a_nodes[*ai].clone());
            result.push(DomNode::Comment("seam:else".into()));
            result.push(b_nodes[*bi].clone());
            result.push(DomNode::Comment(format!("seam:endif:{path}")));
          }
        }
        tree_pos += 1;
        tree_content_idx += 1;
        op_idx += 1;
      }
      DiffOp::OnlyLeft(ai) => {
        copy_leading_directives(&tree, &mut tree_pos, &content_map, tree_content_idx, &mut result);
        // Check if next op is OnlyRight — forms an if/else replacement pair
        if op_idx + 1 < ops.len() {
          if let DiffOp::OnlyRight(bi) = &ops[op_idx + 1] {
            result.push(DomNode::Comment(format!("seam:if:{path}")));
            result.push(a_nodes[*ai].clone());
            result.push(DomNode::Comment("seam:else".into()));
            result.push(b_nodes[*bi].clone());
            result.push(DomNode::Comment(format!("seam:endif:{path}")));
            tree_pos += 1;
            tree_content_idx += 1;
            op_idx += 2;
            continue;
          }
        }
        // If-only: content present when true, absent when false
        result.push(DomNode::Comment(format!("seam:if:{path}")));
        result.push(tree[tree_pos].clone());
        result.push(DomNode::Comment(format!("seam:endif:{path}")));
        tree_pos += 1;
        tree_content_idx += 1;
        op_idx += 1;
      }
      DiffOp::OnlyRight(bi) => {
        copy_leading_directives(&tree, &mut tree_pos, &content_map, tree_content_idx, &mut result);
        // Content only in false variant (not preceded by OnlyLeft)
        result.push(DomNode::Comment(format!("seam:if:{path}")));
        result.push(DomNode::Comment("seam:else".into()));
        result.push(b_nodes[*bi].clone());
        result.push(DomNode::Comment(format!("seam:endif:{path}")));
        // Don't advance tree_pos/tree_content_idx — no corresponding node in a
        op_idx += 1;
      }
    }
  }

  // Copy remaining tree nodes (trailing directive comments)
  while tree_pos < tree.len() {
    result.push(tree[tree_pos].clone());
    tree_pos += 1;
  }

  result
}

/// Rename seam slot markers in a tree: `<!--seam:prefix.x-->` → `<!--seam:x-->`
fn rename_slot_markers(nodes: &mut [DomNode], prefix: &str) {
  let old = format!("seam:{prefix}.");
  for node in nodes.iter_mut() {
    match node {
      DomNode::Comment(c) if c.starts_with(&old) => {
        *c = format!("seam:{}", &c[old.len()..]);
      }
      DomNode::Element { children, .. } => rename_slot_markers(children, prefix),
      _ => {}
    }
  }
}

/// Process a single boolean/nullable axis: insert if/else/endif directives.
fn process_boolean(
  result: Vec<DomNode>,
  axes: &[Axis],
  variants: &[String],
  axis_idx: usize,
) -> Vec<DomNode> {
  let axis = &axes[axis_idx];
  let pair = find_pair_for_axis(axes, variants.len(), axis_idx);
  let (vi_a, vi_b) = match pair {
    Some(p) => p,
    None => return result,
  };

  let tree_a = parse_html(&variants[vi_a]);
  let tree_b = parse_html(&variants[vi_b]);

  insert_boolean_directives(result, &tree_a, &tree_b, &axis.path)
}

/// Process a single enum axis: insert match/when/endmatch directives.
fn process_enum(
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

  // Find the common structure by diffing all variant trees against the first
  // to locate the varying region. We diff each variant against variant 0.
  let base_tree = &trees[0];

  // Walk the tree to find the level where variants diverge
  fn find_enum_region(base: &[DomNode], others: &[Vec<DomNode>]) -> Option<EnumRegion> {
    // Check if all nodes lists are identical
    let all_same = others.iter().all(|o| o == base);
    if all_same {
      return None;
    }

    // Try to find divergence at the child level
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

    // Count common suffix (from the end)
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
      // All content is shared — check if one shared element has differing children
      // Recurse into shared elements
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

struct EnumRegion {
  parent_path: Vec<usize>,
  prefix: usize,
  suffix: usize,
}

/// Navigate into a tree following a path of child indices.
fn navigate_to_children<'a>(nodes: &'a [DomNode], path: &[usize]) -> &'a [DomNode] {
  if path.is_empty() {
    return nodes;
  }
  match &nodes[path[0]] {
    DomNode::Element { children, .. } => navigate_to_children(children, &path[1..]),
    _ => nodes,
  }
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

/// Process a single array axis (without nested children):
/// insert each/endeach directives, rename slot markers, unwrap container.
fn process_array(
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

  // Build result: copy content map approach
  let content_map: Vec<usize> =
    tree.iter().enumerate().filter(|(_, n)| !is_directive_comment(n)).map(|(i, _)| i).collect();

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
        // First body node gets the each_nodes, rest are consumed
        if *ai == body_indices[0] {
          result.extend(each_nodes.iter().cloned());
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
    if let DiffOp::Modified(ai, bi) = op {
      if let (
        DomNode::Element { children: ref pc, .. },
        DomNode::Element { children: ref ec, .. },
      ) = (&pop_nodes[ai], &empty_nodes[bi])
      {
        // Find corresponding tree node (skip directive comments)
        let tree_idx =
          tree.iter().enumerate().filter(|(_, n)| !is_directive_comment(n)).nth(ai).map(|(i, _)| i);
        if let Some(ti) = tree_idx {
          if let DomNode::Element { children: ref mut tc, .. } = &mut tree[ti] {
            *tc = insert_array_directives(std::mem::take(tc), pc, ec, path);
          }
        }
      }
    }
  }
  tree
}

/// Wrap array body nodes with each/endeach, unwrapping container if applicable.
fn wrap_array_body(body: &[DomNode], path: &str) -> Vec<DomNode> {
  if let Some((tag, attrs, inner)) = unwrap_container_tree(body) {
    // Container unwrap: <ul>each...endeach</ul>
    let mut inner_with_directives = vec![DomNode::Comment(format!("seam:each:{path}"))];
    inner_with_directives.extend(inner.iter().cloned());
    inner_with_directives.push(DomNode::Comment("seam:endeach".into()));
    vec![DomNode::Element {
      tag: tag.to_string(),
      attrs: attrs.to_string(),
      children: inner_with_directives,
      self_closing: false,
    }]
  } else {
    let mut nodes = vec![DomNode::Comment(format!("seam:each:{path}"))];
    nodes.extend(body.iter().cloned());
    nodes.push(DomNode::Comment("seam:endeach".into()));
    nodes
  }
}

/// Recursively find the body location by diffing populated vs empty trees.
/// Traverses through Modified elements until OnlyLeft items (the body) are found.
struct BodyLocation {
  path: Vec<usize>,
  body_indices: Vec<usize>,
}

fn find_body_in_trees(pop: &[DomNode], empty: &[DomNode]) -> Option<BodyLocation> {
  let ops = diff_children(pop, empty);

  let body_idx: Vec<usize> = ops
    .iter()
    .filter_map(|op| if let DiffOp::OnlyLeft(ai) = op { Some(*ai) } else { None })
    .collect();

  if !body_idx.is_empty() {
    return Some(BodyLocation { path: vec![], body_indices: body_idx });
  }

  // Recurse into Modified elements to find body deeper
  for op in &ops {
    if let DiffOp::Modified(ai, bi) = op {
      if let (
        DomNode::Element { children: ref pc, .. },
        DomNode::Element { children: ref ec, .. },
      ) = (&pop[*ai], &empty[*bi])
      {
        if let Some(mut loc) = find_body_in_trees(pc, ec) {
          loc.path.insert(0, *ai);
          return Some(loc);
        }
      }
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
    let content_idx = result
      .iter()
      .enumerate()
      .filter(|(_, n)| !is_directive_comment(n))
      .nth(path[0])
      .map(|(i, _)| i);
    if let Some(ci) = content_idx {
      if let DomNode::Element { children, .. } = &mut result[ci] {
        replace_body_at_path(children, &path[1..], body_indices, replacement);
      }
    }
  }
}

/// Process an array axis that has nested child axes.
fn process_array_with_children(
  mut result: Vec<DomNode>,
  axes: &[Axis],
  variants: &[String],
  group: &combo::AxisGroup,
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

  // 8. Wrap with each markers
  let each_nodes = wrap_array_body(&body_tree, &array_axis.path);

  // 9. Insert into result tree at the body location
  replace_body_at_path(&mut result, &body_loc.path, &body_loc.body_indices, each_nodes);
  result
}

/// Core recursive extraction engine.
fn extract_template_inner(axes: &[Axis], variants: &[String]) -> String {
  if variants.is_empty() {
    return String::new();
  }
  if variants.len() == 1 || axes.is_empty() {
    return variants[0].clone();
  }

  let mut result = parse_html(&variants[0]);

  // 1. Classify axes into top-level and nested groups
  let (top_level, groups) = classify_axes(axes);

  // 2. Track axes handled by groups (parent + all children)
  let mut handled: HashSet<usize> = HashSet::new();
  for group in &groups {
    handled.insert(group.parent_axis_idx);
    for &child in &group.children {
      handled.insert(child);
    }
    result = process_array_with_children(result, axes, variants, group);
  }

  // 3. Process remaining top-level axes not owned by any group
  for &idx in &top_level {
    if handled.contains(&idx) {
      continue;
    }
    let axis = &axes[idx];
    result = match axis.kind.as_str() {
      "boolean" | "nullable" => process_boolean(result, axes, variants, idx),
      "enum" => process_enum(result, axes, variants, idx),
      "array" => process_array(result, axes, variants, idx),
      _ => result,
    };
  }

  serialize(&result)
}

/// Extract a complete Slot Protocol v2 template from variant HTML strings.
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
    assert!(result.contains("<!--seam:if:isAdmin-->"), "missing if in: {result}");
    assert!(result.contains("<span>Admin</span>"), "missing Admin in: {result}");
    assert!(result.contains("<!--seam:endif:isAdmin-->"), "missing endif in: {result}");
  }

  #[test]
  fn extract_boolean_if_else() {
    let axes = vec![make_axis("isLoggedIn", "boolean", vec![json!(true), json!(false)])];
    let variants =
      vec!["<div><b>Welcome</b></div>".to_string(), "<div><i>Login</i></div>".to_string()];
    let result = extract_template(&axes, &variants);
    assert!(result.contains("<!--seam:if:isLoggedIn-->"), "missing if in: {result}");
    assert!(result.contains("<b>Welcome</b>"), "missing Welcome in: {result}");
    assert!(result.contains("<!--seam:else-->"), "missing else in: {result}");
    assert!(result.contains("<i>Login</i>"), "missing Login in: {result}");
    assert!(result.contains("<!--seam:endif:isLoggedIn-->"), "missing endif in: {result}");
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
    assert!(result.contains("<!--seam:match:role-->"), "missing match in: {result}");
    assert!(result.contains("<!--seam:when:admin-->"), "missing when:admin in: {result}");
    assert!(result.contains("<!--seam:when:member-->"), "missing when:member in: {result}");
    assert!(result.contains("<!--seam:when:guest-->"), "missing when:guest in: {result}");
    assert!(result.contains("<!--seam:endmatch-->"), "missing endmatch in: {result}");
  }

  #[test]
  fn extract_array_each() {
    let axes = vec![make_axis("posts", "array", vec![json!("populated"), json!("empty")])];
    let variants =
      vec!["<ul><li><!--seam:posts.$.name--></li></ul>".to_string(), "<ul></ul>".to_string()];
    let result = extract_template(&axes, &variants);
    assert!(result.contains("<!--seam:each:posts-->"), "missing each in: {result}");
    assert!(result.contains("<!--seam:$.name-->"), "missing $.name in: {result}");
    assert!(result.contains("<!--seam:endeach-->"), "missing endeach in: {result}");
    assert!(!result.contains("posts.$.name"), "leaked full path in: {result}");
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

    fn gen(is_admin: bool, posts_pop: bool, has_image: bool, has_caption: bool) -> String {
      let admin = if is_admin { "<b>Admin</b>" } else { "" };
      let img = if has_image { "<img/>" } else { "" };
      let cap = if has_caption { "<em>Cap</em>" } else { "" };
      let items = if posts_pop { format!("<li>Post{img}{cap}</li>") } else { String::new() };
      format!("<div>{admin}<ul>{items}</ul></div>")
    }

    let variants = vec![
      gen(true, true, true, true),
      gen(true, true, true, false),
      gen(true, true, false, true),
      gen(true, true, false, false),
      gen(true, false, true, true),
      gen(true, false, true, false),
      gen(true, false, false, true),
      gen(true, false, false, false),
      gen(false, true, true, true),
      gen(false, true, true, false),
      gen(false, true, false, true),
      gen(false, true, false, false),
      gen(false, false, true, true),
      gen(false, false, true, false),
      gen(false, false, false, true),
      gen(false, false, false, false),
    ];

    let result = extract_template(&axes, &variants);

    assert!(result.contains("<!--seam:if:isAdmin-->"), "missing if:isAdmin in: {result}");
    assert!(result.contains("<b>Admin</b>"), "missing Admin block in: {result}");
    assert!(result.contains("<!--seam:endif:isAdmin-->"), "missing endif:isAdmin in: {result}");
    assert!(result.contains("<!--seam:each:posts-->"), "missing each:posts in: {result}");
    assert!(result.contains("<!--seam:endeach-->"), "missing endeach in: {result}");
    assert!(result.contains("<!--seam:if:$.hasImage-->"), "missing if:$.hasImage in: {result}");
    assert!(result.contains("<img/>"), "missing img in: {result}");
    assert!(
      result.contains("<!--seam:endif:$.hasImage-->"),
      "missing endif:$.hasImage in: {result}"
    );
    assert!(result.contains("<!--seam:if:$.caption-->"), "missing if:$.caption in: {result}");
    assert!(result.contains("<em>Cap</em>"), "missing Cap block in: {result}");
    assert!(result.contains("<!--seam:endif:$.caption-->"), "missing endif:$.caption in: {result}");
    assert!(!result.contains("posts.$."), "leaked nested path in: {result}");
  }

  #[test]
  fn extract_array_without_children_unchanged() {
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
    let axes = vec![
      make_axis("isLoggedIn", "boolean", vec![json!(true), json!(false)]),
      make_axis("posts", "array", vec![json!("populated"), json!("empty")]),
      make_axis("posts.$.isPublished", "boolean", vec![json!(true), json!(false)]),
      make_axis("posts.$.priority", "enum", vec![json!("high"), json!("medium"), json!("low")]),
    ];

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

    // Bug 1: <ul> must NOT be inside the each loop
    assert!(
      !result.contains("<!--seam:each:posts--><ul"),
      "Bug 1: container duplicated inside each loop in:\n{result}"
    );

    // Bug 2: all seam comments must be well-formed
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
    assert!(
      result.contains("<!--seam:endif:isLoggedIn-->"),
      "missing endif:isLoggedIn in:\n{result}"
    );
    assert!(result.contains("<!--seam:each:posts-->"), "missing each:posts in:\n{result}");
    assert!(result.contains("<!--seam:endeach-->"), "missing endeach in:\n{result}");
    assert!(
      result.contains("<!--seam:if:$.isPublished-->"),
      "missing if:$.isPublished in:\n{result}"
    );
    assert!(
      result.contains("<!--seam:endif:$.isPublished-->"),
      "missing endif:$.isPublished in:\n{result}"
    );
    assert!(
      result.contains("<!--seam:match:$.priority-->"),
      "missing match:$.priority in:\n{result}"
    );
    assert!(result.contains("<!--seam:when:high-->"), "missing when:high in:\n{result}");
    assert!(result.contains("<!--seam:endmatch-->"), "missing endmatch in:\n{result}");
    assert!(!result.contains("posts.$."), "leaked nested path in:\n{result}");
  }

  #[test]
  fn extract_boolean_if_else_in_class_attribute() {
    let axes = vec![make_axis("dark", "boolean", vec![json!(true), json!(false)])];
    let variants = vec![
      r#"<div class="bg-black text-white">Dark</div>"#.to_string(),
      r#"<div class="bg-white text-black">Light</div>"#.to_string(),
    ];
    let result = extract_template(&axes, &variants);
    assert!(
      !result.contains(r#"class=""#) || !result.contains("<!--seam:if:dark-->text-"),
      "diff boundary inside class attribute in:\n{result}"
    );
    assert!(result.contains("<!--seam:if:dark-->"), "missing if in:\n{result}");
    assert!(result.contains("<!--seam:else-->"), "missing else in:\n{result}");
    assert!(result.contains("<!--seam:endif:dark-->"), "missing endif in:\n{result}");
  }

  #[test]
  fn extract_array_container_unwrap() {
    let axes = vec![make_axis("items", "array", vec![json!("populated"), json!("empty")])];
    let variants = vec![
      r#"<div><ul class="list"><li><!--seam:items.$.name--></li></ul></div>"#.to_string(),
      r#"<div><p>No items</p></div>"#.to_string(),
    ];
    let result = extract_template(&axes, &variants);
    assert!(
      result.contains("<ul") && result.contains("<!--seam:each:items-->"),
      "missing structure in:\n{result}"
    );
    assert!(
      !result.contains("<!--seam:each:items--><ul"),
      "container inside each loop in:\n{result}"
    );
  }

  // -- Motivating bug: sibling boolean conditionals --

  #[test]
  fn extract_sibling_booleans() {
    let axes = vec![
      make_axis("isAdmin", "boolean", vec![json!(true), json!(false)]),
      make_axis("isLoggedIn", "boolean", vec![json!(true), json!(false)]),
    ];
    let variants = vec![
      "<div><span>Admin</span><span>Welcome</span></div>".into(), // TT
      "<div><span>Admin</span></div>".into(),                     // TF
      "<div><span>Welcome</span></div>".into(),                   // FT
      "<div></div>".into(),                                       // FF
    ];
    let result = extract_template(&axes, &variants);
    assert!(
      result.contains("<!--seam:if:isAdmin--><span>Admin</span><!--seam:endif:isAdmin-->"),
      "missing isAdmin conditional in:\n{result}"
    );
    assert!(
      result.contains("<!--seam:if:isLoggedIn--><span>Welcome</span><!--seam:endif:isLoggedIn-->"),
      "missing isLoggedIn conditional in:\n{result}"
    );
  }
}
