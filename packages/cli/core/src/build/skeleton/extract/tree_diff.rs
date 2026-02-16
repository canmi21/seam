/* packages/cli/core/src/build/skeleton/extract/tree_diff.rs */

use super::dom::{fingerprint, DomNode};

#[derive(Debug, PartialEq)]
pub(super) enum DiffOp {
  Identical(usize, usize),
  Modified(usize, usize),
  OnlyLeft(usize),
  OnlyRight(usize),
}

/// Align two child lists using fingerprint-based LCS, then greedy tag matching.
/// Output is ordered for left-to-right consumption: OnlyLeft before OnlyRight
/// at each position, maintaining relative order of both sequences.
pub(super) fn diff_children(a: &[DomNode], b: &[DomNode]) -> Vec<DiffOp> {
  let fp_a: Vec<String> = a.iter().map(fingerprint).collect();
  let fp_b: Vec<String> = b.iter().map(fingerprint).collect();

  let n = fp_a.len();
  let m = fp_b.len();

  // Phase 1: LCS on fingerprints
  let mut dp = vec![vec![0u32; m + 1]; n + 1];
  for i in (0..n).rev() {
    for j in (0..m).rev() {
      dp[i][j] =
        if fp_a[i] == fp_b[j] { dp[i + 1][j + 1] + 1 } else { dp[i + 1][j].max(dp[i][j + 1]) };
    }
  }

  let mut lcs_pairs: Vec<(usize, usize)> = Vec::new();
  let (mut i, mut j) = (0, 0);
  while i < n && j < m {
    if fp_a[i] == fp_b[j] {
      lcs_pairs.push((i, j));
      i += 1;
      j += 1;
    } else if dp[i + 1][j] >= dp[i][j + 1] {
      i += 1;
    } else {
      j += 1;
    }
  }

  let mut matched_a = vec![false; n];
  let mut matched_b = vec![false; m];
  for &(ai, bj) in &lcs_pairs {
    matched_a[ai] = true;
    matched_b[bj] = true;
  }

  // Phase 2: greedy tag matching on remaining unmatched nodes
  let unmatched_b: Vec<usize> = (0..m).filter(|&j| !matched_b[j]).collect();
  let mut used_b = vec![false; unmatched_b.len()];
  let mut modified_pairs: Vec<(usize, usize)> = Vec::new();

  for ai in 0..n {
    if matched_a[ai] {
      continue;
    }
    if let DomNode::Element { tag: ref tag_a, .. } = a[ai] {
      for (kb, &bj) in unmatched_b.iter().enumerate() {
        if used_b[kb] {
          continue;
        }
        if let DomNode::Element { tag: ref tag_b, .. } = b[bj] {
          if tag_a == tag_b {
            used_b[kb] = true;
            matched_a[ai] = true;
            matched_b[bj] = true;
            modified_pairs.push((ai, bj));
            break;
          }
        }
      }
    }
  }

  // Collect all matched pairs sorted by a-index: (a_idx, b_idx, is_identical)
  let mut pairs: Vec<(usize, usize, bool)> = Vec::new();
  for &(ai, bj) in &lcs_pairs {
    pairs.push((ai, bj, true));
  }
  for &(ai, bj) in &modified_pairs {
    pairs.push((ai, bj, false));
  }
  pairs.sort_by_key(|&(ai, _, _)| ai);

  // Phase 3: interleave to build ordered output.
  // Walk matched pairs in order; before each pair, emit unmatched a-nodes
  // then unmatched b-nodes in that gap.
  let mut result = Vec::new();
  let mut prev_a = 0usize;
  let mut prev_b = 0usize;

  for &(ai, bj, is_identical) in &pairs {
    // Emit unmatched a-nodes in [prev_a, ai)
    for (idx, &m) in matched_a.iter().enumerate().take(ai).skip(prev_a) {
      if !m {
        result.push(DiffOp::OnlyLeft(idx));
      }
    }
    // Emit unmatched b-nodes in [prev_b, bj)
    for (idx, &m) in matched_b.iter().enumerate().take(bj).skip(prev_b) {
      if !m {
        result.push(DiffOp::OnlyRight(idx));
      }
    }
    // Emit the matched pair
    if is_identical {
      result.push(DiffOp::Identical(ai, bj));
    } else {
      result.push(DiffOp::Modified(ai, bj));
    }
    prev_a = ai + 1;
    prev_b = bj + 1;
  }

  // Emit remaining unmatched after the last pair
  for (idx, &m) in matched_a.iter().enumerate().take(n).skip(prev_a) {
    if !m {
      result.push(DiffOp::OnlyLeft(idx));
    }
  }
  for (idx, &matched) in matched_b.iter().enumerate().take(m).skip(prev_b) {
    if !matched {
      result.push(DiffOp::OnlyRight(idx));
    }
  }

  result
}

