/* packages/cli/core/src/build/skeleton/extract/dom.rs */

#[derive(Debug, Clone, PartialEq)]
pub(super) enum DomNode {
  Element { tag: String, attrs: String, children: Vec<DomNode>, self_closing: bool },
  Text(String),
  Comment(String),
}

/// Parse HTML (React renderToString output) into a list of DOM nodes.
pub(super) fn parse_html(html: &str) -> Vec<DomNode> {
  let bytes = html.as_bytes();
  let mut pos = 0;
  parse_nodes(bytes, &mut pos, None)
}

fn parse_nodes(bytes: &[u8], pos: &mut usize, parent_tag: Option<&str>) -> Vec<DomNode> {
  let mut nodes = Vec::new();
  while *pos < bytes.len() {
    if bytes[*pos] == b'<' {
      // Check for closing tag
      if *pos + 1 < bytes.len() && bytes[*pos + 1] == b'/' {
        if let Some(parent) = parent_tag {
          // Verify this is actually closing our parent
          let expected = format!("</{}>", parent);
          if bytes[*pos..].starts_with(expected.as_bytes()) {
            *pos += expected.len();
            return nodes;
          }
        }
        // Unexpected closing tag; consume it and return
        while *pos < bytes.len() && bytes[*pos] != b'>' {
          *pos += 1;
        }
        if *pos < bytes.len() {
          *pos += 1;
        }
        return nodes;
      }

      // Check for comment
      if bytes[*pos..].starts_with(b"<!--") {
        nodes.push(parse_comment(bytes, pos));
        continue;
      }

      // Opening tag
      nodes.push(parse_element(bytes, pos));
    } else {
      // Text node
      let start = *pos;
      while *pos < bytes.len() && bytes[*pos] != b'<' {
        *pos += 1;
      }
      let text = std::str::from_utf8(&bytes[start..*pos]).unwrap();
      if !text.is_empty() {
        nodes.push(DomNode::Text(text.to_string()));
      }
    }
  }
  nodes
}

fn parse_comment(bytes: &[u8], pos: &mut usize) -> DomNode {
  // Skip "<!--"
  *pos += 4;
  let start = *pos;
  while *pos + 2 < bytes.len() {
    if bytes[*pos] == b'-' && bytes[*pos + 1] == b'-' && bytes[*pos + 2] == b'>' {
      let content = std::str::from_utf8(&bytes[start..*pos]).unwrap();
      *pos += 3; // skip "-->"
      return DomNode::Comment(content.to_string());
    }
    *pos += 1;
  }
  // Unterminated comment: consume the rest
  let content = std::str::from_utf8(&bytes[start..bytes.len()]).unwrap();
  *pos = bytes.len();
  DomNode::Comment(content.to_string())
}

fn parse_element(bytes: &[u8], pos: &mut usize) -> DomNode {
  // Skip '<'
  *pos += 1;
  let tag_start = *pos;

  // Read tag name
  while *pos < bytes.len() && bytes[*pos] != b' ' && bytes[*pos] != b'>' && bytes[*pos] != b'/' {
    *pos += 1;
  }
  let tag = std::str::from_utf8(&bytes[tag_start..*pos]).unwrap().to_string();

  // Read attrs: everything from current pos until we find unquoted '>' or '/>'
  let attrs_start = *pos;
  let mut in_quote: Option<u8> = None;
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
          // Self-closing tag
          let attrs = std::str::from_utf8(&bytes[attrs_start..*pos]).unwrap().to_string();
          *pos += 2; // skip '/>'
          return DomNode::Element { tag, attrs, children: Vec::new(), self_closing: true };
        } else if bytes[*pos] == b'>' {
          let attrs = std::str::from_utf8(&bytes[attrs_start..*pos]).unwrap().to_string();
          *pos += 1; // skip '>'
          let children = parse_nodes(bytes, pos, Some(&tag));
          return DomNode::Element { tag, attrs, children, self_closing: false };
        } else {
          *pos += 1;
        }
      }
    }
  }

  // Unterminated tag
  let attrs = std::str::from_utf8(&bytes[attrs_start..bytes.len()]).unwrap().to_string();
  *pos = bytes.len();
  DomNode::Element { tag, attrs, children: Vec::new(), self_closing: false }
}

/// Serialize DOM nodes back to HTML. Guarantees roundtrip: serialize(&parse_html(x)) == x.
pub(super) fn serialize(nodes: &[DomNode]) -> String {
  let mut out = String::new();
  for node in nodes {
    serialize_node(node, &mut out);
  }
  out
}

