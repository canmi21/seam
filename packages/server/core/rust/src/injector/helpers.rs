/* packages/server/core/rust/src/injector/helpers.rs */

use serde_json::Value;

pub(super) fn resolve<'a>(path: &str, data: &'a Value) -> Option<&'a Value> {
  let mut current = data;
  for key in path.split('.') {
    current = current.get(key)?;
  }
  Some(current)
}

pub(super) fn is_truthy(value: &Value) -> bool {
  match value {
    Value::Null => false,
    Value::Bool(b) => *b,
    Value::Number(n) => {
      if let Some(i) = n.as_i64() {
        i != 0
      } else if let Some(f) = n.as_f64() {
        f != 0.0
      } else {
        true
      }
    }
    Value::String(s) => !s.is_empty(),
    Value::Array(arr) => !arr.is_empty(),
    Value::Object(_) => true,
  }
}

pub(super) fn stringify(value: &Value) -> String {
  match value {
    Value::Null => String::new(),
    Value::Bool(b) => b.to_string(),
    Value::Number(n) => n.to_string(),
    Value::String(s) => s.clone(),
    other => other.to_string(),
  }
}

// HTML boolean attributes: present means true, absent means false.
// When value is truthy, render as `attr=""`. When falsy, omit entirely.
const HTML_BOOLEAN_ATTRS: &[&str] = &[
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "readonly",
  "required",
  "reversed",
  "selected",
];

pub(super) fn is_html_boolean_attr(name: &str) -> bool {
  HTML_BOOLEAN_ATTRS.contains(&name)
}

pub(super) fn escape_html(s: &str) -> String {
  let mut out = String::with_capacity(s.len());
  for ch in s.chars() {
    match ch {
      '&' => out.push_str("&amp;"),
      '<' => out.push_str("&lt;"),
      '>' => out.push_str("&gt;"),
      '"' => out.push_str("&quot;"),
      '\'' => out.push_str("&#x27;"),
      c => out.push(c),
    }
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  // -- resolve --

  #[test]
  fn resolve_simple_key() {
    let data = json!({"name": "Alice"});
    assert_eq!(resolve("name", &data), Some(&json!("Alice")));
  }

  #[test]
  fn resolve_nested_path() {
    let data = json!({"a": {"b": {"c": 42}}});
    assert_eq!(resolve("a.b.c", &data), Some(&json!(42)));
  }

  #[test]
  fn resolve_missing_key() {
    assert_eq!(resolve("missing", &json!({})), None);
  }

  #[test]
  fn resolve_partial_path() {
    let data = json!({"a": 1});
    assert_eq!(resolve("a.b", &data), None);
  }

  #[test]
  fn resolve_null_intermediate() {
    let data = json!({"a": null});
    assert_eq!(resolve("a.b", &data), None);
  }

  // -- is_truthy --

  #[test]
  fn truthy_values() {
    assert!(is_truthy(&json!(true)));
    assert!(is_truthy(&json!(1)));
    assert!(is_truthy(&json!(-1)));
    assert!(is_truthy(&json!(0.5)));
    assert!(is_truthy(&json!("hello")));
    assert!(is_truthy(&json!([1])));
    assert!(is_truthy(&json!({"k": "v"})));
  }

  #[test]
  fn falsy_values() {
    assert!(!is_truthy(&json!(false)));
    assert!(!is_truthy(&json!(null)));
    assert!(!is_truthy(&json!(0)));
    assert!(!is_truthy(&json!("")));
    assert!(!is_truthy(&json!([])));
  }

  // -- stringify --

  #[test]
  fn stringify_null() {
    assert_eq!(stringify(&json!(null)), "");
  }

  #[test]
  fn stringify_number() {
    assert_eq!(stringify(&json!(42)), "42");
  }

  #[test]
  fn stringify_string() {
    assert_eq!(stringify(&json!("hello")), "hello");
  }

  #[test]
  fn stringify_bool() {
    assert_eq!(stringify(&json!(true)), "true");
    assert_eq!(stringify(&json!(false)), "false");
  }

  // -- escape_html --

  #[test]
  fn escape_html_special_chars() {
    assert_eq!(escape_html("<>&\"'"), "&lt;&gt;&amp;&quot;&#x27;");
  }

  #[test]
  fn escape_html_safe_string() {
    assert_eq!(escape_html("hello world"), "hello world");
  }

  #[test]
  fn escape_html_empty() {
    assert_eq!(escape_html(""), "");
  }
}
