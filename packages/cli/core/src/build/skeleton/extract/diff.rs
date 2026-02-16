/* packages/cli/core/src/build/skeleton/extract/diff.rs */

/// Snap a prefix-side boundary so it never falls inside `<tag ...>` or inside
/// an element's text content where the text shares a prefix with another element.
/// Scans backwards from `pos`; if the last `<` is unmatched, snap before it.
/// If `pos` is in text content (after `>`, not before `<`), snap back to
/// before the enclosing element's opening tag.
pub(super) fn snap_prefix_to_tag_boundary(html: &[u8], pos: usize) -> usize {
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
pub(super) fn snap_suffix_to_tag_boundary(html: &[u8], end: usize) -> usize {
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
pub(super) fn tag_depth(block: &[u8]) -> i32 {
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
pub(super) fn extend_to_balanced(html: &[u8], start: usize, end: usize) -> usize {
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

/// Two-way diff: find common prefix/suffix between two strings, return (start, end_a, end_b)
/// where a[start..end_a] and b[start..end_b] are the differing regions.
pub(super) fn two_way_diff(a: &str, b: &str) -> (usize, usize, usize) {
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
pub(super) fn n_way_prefix_suffix(variants: &[&str]) -> (usize, usize) {
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

#[cfg(test)]
mod tests {
  use super::*;

  // -- snap_prefix_to_tag_boundary --

  #[test]
  fn snap_prefix_boundary_at_start() {
    // Position 0: nothing to snap
    let html = b"<div>hello</div>";
    assert_eq!(snap_prefix_to_tag_boundary(html, 0), 0);
  }

  #[test]
  fn snap_prefix_mid_tag() {
    // Position inside `<div class="x">` — should snap back to `<`
    let html = b"<div class=\"x\">content</div>";
    assert_eq!(snap_prefix_to_tag_boundary(html, 5), 0);
  }

  #[test]
  fn snap_prefix_after_tag() {
    // Position right after `>` at a `<` boundary — no change needed
    let html = b"<div><span>text</span></div>";
    assert_eq!(snap_prefix_to_tag_boundary(html, 5), 5);
  }

  // -- tag_depth --

  #[test]
  fn tag_depth_balanced() {
    assert_eq!(tag_depth(b"<div><span>x</span></div>"), 0);
  }

  #[test]
  fn tag_depth_unclosed() {
    assert_eq!(tag_depth(b"<div><span>"), 2);
  }

  #[test]
  fn tag_depth_closing_only() {
    assert_eq!(tag_depth(b"</span></div>"), -2);
  }

  #[test]
  fn tag_depth_self_closing() {
    assert_eq!(tag_depth(b"<img/><br/>"), 0);
  }

  // -- extend_to_balanced --

  #[test]
  fn extend_balanced_noop() {
    // Already balanced — no extension needed
    let html = b"<div><span>x</span></div>";
    assert_eq!(extend_to_balanced(html, 0, html.len()), html.len());
  }

  #[test]
  fn extend_unbalanced_forward() {
    // `<div>` is unclosed at end=5; extend to include `</div>`
    let html = b"<div>text</div>";
    assert_eq!(extend_to_balanced(html, 0, 5), html.len());
  }

  #[test]
  fn extend_nested_tags() {
    // `<div><p>` unclosed at end=8; need to close both
    let html = b"<div><p>text</p></div>";
    assert_eq!(extend_to_balanced(html, 0, 8), html.len());
  }

  // -- two_way_diff --

  #[test]
  fn two_way_diff_identical() {
    let s = "<div>same</div>";
    let (start, end_a, end_b) = two_way_diff(s, s);
    // Identical strings: diff region should be empty
    assert_eq!(start, end_a);
    assert_eq!(start, end_b);
  }

  #[test]
  fn two_way_diff_simple() {
    let a = "<div><b>Bold</b></div>";
    let b = "<div></div>";
    let (start, end_a, end_b) = two_way_diff(a, b);
    assert_eq!(&a[start..end_a], "<b>Bold</b>");
    assert_eq!(&b[start..end_b], "");
  }

  #[test]
  fn two_way_diff_tag_boundary_snapping() {
    // Diff falls inside a tag attribute — should snap to tag boundary
    let a = r#"<p class="red">text</p>"#;
    let b = r#"<p class="blue">text</p>"#;
    let (start, end_a, end_b) = two_way_diff(a, b);
    // Should snap to include the full opening tag at minimum
    assert!(start <= 1, "start should snap to tag boundary, got {start}");
    assert!(a[start..end_a].contains("class="), "block_a missing class: {}", &a[start..end_a]);
    assert!(b[start..end_b].contains("class="), "block_b missing class: {}", &b[start..end_b]);
  }
}
