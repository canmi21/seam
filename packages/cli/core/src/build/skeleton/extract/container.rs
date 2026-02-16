/* packages/cli/core/src/build/skeleton/extract/container.rs */

use super::dom::DomNode;

/// Only unwrap list-like container elements that hold repeating children.
pub(super) fn is_list_container(tag: &str) -> bool {
  matches!(tag, "ul" | "ol" | "dl" | "table" | "tbody" | "thead" | "tfoot" | "select" | "datalist")
}

/// Try to unwrap a single list-container element from array body nodes.
/// If the body is a single Element like `<ul class="x"><li>...</li></ul>`,
/// returns the container Element (with its children replaced by `inner_children`)
/// split as (tag, attrs, original_children).
pub(super) fn unwrap_container_tree(body: &[DomNode]) -> Option<(&str, &str, &[DomNode])> {
  if body.len() != 1 {
    return None;
  }
  match &body[0] {
    DomNode::Element { tag, attrs, children, self_closing: false } => {
      if is_list_container(tag) && !children.is_empty() {
        Some((tag.as_str(), attrs.as_str(), children.as_slice()))
      } else {
        None
      }
    }
    _ => None,
  }
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

  // -- unwrap_container_tree --

  #[test]
  fn unwrap_tree_simple_ul() {
    let body = vec![DomNode::Element {
      tag: "ul".into(),
      attrs: String::new(),
      children: vec![DomNode::Element {
        tag: "li".into(),
        attrs: String::new(),
        children: vec![DomNode::Text("item".into())],
        self_closing: false,
      }],
      self_closing: false,
    }];
    let (tag, attrs, inner) = unwrap_container_tree(&body).unwrap();
    assert_eq!(tag, "ul");
    assert_eq!(attrs, "");
    assert_eq!(inner.len(), 1);
  }

  #[test]
  fn unwrap_tree_with_attrs() {
    let body = vec![DomNode::Element {
      tag: "ul".into(),
      attrs: r#" class="x""#.into(),
      children: vec![DomNode::Text("item".into())],
      self_closing: false,
    }];
    let (tag, attrs, _) = unwrap_container_tree(&body).unwrap();
    assert_eq!(tag, "ul");
    assert_eq!(attrs, r#" class="x""#);
  }

  #[test]
  fn unwrap_tree_non_list_returns_none() {
    let body = vec![DomNode::Element {
      tag: "div".into(),
      attrs: String::new(),
      children: vec![DomNode::Text("x".into())],
      self_closing: false,
    }];
    assert!(unwrap_container_tree(&body).is_none());
  }

  #[test]
  fn unwrap_tree_empty_returns_none() {
    let body = vec![DomNode::Element {
      tag: "ul".into(),
      attrs: String::new(),
      children: Vec::new(),
      self_closing: false,
    }];
    assert!(unwrap_container_tree(&body).is_none());
  }

  #[test]
  fn unwrap_tree_multiple_nodes_returns_none() {
    let body = vec![DomNode::Text("a".into()), DomNode::Text("b".into())];
    assert!(unwrap_container_tree(&body).is_none());
  }
}
