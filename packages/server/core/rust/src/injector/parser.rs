/* packages/server/core/rust/src/injector/parser.rs */

use super::ast::{AstNode, SlotMode};
use super::token::Token;

pub(super) fn parse(tokens: &[Token]) -> Vec<AstNode> {
  let mut pos = 0;
  parse_until(tokens, &mut pos, &|_| false)
}

pub(super) fn parse_until(
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
