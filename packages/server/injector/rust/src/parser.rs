/* packages/server/injector/rust/src/parser.rs */

use crate::ast::{AstNode, SlotMode};
use crate::token::Token;

/// Diagnostic emitted when block directives are mismatched or unclosed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseDiagnostic {
  pub kind: DiagnosticKind,
  pub directive: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiagnosticKind {
  /// Block-close directive without a matching open (e.g. orphan `endif:x`)
  UnmatchedBlockClose,
  /// Block-open directive that reached EOF without matching close
  UnclosedBlock,
}

#[cfg(test)]
fn parse(tokens: &[Token]) -> Vec<AstNode> {
  let mut diagnostics = Vec::new();
  parse_with_diagnostics(tokens, &mut diagnostics)
}

pub(crate) fn parse_with_diagnostics(
  tokens: &[Token],
  diagnostics: &mut Vec<ParseDiagnostic>,
) -> Vec<AstNode> {
  let mut pos = 0;
  parse_until(tokens, &mut pos, &|_| false, diagnostics)
}

fn is_orphan_block_close(directive: &str) -> bool {
  directive.starts_with("endif:")
    || directive == "endmatch"
    || directive == "endeach"
    || directive == "else"
    || directive.starts_with("when:")
}

fn parse_until(
  tokens: &[Token],
  pos: &mut usize,
  stop: &dyn Fn(&str) -> bool,
  diagnostics: &mut Vec<ParseDiagnostic>,
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
          let mut closed = false;
          while *pos < tokens.len() {
            if let Token::Marker(d) = &tokens[*pos] {
              if d == "endmatch" {
                *pos += 1;
                closed = true;
                break;
              }
              if let Some(value) = d.strip_prefix("when:") {
                let value = value.to_string();
                *pos += 1;
                let body = parse_until(
                  tokens,
                  pos,
                  &|d| d.starts_with("when:") || d == "endmatch",
                  diagnostics,
                );
                branches.push((value, body));
              } else {
                // Skip unexpected tokens between match and first when
                *pos += 1;
              }
            } else {
              *pos += 1;
            }
          }
          nodes.push(AstNode::Match { path: path.clone(), branches });
          if !closed {
            diagnostics.push(ParseDiagnostic {
              kind: DiagnosticKind::UnclosedBlock,
              directive: format!("match:{path}"),
            });
          }
        } else if let Some(path) = directive.strip_prefix("if:") {
          let path = path.to_string();
          *pos += 1;
          let endif_tag = format!("endif:{path}");
          let then_nodes =
            parse_until(tokens, pos, &|d| d == "else" || d == endif_tag, diagnostics);

          let else_nodes = if *pos < tokens.len() {
            if let Token::Marker(d) = &tokens[*pos] {
              if d == "else" {
                *pos += 1;
                parse_until(tokens, pos, &|d| d == endif_tag, diagnostics)
              } else {
                Vec::new()
              }
            } else {
              Vec::new()
            }
          } else {
            Vec::new()
          };

          // Skip endif token; if absent we hit EOF
          let closed = *pos < tokens.len();
          if closed {
            *pos += 1;
          }
          nodes.push(AstNode::If { path: path.clone(), then_nodes, else_nodes });
          if !closed {
            diagnostics.push(ParseDiagnostic {
              kind: DiagnosticKind::UnclosedBlock,
              directive: format!("if:{path}"),
            });
          }
        } else if let Some(path) = directive.strip_prefix("each:") {
          let path = path.to_string();
          *pos += 1;
          let body_nodes = parse_until(tokens, pos, &|d| d == "endeach", diagnostics);
          // Skip endeach token; if absent we hit EOF
          let closed = *pos < tokens.len();
          if closed {
            *pos += 1;
          }
          nodes.push(AstNode::Each { path: path.clone(), body_nodes });
          if !closed {
            diagnostics.push(ParseDiagnostic {
              kind: DiagnosticKind::UnclosedBlock,
              directive: format!("each:{path}"),
            });
          }
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
        } else if is_orphan_block_close(directive) {
          diagnostics.push(ParseDiagnostic {
            kind: DiagnosticKind::UnmatchedBlockClose,
            directive: directive.clone(),
          });
          *pos += 1;
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

  // -- Diagnostic tests --

  #[test]
  fn orphan_endif_produces_warning() {
    let tokens = vec![
      Token::Text("before".to_string()),
      Token::Marker("endif:x".to_string()),
      Token::Text("after".to_string()),
    ];
    let mut diags = Vec::new();
    let ast = parse_with_diagnostics(&tokens, &mut diags);
    // Orphan endif should not produce a slot node
    assert_eq!(ast.len(), 2);
    assert!(matches!(&ast[0], AstNode::Text(s) if s == "before"));
    assert!(matches!(&ast[1], AstNode::Text(s) if s == "after"));
    assert_eq!(diags.len(), 1);
    assert_eq!(diags[0].kind, DiagnosticKind::UnmatchedBlockClose);
    assert_eq!(diags[0].directive, "endif:x");
  }

  #[test]
  fn unclosed_if_produces_warning() {
    let tokens = vec![Token::Marker("if:x".to_string()), Token::Text("body".to_string())];
    let mut diags = Vec::new();
    let ast = parse_with_diagnostics(&tokens, &mut diags);
    // AST still contains the If node (best-effort parse)
    assert_eq!(ast.len(), 1);
    assert!(matches!(&ast[0], AstNode::If { .. }));
    assert_eq!(diags.len(), 1);
    assert_eq!(diags[0].kind, DiagnosticKind::UnclosedBlock);
    assert_eq!(diags[0].directive, "if:x");
  }

  #[test]
  fn typo_endif_path_produces_warnings() {
    // if:show + endif:shwo -> unclosed "if:show" + orphan "endif:shwo"
    let tokens = vec![
      Token::Marker("if:show".to_string()),
      Token::Text("body".to_string()),
      Token::Marker("endif:shwo".to_string()),
    ];
    let mut diags = Vec::new();
    let ast = parse_with_diagnostics(&tokens, &mut diags);
    assert_eq!(ast.len(), 1);
    assert!(matches!(&ast[0], AstNode::If { .. }));
    // Two diagnostics: the typo'd endif is swallowed into the if body as
    // UnmatchedBlockClose, and the if itself is UnclosedBlock
    assert_eq!(diags.len(), 2);
    let kinds: Vec<_> = diags.iter().map(|d| &d.kind).collect();
    assert!(kinds.contains(&&DiagnosticKind::UnmatchedBlockClose));
    assert!(kinds.contains(&&DiagnosticKind::UnclosedBlock));
  }

  #[test]
  fn orphan_endmatch_and_endeach() {
    let tokens = vec![Token::Marker("endmatch".to_string()), Token::Marker("endeach".to_string())];
    let mut diags = Vec::new();
    let ast = parse_with_diagnostics(&tokens, &mut diags);
    assert!(ast.is_empty());
    assert_eq!(diags.len(), 2);
    assert!(diags.iter().all(|d| d.kind == DiagnosticKind::UnmatchedBlockClose));
  }

  #[test]
  fn well_formed_template_no_diagnostics() {
    let tokens = vec![
      Token::Marker("if:x".to_string()),
      Token::Text("yes".to_string()),
      Token::Marker("else".to_string()),
      Token::Text("no".to_string()),
      Token::Marker("endif:x".to_string()),
    ];
    let mut diags = Vec::new();
    parse_with_diagnostics(&tokens, &mut diags);
    assert!(diags.is_empty());
  }
}
