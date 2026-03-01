/* src/cli/skeleton/src/ctr_check/parse.rs */

// Semantic HTML parser for CTR equivalence checking.
// Produces a CtrNode tree with BTreeMap attrs (auto-sorted keys).
// Filters comments, data scripts, and resource hint links
// during parse so downstream stages see only semantic content.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub(super) enum CtrNode {
  Element { tag: String, attrs: BTreeMap<String, String>, children: Vec<CtrNode> },
  Text(String),
}

const VOID_ELEMENTS: &[&str] = &[
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
  "track", "wbr",
];

/// Parse HTML into a semantic CtrNode tree.
/// Comments are filtered, adjacent text nodes merged, and
/// data script + resource hint links are skipped.
pub(super) fn parse_ctr_tree(html: &str, data_id: &str) -> Vec<CtrNode> {
  let bytes = html.as_bytes();
  let mut pos = 0;
  let mut nodes = parse_nodes(bytes, &mut pos, None, data_id);
  merge_adjacent_text(&mut nodes);
  nodes
}

fn parse_nodes(
  bytes: &[u8],
  pos: &mut usize,
  parent_tag: Option<&str>,
  data_id: &str,
) -> Vec<CtrNode> {
  let mut nodes = Vec::new();
  while *pos < bytes.len() {
    if bytes[*pos] == b'<' {
      // Closing tag
      if *pos + 1 < bytes.len() && bytes[*pos + 1] == b'/' {
        if let Some(parent) = parent_tag {
          let expected = format!("</{}>", parent);
          if bytes[*pos..].starts_with(expected.as_bytes()) {
            *pos += expected.len();
            return nodes;
          }
        }
        // Unexpected closing tag; consume and return
        while *pos < bytes.len() && bytes[*pos] != b'>' {
          *pos += 1;
        }
        if *pos < bytes.len() {
          *pos += 1;
        }
        return nodes;
      }

      // Comment — parse but do not add to tree
      if bytes[*pos..].starts_with(b"<!--") {
        skip_comment(bytes, pos);
        continue;
      }

      // Element
      if let Some(node) = parse_element(bytes, pos, data_id) {
        nodes.push(node);
      }
    } else {
      // Text
      let start = *pos;
      while *pos < bytes.len() && bytes[*pos] != b'<' {
        *pos += 1;
      }
      let text = std::str::from_utf8(&bytes[start..*pos]).unwrap();
      if !text.is_empty() {
        nodes.push(CtrNode::Text(text.to_string()));
      }
    }
  }
  nodes
}

fn skip_comment(bytes: &[u8], pos: &mut usize) {
  *pos += 4; // skip "<!--"
  while *pos + 2 < bytes.len() {
    if bytes[*pos] == b'-' && bytes[*pos + 1] == b'-' && bytes[*pos + 2] == b'>' {
      *pos += 3;
      return;
    }
    *pos += 1;
  }
  *pos = bytes.len();
}

