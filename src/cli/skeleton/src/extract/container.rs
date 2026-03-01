/* src/cli/skeleton/src/extract/container.rs */

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

/// Hoist a shared list container out of directive-wrapped body nodes.
///
/// Handles the pattern where extraction produces directive comments (match/when,
/// if/else) interspersed with identical list containers:
///   `<!--match--><ul><li class="A">x</li></ul><!--when--><ul><li class="B">y</li></ul><!--endmatch-->`
/// → hoist the shared `<ul>` outside:
///   `<ul><!--match--><li class="A">x</li><!--when--><li class="B">y</li><!--endmatch--></ul>`
pub(super) fn hoist_list_container(body: &[DomNode]) -> Option<(String, String, Vec<DomNode>)> {
  let mut container_tag: Option<&str> = None;
  let mut container_attrs: Option<&str> = None;
  let mut has_element = false;

  for node in body {
    match node {
      DomNode::Comment(_) => continue,
      DomNode::Element { tag, attrs, children, self_closing: false }
        if is_list_container(tag) && !children.is_empty() =>
      {
        has_element = true;
        match container_tag {
          None => {
            container_tag = Some(tag);
            container_attrs = Some(attrs);
          }
          Some(t) if t == tag.as_str() && container_attrs == Some(attrs.as_str()) => {}
          _ => return None,
        }
      }
      _ => return None,
    }
  }

  if !has_element {
    return None;
  }

  let tag = container_tag?;
  let attrs = container_attrs?;

  // Restructure: replace each container element with its children,
  // preserving directive comments
  let mut inner = Vec::new();
  for node in body {
    match node {
      DomNode::Comment(c) => inner.push(DomNode::Comment(c.clone())),
      DomNode::Element { children, .. } => inner.extend(children.iter().cloned()),
      _ => {}
    }
  }

  Some((tag.to_string(), attrs.to_string(), inner))
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

  // -- hoist_list_container --

  fn ul(attrs: &str, children: Vec<DomNode>) -> DomNode {
    DomNode::Element { tag: "ul".into(), attrs: attrs.into(), children, self_closing: false }
  }

  fn li(text: &str) -> DomNode {
    DomNode::Element {
      tag: "li".into(),
      attrs: String::new(),
      children: vec![DomNode::Text(text.into())],
      self_closing: false,
    }
  }

  fn comment(s: &str) -> DomNode {
    DomNode::Comment(s.into())
  }

  #[test]
  fn hoist_match_wrapped_uls() {
    let body = vec![
      comment("seam:match:$.priority"),
      comment("seam:when:high"),
      ul("", vec![li("High")]),
      comment("seam:when:low"),
      ul("", vec![li("Low")]),
      comment("seam:endmatch"),
    ];
    let (tag, attrs, inner) = hoist_list_container(&body).unwrap();
    assert_eq!(tag, "ul");
    assert_eq!(attrs, "");
    // Inner should be: match, when:high, li(High), when:low, li(Low), endmatch
    assert_eq!(inner.len(), 6);
    assert_eq!(inner[0], comment("seam:match:$.priority"));
    assert_eq!(inner[2], li("High"));
    assert_eq!(inner[4], li("Low"));
  }

  #[test]
  fn hoist_preserves_attrs() {
    let body = vec![
      comment("seam:if:x"),
      ul(r#" class="list""#, vec![li("A")]),
      comment("seam:else"),
      ul(r#" class="list""#, vec![li("B")]),
      comment("seam:endif:x"),
    ];
    let (tag, attrs, _) = hoist_list_container(&body).unwrap();
    assert_eq!(tag, "ul");
    assert_eq!(attrs, r#" class="list""#);
  }

  #[test]
  fn hoist_rejects_different_attrs() {
    let body = vec![
      comment("seam:if:x"),
      ul(r#" class="a""#, vec![li("A")]),
      comment("seam:else"),
      ul(r#" class="b""#, vec![li("B")]),
      comment("seam:endif:x"),
    ];
    assert!(hoist_list_container(&body).is_none());
  }

  #[test]
  fn hoist_rejects_mixed_content() {
    let body = vec![comment("seam:if:x"), ul("", vec![li("A")]), DomNode::Text("extra".into())];
    assert!(hoist_list_container(&body).is_none());
  }

  #[test]
  fn hoist_rejects_comments_only() {
    let body = vec![comment("seam:if:x"), comment("seam:endif:x")];
    assert!(hoist_list_container(&body).is_none());
  }
}
