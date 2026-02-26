/* packages/server/engine/rust/src/escape.rs */

/// Escape non-ASCII characters in JSON string values to `\uXXXX` sequences.
///
/// Walks the JSON text tracking whether the current position is inside a
/// JSON string (handling `\"` and `\\` correctly). Non-ASCII codepoints
/// inside strings are replaced with their `\uXXXX` representation; chars
/// outside the BMP are encoded as surrogate pairs (`\uHHHH\uLLLL`).
pub fn ascii_escape_json(json: &str) -> String {
  let mut out = String::with_capacity(json.len());
  let mut in_string = false;
  let mut chars = json.chars().peekable();

  while let Some(ch) = chars.next() {
    if in_string {
      if ch == '\\' {
        // Escaped character inside string -- push both and skip next
        out.push(ch);
        if let Some(next) = chars.next() {
          out.push(next);
        }
        continue;
      }
      if ch == '"' {
        in_string = false;
        out.push(ch);
        continue;
      }
      if ch as u32 > 0x7F {
        // Non-ASCII inside string: encode as \uXXXX (surrogate pair if needed)
        let code = ch as u32;
        if code > 0xFFFF {
          let adjusted = code - 0x1_0000;
          let hi = (adjusted >> 10) + 0xD800;
          let lo = (adjusted & 0x3FF) + 0xDC00;
          out.push_str(&format!("\\u{hi:04x}\\u{lo:04x}"));
        } else {
          out.push_str(&format!("\\u{code:04x}"));
        }
        continue;
      }
      out.push(ch);
    } else {
      if ch == '"' {
        in_string = true;
      }
      out.push(ch);
    }
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn ascii_passthrough() {
    let input = r#"{"key":"hello"}"#;
    assert_eq!(ascii_escape_json(input), input);
  }

  #[test]
  fn escapes_cjk_in_values() {
    let input = r#"{"msg":"你好"}"#;
    let expected = r#"{"msg":"\u4f60\u597d"}"#;
    assert_eq!(ascii_escape_json(input), expected);
  }

  #[test]
  fn preserves_existing_escapes() {
    let input = r#"{"a":"line\nbreak","b":"tab\there"}"#;
    assert_eq!(ascii_escape_json(input), input);
  }

  #[test]
  fn handles_escaped_quotes() {
    let input = r#"{"a":"say \"hi\""}"#;
    assert_eq!(ascii_escape_json(input), input);
  }

  #[test]
  fn non_ascii_outside_strings_untouched() {
    // Non-ASCII outside JSON strings should not appear in valid JSON,
    // but the function should not corrupt them either.
    let input = "// comment: cafe\u{0301}";
    assert_eq!(ascii_escape_json(input), input);
  }

  #[test]
  fn surrogate_pair_for_emoji() {
    // U+1F600 (grinning face) -> \uD83D\uDE00
    let input = r#"{"emoji":"😀"}"#;
    let expected = r#"{"emoji":"\ud83d\ude00"}"#;
    assert_eq!(ascii_escape_json(input), expected);
  }

  #[test]
  fn mixed_ascii_and_non_ascii() {
    let input = r#"{"title":"GitHub 仪表盘","cta":"View"}"#;
    let expected = r#"{"title":"GitHub \u4eea\u8868\u76d8","cta":"View"}"#;
    assert_eq!(ascii_escape_json(input), expected);
  }

  #[test]
  fn empty_json() {
    assert_eq!(ascii_escape_json("{}"), "{}");
    assert_eq!(ascii_escape_json("[]"), "[]");
  }
}
