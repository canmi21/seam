/* src/cli/core/src/build/skeleton/extract/mod.rs */

mod array;
mod boolean;
mod combo;
mod container;
mod dom;
mod enum_axis;
mod tree_diff;
mod variant;

use std::collections::HashSet;

use super::Axis;
use array::{process_array, process_array_with_children};
use boolean::process_boolean;
use combo::classify_axes;
use dom::{parse_html, serialize, DomNode};
use enum_axis::process_enum;

// -- Shared helpers (used by boolean, enum_axis, array sub-modules via super::) --

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

/// Map content nodes in a tree (skipping directive comments) to tree indices.
/// Returns a vec where content_map[k] = index in `tree` of the k-th content node.
fn content_indices(tree: &[DomNode]) -> Vec<usize> {
  tree.iter().enumerate().filter(|(_, n)| !is_directive_comment(n)).map(|(i, _)| i).collect()
}

/// Find the tree index of the n-th non-directive node.
fn nth_content_index(tree: &[DomNode], n: usize) -> Option<usize> {
  tree.iter().enumerate().filter(|(_, n)| !is_directive_comment(n)).nth(n).map(|(i, _)| i)
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

// -- Orchestrator --

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
      "enum" => {
        let (new_result, consumed_siblings) = process_enum(result, axes, variants, idx);
        if consumed_siblings {
          // All sibling axes were recursively processed inside each enum arm,
          // so mark them handled to prevent doubled directives.
          for &other in &top_level {
            if other != idx {
              handled.insert(other);
            }
          }
        }
        new_result
      }
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
mod tests;
