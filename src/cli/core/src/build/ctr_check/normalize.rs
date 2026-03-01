/* src/cli/core/src/build/ctr_check/normalize.rs */

// Normalize CtrNode trees to eliminate cosmetic differences.
// Each rule is a function on &mut BTreeMap<String, String>,
// making it easy to add new rules without touching parse or diff.

use std::collections::BTreeMap;

use super::parse::CtrNode;

/// Normalize a tree in place. Recurses into all element children.
pub(super) fn normalize_tree(nodes: &mut [CtrNode]) {
  for node in nodes.iter_mut() {
    if let CtrNode::Element { attrs, children, .. } = node {
      normalize_style(attrs);
      normalize_class(attrs);
      normalize_tree(children);
    }
  }
}

/// Sort CSS properties alphabetically within style attribute.
fn normalize_style(attrs: &mut BTreeMap<String, String>) {
  if let Some(style) = attrs.get_mut("style") {
    let mut props: Vec<&str> =
      style.split(';').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    props.sort_unstable();
    *style = props.join(";");
  }
}

/// Sort class tokens alphabetically.
fn normalize_class(attrs: &mut BTreeMap<String, String>) {
  if let Some(class) = attrs.get_mut("class") {
    let mut tokens: Vec<&str> = class.split_whitespace().collect();
    tokens.sort_unstable();
    *class = tokens.join(" ");
  }
}

#[cfg(test)]
mod tests {
  use super::super::parse::CtrNode;
  use super::*;

  fn elem(tag: &str, attrs: Vec<(&str, &str)>, children: Vec<CtrNode>) -> CtrNode {
    let map: BTreeMap<String, String> =
      attrs.into_iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    CtrNode::Element { tag: tag.to_string(), attrs: map, children }
  }

  #[test]
  fn normalize_style_sorts_properties() {
    let mut nodes = vec![elem("span", vec![("style", "b:y;a:x")], vec![])];
    normalize_tree(&mut nodes);
    match &nodes[0] {
      CtrNode::Element { attrs, .. } => {
        assert_eq!(attrs.get("style").unwrap(), "a:x;b:y");
      }
      _ => panic!("expected Element"),
    }
  }

  #[test]
  fn normalize_style_handles_trailing_semicolons() {
    let mut nodes = vec![elem("span", vec![("style", "a:x;b:y;")], vec![])];
    normalize_tree(&mut nodes);
    match &nodes[0] {
      CtrNode::Element { attrs, .. } => {
        assert_eq!(attrs.get("style").unwrap(), "a:x;b:y");
      }
      _ => panic!("expected Element"),
    }
  }

  #[test]
  fn normalize_class_sorts_tokens() {
    let mut nodes = vec![elem("div", vec![("class", "z-10 mt-4 flex")], vec![])];
    normalize_tree(&mut nodes);
    match &nodes[0] {
      CtrNode::Element { attrs, .. } => {
        assert_eq!(attrs.get("class").unwrap(), "flex mt-4 z-10");
      }
      _ => panic!("expected Element"),
    }
  }

  #[test]
  fn normalize_preserves_other_attrs() {
    let mut nodes = vec![elem("a", vec![("href", "/page"), ("id", "link1")], vec![])];
    normalize_tree(&mut nodes);
    match &nodes[0] {
      CtrNode::Element { attrs, .. } => {
        assert_eq!(attrs.get("href").unwrap(), "/page");
        assert_eq!(attrs.get("id").unwrap(), "link1");
      }
      _ => panic!("expected Element"),
    }
  }

  #[test]
  fn normalize_recurses_children() {
    let inner = elem("span", vec![("style", "b:y;a:x")], vec![]);
    let mut nodes = vec![elem("div", vec![], vec![inner])];
    normalize_tree(&mut nodes);
    match &nodes[0] {
      CtrNode::Element { children, .. } => match &children[0] {
        CtrNode::Element { attrs, .. } => {
          assert_eq!(attrs.get("style").unwrap(), "a:x;b:y");
        }
        _ => panic!("expected inner Element"),
      },
      _ => panic!("expected outer Element"),
    }
  }
}
