/* packages/server/injector/rust/src/parser.rs */

use crate::ast::{AstNode, SlotMode};
use crate::token::Token;

pub(crate) fn parse(tokens: &[Token]) -> Vec<AstNode> {
  let mut pos = 0;
  parse_until(tokens, &mut pos, &|_| false)
}

pub(crate) fn parse_until(
  tokens: &[Token],
  pos: &mut usize,
  stop: &dyn Fn(&str) -> bool,
) -> Vec<AstNode> {
  let mut nodes = Vec::new();

  while *pos < tokens.len() {
    match &tokens[*pos] {
      Token::Text(value) => {
        nodes.push(AstNode::Text(value.clone()));
        *pos += 1;
      }
      Token::Marker(directive) => {
        if stop(directive) {
          return nodes;
        }

        if let Some(path) = directive.strip_prefix("match:") {
          let path = path.to_string();
          *pos += 1;
          let mut branches: Vec<(String, Vec<AstNode>)> = Vec::new();
          while *pos < tokens.len() {
            if let Token::Marker(d) = &tokens[*pos] {
              if d == "endmatch" {
                *pos += 1;
                break;
              }
              if let Some(value) = d.strip_prefix("when:") {
                let value = value.to_string();
                *pos += 1;
                let body = parse_until(tokens, pos, &|d| d.starts_with("when:") || d == "endmatch");
                branches.push((value, body));
              } else {
                // Skip unexpected tokens between match and first when
                *pos += 1;
              }
            } else {
              *pos += 1;
            }
          }
          nodes.push(AstNode::Match { path, branches });
        } else if let Some(path) = directive.strip_prefix("if:") {
          let path = path.to_string();
          *pos += 1;
          let endif_tag = format!("endif:{path}");
          let then_nodes = parse_until(tokens, pos, &|d| d == "else" || d == endif_tag);

          let else_nodes = if *pos < tokens.len() {
            if let Token::Marker(d) = &tokens[*pos] {
              if d == "else" {
                *pos += 1;
                parse_until(tokens, pos, &|d| d == endif_tag)
              } else {
                Vec::new()
              }
            } else {
              Vec::new()
            }
          } else {
            Vec::new()
          };

          // Skip endif token
          if *pos < tokens.len() {
            *pos += 1;
          }
          nodes.push(AstNode::If { path, then_nodes, else_nodes });
        } else if let Some(path) = directive.strip_prefix("each:") {
          let path = path.to_string();
          *pos += 1;
          let body_nodes = parse_until(tokens, pos, &|d| d == "endeach");
          // Skip endeach token
          if *pos < tokens.len() {
            *pos += 1;
          }
          nodes.push(AstNode::Each { path, body_nodes });
        } else if let Some(rest) = directive.find(":style:") {
          let path = directive[..rest].to_string();
          let css_property = directive[rest + 7..].to_string();
          *pos += 1;
          nodes.push(AstNode::StyleProp { path, css_property });
        } else if let Some(rest) = directive.find(":attr:") {
          let path = directive[..rest].to_string();
          let attr_name = directive[rest + 6..].to_string();
          *pos += 1;
          nodes.push(AstNode::Attr { path, attr_name });
        } else if let Some(path) = directive.strip_suffix(":html") {
          *pos += 1;
          nodes.push(AstNode::Slot { path: path.to_string(), mode: SlotMode::Html });
        } else {
          // Plain text slot
          let path = directive.clone();
          *pos += 1;
          nodes.push(AstNode::Slot { path, mode: SlotMode::Text });
        }
      }
    }
  }

  nodes
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parse_empty_tokens() {
    let ast = parse(&[]);
    assert!(ast.is_empty());
  }

  #[test]
  fn parse_text_only() {
    let tokens = vec![Token::Text("hello".to_string())];
    let ast = parse(&tokens);
    assert_eq!(ast.len(), 1);
    assert!(matches!(&ast[0], AstNode::Text(s) if s == "hello"));
  }

  #[test]
  fn parse_if_without_endif() {
    // EOF truncated: no endif token
    let tokens = vec![Token::Marker("if:x".to_string()), Token::Text("body".to_string())];
    let ast = parse(&tokens);
    assert_eq!(ast.len(), 1);
    match &ast[0] {
      AstNode::If { path, then_nodes, else_nodes } => {
        assert_eq!(path, "x");
        assert_eq!(then_nodes.len(), 1);
        assert!(matches!(&then_nodes[0], AstNode::Text(s) if s == "body"));
        assert!(else_nodes.is_empty());
      }
      other => panic!("expected If, got {other:?}"),
    }
  }

  #[test]
  fn parse_each_without_endeach() {
    let tokens = vec![Token::Marker("each:items".to_string()), Token::Text("body".to_string())];
    let ast = parse(&tokens);
    assert_eq!(ast.len(), 1);
    match &ast[0] {
      AstNode::Each { path, body_nodes } => {
        assert_eq!(path, "items");
        assert_eq!(body_nodes.len(), 1);
        assert!(matches!(&body_nodes[0], AstNode::Text(s) if s == "body"));
      }
      other => panic!("expected Each, got {other:?}"),
    }
  }

  #[test]
  fn parse_match_without_when() {
    let tokens =
      vec![Token::Marker("match:status".to_string()), Token::Marker("endmatch".to_string())];
    let ast = parse(&tokens);
    assert_eq!(ast.len(), 1);
    match &ast[0] {
      AstNode::Match { path, branches } => {
        assert_eq!(path, "status");
        assert!(branches.is_empty());
      }
      other => panic!("expected Match, got {other:?}"),
    }
  }

  #[test]
  fn parse_match_unexpected_token() {
    // Non-when marker between match and endmatch is skipped
    let tokens = vec![
      Token::Marker("match:status".to_string()),
      Token::Marker("something_unexpected".to_string()),
      Token::Marker("when:active".to_string()),
      Token::Text("Active".to_string()),
      Token::Marker("endmatch".to_string()),
    ];
    let ast = parse(&tokens);
    assert_eq!(ast.len(), 1);
    match &ast[0] {
      AstNode::Match { path, branches } => {
        assert_eq!(path, "status");
        assert_eq!(branches.len(), 1);
        assert_eq!(branches[0].0, "active");
      }
      other => panic!("expected Match, got {other:?}"),
    }
  }

  #[test]
  fn parse_style_priority() {
    // `:style:` prefix should be matched before `:attr:`
    let tokens = vec![Token::Marker("color:style:color".to_string())];
    let ast = parse(&tokens);
    assert_eq!(ast.len(), 1);
    match &ast[0] {
      AstNode::StyleProp { path, css_property } => {
        assert_eq!(path, "color");
        assert_eq!(css_property, "color");
      }
      other => panic!("expected StyleProp, got {other:?}"),
    }
  }

  #[test]
  fn parse_empty_path_slot() {
    let tokens = vec![Token::Marker(String::new())];
    let ast = parse(&tokens);
    assert_eq!(ast.len(), 1);
    match &ast[0] {
      AstNode::Slot { path, mode } => {
        assert!(path.is_empty());
        assert!(matches!(mode, SlotMode::Text));
      }
      other => panic!("expected Slot, got {other:?}"),
    }
  }

  #[test]
  fn parse_html_suffix() {
    let tokens = vec![Token::Marker("content:html".to_string())];
    let ast = parse(&tokens);
    assert_eq!(ast.len(), 1);
    match &ast[0] {
      AstNode::Slot { path, mode } => {
        assert_eq!(path, "content");
        assert!(matches!(mode, SlotMode::Html));
      }
      other => panic!("expected Slot(Html), got {other:?}"),
    }
  }
}
