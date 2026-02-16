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