/// Parse an element, returning None if it should be filtered (script/resource hint).
fn parse_element(bytes: &[u8], pos: &mut usize, data_id: &str) -> Option<CtrNode> {
  // Skip '<'
  *pos += 1;
  let tag_start = *pos;

  // Read tag name
  while *pos < bytes.len() && bytes[*pos] != b' ' && bytes[*pos] != b'>' && bytes[*pos] != b'/' {
    *pos += 1;
  }
  let tag = std::str::from_utf8(&bytes[tag_start..*pos]).unwrap().to_lowercase();

  // Read raw attribute string (quote-aware scanning for '>' or '/>')
  let attrs_start = *pos;
  let mut in_quote: Option<u8> = None;
  let mut self_closed = false;

  loop {
    if *pos >= bytes.len() {
      break;
    }
    match in_quote {
      Some(q) => {
        if bytes[*pos] == q {
          in_quote = None;
        }
        *pos += 1;
      }
      None => {
        if bytes[*pos] == b'"' || bytes[*pos] == b'\'' {
          in_quote = Some(bytes[*pos]);
          *pos += 1;
        } else if bytes[*pos] == b'/' && *pos + 1 < bytes.len() && bytes[*pos + 1] == b'>' {
          self_closed = true;
          break;
        } else if bytes[*pos] == b'>' {
          break;
        } else {
          *pos += 1;
        }
      }
    }
  }

  let attrs_raw = std::str::from_utf8(&bytes[attrs_start..*pos]).unwrap();
  let attrs = parse_attrs(attrs_raw);

  if self_closed {
    *pos += 2; // skip '/>'
  } else if *pos < bytes.len() {
    *pos += 1; // skip '>'
  }

  let is_void = VOID_ELEMENTS.contains(&tag.as_str());

  // Parse children for non-void, non-self-closed elements
  let children = if !self_closed && !is_void {
    let mut kids = parse_nodes(bytes, pos, Some(&tag), data_id);
    merge_adjacent_text(&mut kids);
    kids
  } else {
    Vec::new()
  };

  // Filter: data script
  if tag == "script" && attrs.get("id").is_some_and(|v| v == data_id) {
    return None;
  }

  // Filter: resource hint links
  if tag == "link" {
    if attrs.contains_key("data-precedence") {
      return None;
    }
    if let Some(rel) = attrs.get("rel") {
      let rel_lower = rel.to_lowercase();
      if rel_lower == "preload" || rel_lower == "dns-prefetch" || rel_lower == "preconnect" {
        return None;
      }
    }
  }

  // Recurse merge into children (already done above, but if void/self-closed it's empty)
  if !children.is_empty() {
    // Already merged above
  }

  Some(CtrNode::Element { tag, attrs, children })
}

/// Parse raw attribute string into BTreeMap.
/// Handles key="value", key='value', and bare boolean attrs.
fn parse_attrs(raw: &str) -> BTreeMap<String, String> {
  let mut map = BTreeMap::new();
  let bytes = raw.as_bytes();
  let mut i = 0;

  while i < bytes.len() {
    // Skip whitespace
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
      i += 1;
    }
    if i >= bytes.len() {
      break;
    }

    // Read key
    let key_start = i;
    while i < bytes.len()
      && bytes[i] != b'='
      && !bytes[i].is_ascii_whitespace()
      && bytes[i] != b'>'
      && bytes[i] != b'/'
    {
      i += 1;
    }
    if i == key_start {
      break;
    }
    let key = std::str::from_utf8(&bytes[key_start..i]).unwrap().to_string();

    // Check for '='
    if i < bytes.len() && bytes[i] == b'=' {
      i += 1; // skip '='
      if i < bytes.len() && (bytes[i] == b'"' || bytes[i] == b'\'') {
        let quote = bytes[i];
        i += 1; // skip opening quote
        let val_start = i;
        while i < bytes.len() && bytes[i] != quote {
          i += 1;
        }
        let value = std::str::from_utf8(&bytes[val_start..i]).unwrap().to_string();
        if i < bytes.len() {
          i += 1; // skip closing quote
        }
        map.insert(key, value);
      } else {
        // Unquoted value (rare in renderToString output)
        let val_start = i;
        while i < bytes.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'>' {
          i += 1;
        }
        let value = std::str::from_utf8(&bytes[val_start..i]).unwrap().to_string();
        map.insert(key, value);
      }
    } else {
      // Bare boolean attribute
      map.insert(key, String::new());
    }
  }

  map
}

