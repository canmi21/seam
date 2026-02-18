/* packages/server/core/rust/src/injector/token.rs */

#[derive(Debug)]
pub(super) enum Token {
  Text(String),
  Marker(String), // directive body (between <!--seam: and -->)
}

pub(super) const MARKER_OPEN: &str = "<!--seam:";
pub(super) const MARKER_CLOSE: &str = "-->";

pub(super) fn tokenize(template: &str) -> Vec<Token> {
  let mut tokens = Vec::new();
  let mut pos = 0;
  let bytes = template.as_bytes();

  while pos < bytes.len() {
    if let Some(rel) = template[pos..].find(MARKER_OPEN) {
      let marker_start = pos + rel;
      if marker_start > pos {
        tokens.push(Token::Text(template[pos..marker_start].to_string()));
      }
      let after_open = marker_start + MARKER_OPEN.len();
      if let Some(close_rel) = template[after_open..].find(MARKER_CLOSE) {
        let directive = template[after_open..after_open + close_rel].to_string();
        tokens.push(Token::Marker(directive));
        pos = after_open + close_rel + MARKER_CLOSE.len();
      } else {
        // Unclosed marker -- treat rest as text
        tokens.push(Token::Text(template[marker_start..].to_string()));
        break;
      }
    } else {
      tokens.push(Token::Text(template[pos..].to_string()));
      break;
    }
  }

  tokens
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn tokenize_empty_template() {
    let tokens = tokenize("");
    assert!(tokens.is_empty());
  }

  #[test]
  fn tokenize_plain_html() {
    let tokens = tokenize("<p>hello</p>");
    assert_eq!(tokens.len(), 1);
    assert!(matches!(&tokens[0], Token::Text(s) if s == "<p>hello</p>"));
  }

  #[test]
  fn tokenize_single_marker() {
    let tokens = tokenize("<!--seam:x-->");
    assert_eq!(tokens.len(), 1);
    assert!(matches!(&tokens[0], Token::Marker(s) if s == "x"));
  }

  #[test]
  fn tokenize_marker_at_start() {
    let tokens = tokenize("<!--seam:x-->tail");
    assert_eq!(tokens.len(), 2);
    assert!(matches!(&tokens[0], Token::Marker(s) if s == "x"));
    assert!(matches!(&tokens[1], Token::Text(s) if s == "tail"));
  }

  #[test]
  fn tokenize_marker_at_end() {
    let tokens = tokenize("head<!--seam:x-->");
    assert_eq!(tokens.len(), 2);
    assert!(matches!(&tokens[0], Token::Text(s) if s == "head"));
    assert!(matches!(&tokens[1], Token::Marker(s) if s == "x"));
  }

  #[test]
  fn tokenize_adjacent_markers() {
    let tokens = tokenize("<!--seam:a--><!--seam:b-->");
    assert_eq!(tokens.len(), 2);
    assert!(matches!(&tokens[0], Token::Marker(s) if s == "a"));
    assert!(matches!(&tokens[1], Token::Marker(s) if s == "b"));
  }

  #[test]
  fn tokenize_unclosed_marker() {
    let tokens = tokenize("<!--seam:x");
    assert_eq!(tokens.len(), 1);
    assert!(matches!(&tokens[0], Token::Text(s) if s == "<!--seam:x"));
  }

  #[test]
  fn tokenize_empty_directive() {
    let tokens = tokenize("<!--seam:-->");
    assert_eq!(tokens.len(), 1);
    assert!(matches!(&tokens[0], Token::Marker(s) if s.is_empty()));
  }
}