#[cfg(test)]
mod tests {
  use super::*;

  fn el(tag: &str, children: Vec<DomNode>) -> DomNode {
    DomNode::Element { tag: tag.to_string(), attrs: String::new(), children, self_closing: false }
  }

  fn text(s: &str) -> DomNode {
    DomNode::Text(s.to_string())
  }

  fn span(content: &str) -> DomNode {
    el("span", vec![text(content)])
  }

  #[test]
  fn diff_identical_children() {
    let nodes = vec![span("Hello"), span("World")];
    let result = diff_children(&nodes, &nodes);
    assert_eq!(result, vec![DiffOp::Identical(0, 0), DiffOp::Identical(1, 1)]);
  }

  #[test]
  fn diff_extra_in_left() {
    let a = vec![span("A"), span("B"), span("C")];
    let b = vec![span("A"), span("C")];
    let result = diff_children(&a, &b);
    assert_eq!(
      result,
      vec![DiffOp::Identical(0, 0), DiffOp::OnlyLeft(1), DiffOp::Identical(2, 1),]
    );
  }

  #[test]
  fn diff_extra_in_right() {
    let a = vec![span("A"), span("C")];
    let b = vec![span("A"), span("B"), span("C")];
    let result = diff_children(&a, &b);
    assert_eq!(
      result,
      vec![DiffOp::Identical(0, 0), DiffOp::OnlyRight(1), DiffOp::Identical(1, 2),]
    );
  }

  #[test]
  fn diff_replacement() {
    let a = vec![span("Hello")];
    let b = vec![span("Goodbye")];
    let result = diff_children(&a, &b);
    assert_eq!(result, vec![DiffOp::Modified(0, 0)]);
  }

  #[test]
  fn diff_sibling_conditionals() {
    let a = vec![span("Admin"), span("Welcome")];
    let b = vec![span("Welcome")];
    let result = diff_children(&a, &b);
    assert_eq!(result, vec![DiffOp::OnlyLeft(0), DiffOp::Identical(1, 0)]);
  }

  #[test]
  fn diff_sibling_conditionals_reversed() {
    let a = vec![span("Admin"), span("Welcome")];
    let b = vec![span("Admin")];
    let result = diff_children(&a, &b);
    assert_eq!(result, vec![DiffOp::Identical(0, 0), DiffOp::OnlyLeft(1)]);
  }

  #[test]
  fn diff_if_else_pair() {
    let a = vec![el("b", vec![text("Welcome")])];
    let b = vec![el("i", vec![text("Login")])];
    let result = diff_children(&a, &b);
    assert_eq!(result, vec![DiffOp::OnlyLeft(0), DiffOp::OnlyRight(0)]);
  }

  #[test]
  fn diff_empty_lists() {
    let result = diff_children(&[], &[]);
    assert!(result.is_empty());
  }

  #[test]
  fn diff_nested_modified() {
    let a = vec![el("div", vec![span("Old")])];
    let b = vec![el("div", vec![span("New")])];
    let result = diff_children(&a, &b);
    assert_eq!(result, vec![DiffOp::Modified(0, 0)]);
  }
}