/// Merge adjacent Text nodes in a children list.
/// Needed after comment filtering: "by " + [comment] + "Alice" -> "by Alice".
fn merge_adjacent_text(nodes: &mut Vec<CtrNode>) {
  let mut i = 0;
  while i + 1 < nodes.len() {
    if let (CtrNode::Text(_), CtrNode::Text(_)) = (&nodes[i], &nodes[i + 1]) {
      let next = nodes.remove(i + 1);
      if let CtrNode::Text(ref mut a) = nodes[i]
        && let CtrNode::Text(b) = next
      {
        a.push_str(&b);
      }
      // Don't increment i — check if the merged node can merge with the next
    } else {
      i += 1;
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn tree(html: &str) -> Vec<CtrNode> {
    parse_ctr_tree(html, "__data")
  }

  #[test]
  fn parse_simple_element() {
    let nodes = tree(r#"<div class="red">hello</div>"#);
    assert_eq!(nodes.len(), 1);
    match &nodes[0] {
      CtrNode::Element { tag, attrs, children } => {
        assert_eq!(tag, "div");
        assert_eq!(attrs.get("class").unwrap(), "red");
        assert_eq!(children.len(), 1);
        assert_eq!(children[0], CtrNode::Text("hello".to_string()));
      }
      _ => panic!("expected Element"),
    }
  }

  #[test]
  fn parse_multiple_attrs_sorted() {
    let nodes = tree(r#"<img src="x.png" alt="photo" class="thumb"/>"#);
    match &nodes[0] {
      CtrNode::Element { attrs, .. } => {
        let keys: Vec<&String> = attrs.keys().collect();
        assert_eq!(keys, vec!["alt", "class", "src"]);
      }
      _ => panic!("expected Element"),
    }
  }

  #[test]
  fn parse_filters_comments() {
    let nodes = tree("<!--$--><div>ok</div><!--/$-->");
    assert_eq!(nodes.len(), 1);
    match &nodes[0] {
      CtrNode::Element { tag, .. } => assert_eq!(tag, "div"),
      _ => panic!("expected Element"),
    }
  }

  #[test]
  fn parse_filters_data_script() {
    let nodes = tree(r#"<p>hello</p><script id="__data" type="application/json">{"x":1}</script>"#);
    assert_eq!(nodes.len(), 1);
    match &nodes[0] {
      CtrNode::Element { tag, .. } => assert_eq!(tag, "p"),
      _ => panic!("expected Element"),
    }
  }

  #[test]
  fn parse_filters_resource_hints() {
    let nodes = tree(
      r#"<link rel="preload" as="image" href="x.png"><link rel="canonical" href="/page"><div>ok</div>"#,
    );
    // preload filtered, canonical preserved
    assert_eq!(nodes.len(), 2);
    match &nodes[0] {
      CtrNode::Element { tag, attrs, .. } => {
        assert_eq!(tag, "link");
        assert_eq!(attrs.get("rel").unwrap(), "canonical");
      }
      _ => panic!("expected link Element"),
    }
  }

  #[test]
  fn parse_merges_adjacent_text() {
    // Comment between text nodes gets filtered, texts merge
    let nodes = tree("<p>by <!-- -->Alice</p>");
    match &nodes[0] {
      CtrNode::Element { children, .. } => {
        assert_eq!(children.len(), 1);
        assert_eq!(children[0], CtrNode::Text("by Alice".to_string()));
      }
      _ => panic!("expected Element"),
    }
  }

  #[test]
  fn parse_void_elements() {
    let nodes = tree(r#"<br><img src="x"><input type="text"/>"#);
    assert_eq!(nodes.len(), 3);
    for node in &nodes {
      match node {
        CtrNode::Element { children, .. } => assert!(children.is_empty()),
        _ => panic!("expected Element"),
      }
    }
  }

  #[test]
  fn parse_bare_boolean_attr() {
    let nodes = tree("<input disabled/>");
    match &nodes[0] {
      CtrNode::Element { attrs, .. } => {
        assert_eq!(attrs.get("disabled").unwrap(), "");
      }
      _ => panic!("expected Element"),
    }
  }

  #[test]
  fn parse_quoted_attr_with_angle_bracket() {
    let nodes = tree(r#"<div data-x="a>b">ok</div>"#);
    match &nodes[0] {
      CtrNode::Element { attrs, children, .. } => {
        assert_eq!(attrs.get("data-x").unwrap(), "a>b");
        assert_eq!(children.len(), 1);
      }
      _ => panic!("expected Element"),
    }
  }
}