fn serialize_node(node: &DomNode, out: &mut String) {
  match node {
    DomNode::Element { tag, attrs, children, self_closing } => {
      if *self_closing {
        out.push('<');
        out.push_str(tag);
        out.push_str(attrs);
        out.push_str("/>");
      } else {
        out.push('<');
        out.push_str(tag);
        out.push_str(attrs);
        out.push('>');
        for child in children {
          serialize_node(child, out);
        }
        out.push_str("</");
        out.push_str(tag);
        out.push('>');
      }
    }
    DomNode::Text(text) => out.push_str(text),
    DomNode::Comment(content) => {
      out.push_str("<!--");
      out.push_str(content);
      out.push_str("-->");
    }
  }
}

/// Deep serialization of a single node for identity comparison.
pub(super) fn fingerprint(node: &DomNode) -> String {
  serialize(std::slice::from_ref(node))
}

#[cfg(test)]
mod tests {
  use super::*;

  fn roundtrip(html: &str) {
    assert_eq!(serialize(&parse_html(html)), html, "roundtrip failed for: {html}");
  }

  #[test]
  fn roundtrip_simple_element() {
    roundtrip("<div>hello</div>");
  }

  #[test]
  fn roundtrip_nested() {
    roundtrip("<div><span>inner</span></div>");
  }

  #[test]
  fn roundtrip_self_closing() {
    roundtrip("<img/>");
    roundtrip("<br/>");
  }

  #[test]
  fn roundtrip_with_attrs() {
    roundtrip(r#"<div class="red" id="x">text</div>"#);
  }

  #[test]
  fn roundtrip_comment() {
    roundtrip("<!--seam:if:x-->");
  }

  #[test]
  fn roundtrip_mixed() {
    roundtrip(r#"<div>text<!--comment--><img/><span class="a">inner</span>tail</div>"#);
  }

  #[test]
  fn roundtrip_empty_children() {
    roundtrip("<div></div>");
    // Verify no spurious text nodes
    let nodes = parse_html("<div></div>");
    if let DomNode::Element { children, .. } = &nodes[0] {
      assert!(children.is_empty(), "expected no children, got: {children:?}");
    } else {
      panic!("expected Element");
    }
  }

  #[test]
  fn roundtrip_adjacent_elements() {
    roundtrip("<span>A</span><span>B</span>");
    // Verify no text nodes between elements
    let nodes = parse_html("<span>A</span><span>B</span>");
    assert_eq!(nodes.len(), 2, "expected 2 nodes, got: {nodes:?}");
  }

  #[test]
  fn roundtrip_seam_markers() {
    roundtrip("<div><!--seam:posts.$.name--></div>");
  }

  #[test]
  fn parse_structure() {
    let nodes = parse_html(r#"<div class="c"><span>text</span><!--note--></div>"#);
    assert_eq!(nodes.len(), 1);
    match &nodes[0] {
      DomNode::Element { tag, attrs, children, self_closing } => {
        assert_eq!(tag, "div");
        assert_eq!(attrs, r#" class="c""#);
        assert!(!self_closing);
        assert_eq!(children.len(), 2);
        match &children[0] {
          DomNode::Element { tag, children: inner, .. } => {
            assert_eq!(tag, "span");
            assert_eq!(inner.len(), 1);
            assert_eq!(inner[0], DomNode::Text("text".to_string()));
          }
          _ => panic!("expected span Element"),
        }
        assert_eq!(children[1], DomNode::Comment("note".to_string()));
      }
      _ => panic!("expected div Element"),
    }
  }

  #[test]
  fn roundtrip_attrs_with_angle_brackets() {
    // HTML entities in attributes (React escapes > to &gt; in renderToString)
    roundtrip(r#"<div data-x="a&gt;b">content</div>"#);
  }

  #[test]
  fn roundtrip_realistic_react() {
    roundtrip(
      r#"<div class="container"><h1>Title</h1><ul class="list"><li><!--seam:items.$.name--></li></ul><p>Footer</p></div>"#,
    );
  }

  // Critical roundtrip strings from the spec
  #[test]
  fn roundtrip_critical_1() {
    roundtrip("<div>Hello<span>Admin</span>World</div>");
  }

  #[test]
  fn roundtrip_critical_2() {
    roundtrip("<div><b>Welcome</b></div>");
  }

  #[test]
  fn roundtrip_critical_3() {
    roundtrip("<ul><li><!--seam:items.$.name--></li></ul>");
  }

  #[test]
  fn roundtrip_critical_4() {
    roundtrip(
      r#"<div><p class="text-green">Signed in</p><ul class="list"><li class="border-red"><!--seam:posts.$.title--><span>Published</span><span>Priority: High</span></li></ul></div>"#,
    );
  }
}
