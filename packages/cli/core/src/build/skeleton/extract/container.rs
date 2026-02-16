/* packages/cli/core/src/build/skeleton/extract/container.rs */

use super::diff::tag_depth;

/// Only unwrap list-like container elements that hold repeating children.
pub(super) fn is_list_container(tag: &str) -> bool {
  matches!(tag, "ul" | "ol" | "dl" | "table" | "tbody" | "thead" | "tfoot" | "select" | "datalist")
}

/// Try to unwrap a single list-container element from an array body.
/// If `block` is `<ul ...>inner</ul>`, returns `Some((open, inner, close))`.
/// Only applies to known list containers (ul, ol, table, etc.).
pub(super) fn unwrap_container(block: &str) -> Option<(&str, &str, &str)> {
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

#[cfg(test)]
mod tests {
  use super::*;

  // -- is_list_container --

  #[test]
  fn recognized_list_containers() {
    for tag in &["ul", "ol", "table", "tbody", "thead", "tfoot", "dl", "select", "datalist"] {
      assert!(is_list_container(tag), "{tag} should be recognized");
    }
  }

  #[test]
  fn rejected_non_list_tags() {
    for tag in &["div", "span", "p", "section", "article", "nav"] {
      assert!(!is_list_container(tag), "{tag} should be rejected");
    }
  }

  // -- unwrap_container --

  #[test]
  fn unwrap_simple_ul() {
    let block = "<ul><li>item</li></ul>";
    let (open, inner, close) = unwrap_container(block).unwrap();
    assert_eq!(open, "<ul>");
    assert_eq!(inner, "<li>item</li>");
    assert_eq!(close, "</ul>");
  }

  #[test]
  fn unwrap_with_attributes() {
    let block = r#"<ul class="x"><li>item</li></ul>"#;
    let (open, inner, close) = unwrap_container(block).unwrap();
    assert_eq!(open, r#"<ul class="x">"#);
    assert_eq!(inner, "<li>item</li>");
    assert_eq!(close, "</ul>");
  }

  #[test]
  fn unwrap_non_list_tag_returns_none() {
    assert!(unwrap_container("<div><p>text</p></div>").is_none());
  }

  #[test]
  fn unwrap_empty_inner_returns_none() {
    assert!(unwrap_container("<ul></ul>").is_none());
  }
}
