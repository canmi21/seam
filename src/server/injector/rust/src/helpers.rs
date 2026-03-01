/* src/server/injector/rust/src/helpers.rs */

use serde_json::Value;

pub(crate) fn resolve<'a>(path: &str, data: &'a Value) -> Option<&'a Value> {
  let mut current = data;
  for key in path.split('.') {
    current = current.get(key)?;
  }
  Some(current)
}

pub(crate) fn is_truthy(value: &Value) -> bool {
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

pub(crate) fn stringify(value: &Value) -> String {
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

pub(crate) fn is_html_boolean_attr(name: &str) -> bool {
  HTML_BOOLEAN_ATTRS.contains(&name)
}

const CSS_UNITLESS_PROPERTIES: &[&str] = &[
  "animation-iteration-count",
  "border-image-outset",
  "border-image-slice",
  "border-image-width",
  "box-flex",
  "box-flex-group",
  "box-ordinal-group",
  "column-count",
  "columns",
  "flex",
  "flex-grow",
  "flex-positive",
  "flex-shrink",
  "flex-negative",
  "flex-order",
  "font-weight",
  "grid-area",
  "grid-column",
  "grid-column-end",
  "grid-column-span",
  "grid-column-start",
  "grid-row",
  "grid-row-end",
  "grid-row-span",
  "grid-row-start",
  "line-clamp",
  "line-height",
  "opacity",
  "order",
  "orphans",
  "tab-size",
  "widows",
  "z-index",
  "zoom",
  "fill-opacity",
  "flood-opacity",
  "stop-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
];

pub(crate) fn format_style_value(css_property: &str, value: &Value) -> Option<String> {
  match value {
    Value::Null => None,
    Value::Bool(false) => None,
    Value::Number(n) => {
      if let Some(i) = n.as_i64() {
        if i == 0 {
          Some("0".to_string())
        } else if CSS_UNITLESS_PROPERTIES.contains(&css_property) {
          Some(i.to_string())
        } else {
          Some(format!("{i}px"))
        }
      } else if let Some(f) = n.as_f64() {
        if f == 0.0 {
          Some("0".to_string())
        } else if CSS_UNITLESS_PROPERTIES.contains(&css_property) {
          // Avoid trailing .0 for whole numbers
          if f.fract() == 0.0 {
            Some(format!("{}", f as i64))
          } else {
            Some(f.to_string())
          }
        } else if f.fract() == 0.0 {
          Some(format!("{}px", f as i64))
        } else {
          Some(format!("{f}px"))
        }
      } else {
        None
      }
    }
    Value::String(s) => {
      if s.is_empty() {
        None
      } else {
        Some(s.clone())
      }
    }
    _ => None,
  }
}

pub(crate) fn escape_html(s: &str) -> String {
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

  // -- format_style_value --

  #[test]
  fn format_style_value_number_with_px() {
    assert_eq!(format_style_value("margin-top", &json!(16)), Some("16px".to_string()));
  }

  #[test]
  fn format_style_value_zero() {
    assert_eq!(format_style_value("margin-top", &json!(0)), Some("0".to_string()));
  }

  #[test]
  fn format_style_value_unitless() {
    assert_eq!(format_style_value("opacity", &json!(0.5)), Some("0.5".to_string()));
    assert_eq!(format_style_value("z-index", &json!(10)), Some("10".to_string()));
    assert_eq!(format_style_value("font-weight", &json!(700)), Some("700".to_string()));
  }

  #[test]
  fn format_style_value_string() {
    assert_eq!(format_style_value("color", &json!("red")), Some("red".to_string()));
  }

  #[test]
  fn format_style_value_null_skipped() {
    assert_eq!(format_style_value("margin-top", &json!(null)), None);
  }

  #[test]
  fn format_style_value_false_skipped() {
    assert_eq!(format_style_value("margin-top", &json!(false)), None);
  }

  #[test]
  fn truthy_empty_object() {
    assert!(is_truthy(&json!({})));
  }

  #[test]
  fn stringify_array() {
    let result = stringify(&json!([1, 2]));
    assert_eq!(result, "[1,2]");
  }

  #[test]
  fn stringify_object() {
    let result = stringify(&json!({"a": 1}));
    assert_eq!(result, r#"{"a":1}"#);
  }

  #[test]
  fn format_style_value_float_px() {
    assert_eq!(format_style_value("width", &json!(1.5)), Some("1.5px".to_string()));
  }

  #[test]
  fn format_style_value_integer_float_px() {
    assert_eq!(format_style_value("width", &json!(16.0)), Some("16px".to_string()));
  }

  #[test]
  fn format_style_value_zero_float() {
    assert_eq!(format_style_value("width", &json!(0.0)), Some("0".to_string()));
  }

  #[test]
  fn format_style_value_empty_string() {
    assert_eq!(format_style_value("width", &json!("")), None);
  }

  #[test]
  fn format_style_value_bool_true() {
    // true is not false, so it falls through to the _ => None arm
    assert_eq!(format_style_value("width", &json!(true)), None);
  }

  #[test]
  fn resolve_dollar_path() {
    // Simulates $ scope inside each loop
    let data = json!({"$": {"name": "Alice"}});
    assert_eq!(resolve("$.name", &data), Some(&json!("Alice")));
  }

  #[test]
  fn resolve_double_dollar_path() {
    // Simulates $$ scope in nested each loop
    let data = json!({"$$": {"title": "Group1"}, "$": {"label": "Item"}});
    assert_eq!(resolve("$$.title", &data), Some(&json!("Group1")));
  }
}
