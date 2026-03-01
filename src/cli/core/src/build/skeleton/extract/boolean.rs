/* src/cli/core/src/build/skeleton/extract/boolean.rs */

use super::dom::{DomNode, parse_html};
use super::tree_diff::{DiffOp, diff_children};
use super::variant::find_pair_for_axis;
use super::{Axis, content_indices};

/// Insert boolean/nullable directives into a node list.
/// `tree` corresponds to `a_nodes` structurally (ignoring previously-inserted
/// directive Comments). Walks the diff between `a_nodes` and `b_nodes`, and
/// inserts if/else/endif Comment nodes into the result.
pub(super) fn insert_boolean_directives(
  tree: Vec<DomNode>,
  a_nodes: &[DomNode],
  b_nodes: &[DomNode],
  path: &str,
) -> Vec<DomNode> {
  let ops = diff_children(a_nodes, b_nodes);

  // Map content nodes in `tree` (skipping directive comments) to tree indices.
  // content_map[k] = index in `tree` of the k-th content node.
  let content_map = content_indices(&tree);

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
        if op_idx + 1 < ops.len()
          && let DiffOp::OnlyRight(bi) = &ops[op_idx + 1]
        {
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

/// Process a single boolean/nullable axis: insert if/else/endif directives.
pub(super) fn process_boolean(
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
