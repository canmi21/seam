/* src/cli/skeleton/src/slot_warning.rs */

// Detect open-string slots in style/class contexts at build time.
// An open `{ "type": "string" }` in a style property or class attribute is
// almost certainly a bug — the author likely meant a constrained type (enum,
// integer, or a CSS-specific token).

use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;

fn slot_re() -> &'static Regex {
  static RE: OnceLock<Regex> = OnceLock::new();
  RE.get_or_init(|| {
    // Matches style slots: <!--seam:PATH:style:CSS_PROP-->
    // and class attr slots: <!--seam:PATH:attr:class-->
    Regex::new(r"<!--seam:([^:]+(?:\.[^:]+)*):(?:style:[\w-]+|attr:class)-->").unwrap()
  })
}

/// Resolve a dot-separated path against a JTD schema.
/// Returns the schema node at that path, or None if unresolvable.
///
/// Path segments: regular keys look up `properties`/`optionalProperties`,
/// `$` descends into `elements` (array item type).
fn resolve_path<'a>(schema: &'a Value, path: &str) -> Option<&'a Value> {
  let mut current = schema;

  for segment in path.split('.') {
    if segment == "$" {
      current = current.get("elements")?;
    } else {
      // Try properties first, then optionalProperties
      current = current
        .get("properties")
        .and_then(|p| p.get(segment))
        .or_else(|| current.get("optionalProperties").and_then(|p| p.get(segment)))?;
    }
  }

  Some(current)
}

/// True when the schema node is an unconstrained string (no enum values).
fn is_open_string(schema: &Value) -> bool {
  schema.get("type").and_then(Value::as_str) == Some("string") && schema.get("enum").is_none()
}

/// Scan a template for style/class slots backed by open-string schema fields.
/// Returns a list of human-readable warning strings.
pub fn check_slot_types(template: &str, page_schema: &Value) -> Vec<String> {
  let re = slot_re();
  let mut warnings = Vec::new();

  for cap in re.captures_iter(template) {
    let full = cap.get(0).unwrap().as_str();
    let path = &cap[1];

    let Some(field_schema) = resolve_path(page_schema, path) else {
      continue;
    };

    if !is_open_string(field_schema) {
      continue;
    }

    // Determine context label from the marker
    let context = if full.contains(":style:") {
      let prop = full.rsplit(":style:").next().unwrap().trim_end_matches("-->");
      format!("style property \"{prop}\"")
    } else {
      "class attribute".to_string()
    };

    warnings.push(format!(
      "slot \"{path}\" is an open string used as {context}\n\
       \x20\x20\x20\x20\x20\x20\x20\x20  hint: consider using an enum or numeric type in your schema"
    ));
  }

  warnings
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  fn page_schema() -> Value {
    json!({
      "properties": {
        "user": {
          "properties": {
            "name": { "type": "string" },
            "role": { "type": "string", "enum": ["admin", "member"] },
            "age": { "type": "uint32" }
          }
        },
        "repos": {
          "elements": {
            "properties": {
              "language": { "type": "string" },
              "stars": { "type": "uint32" },
              "color": { "type": "string", "enum": ["red", "blue", "green"] }
            }
          }
        }
      }
    })
  }

  #[test]
  fn warns_open_string_in_style() {
    let template = r#"<!--seam:user.name:style:font-size--><div>text</div>"#;
    let warnings = check_slot_types(template, &page_schema());
    assert_eq!(warnings.len(), 1);
    assert!(warnings[0].contains("user.name"));
    assert!(warnings[0].contains("style property \"font-size\""));
  }

  #[test]
  fn warns_open_string_in_class() {
    let template = r#"<!--seam:user.name:attr:class--><div>text</div>"#;
    let warnings = check_slot_types(template, &page_schema());
    assert_eq!(warnings.len(), 1);
    assert!(warnings[0].contains("user.name"));
    assert!(warnings[0].contains("class attribute"));
  }

  #[test]
  fn no_warning_for_enum_string() {
    let template = r#"<!--seam:user.role:attr:class--><div>text</div>"#;
    let warnings = check_slot_types(template, &page_schema());
    assert!(warnings.is_empty());
  }

  #[test]
  fn no_warning_for_numeric_type() {
    let template = r#"<!--seam:user.age:style:font-size--><div>text</div>"#;
    let warnings = check_slot_types(template, &page_schema());
    assert!(warnings.is_empty());
  }

  #[test]
  fn warns_array_element_open_string() {
    let template = r#"<!--seam:repos.$.language:attr:class--><div>text</div>"#;
    let warnings = check_slot_types(template, &page_schema());
    assert_eq!(warnings.len(), 1);
    assert!(warnings[0].contains("repos.$.language"));
  }

  #[test]
  fn no_warning_for_array_element_enum() {
    let template = r#"<!--seam:repos.$.color:attr:class--><div>text</div>"#;
    let warnings = check_slot_types(template, &page_schema());
    assert!(warnings.is_empty());
  }

  #[test]
  fn no_warning_for_text_slot() {
    // Text slots (no :style: or :attr:class) should not trigger warnings
    let template = r#"<!--seam:user.name--><div>text</div>"#;
    let warnings = check_slot_types(template, &page_schema());
    assert!(warnings.is_empty());
  }

  #[test]
  fn no_warning_for_href_attr() {
    let template = r#"<!--seam:user.name:attr:href--><a>link</a>"#;
    let warnings = check_slot_types(template, &page_schema());
    assert!(warnings.is_empty());
  }

  #[test]
  fn no_warning_without_schema() {
    let template = r#"<!--seam:user.name:style:color--><div>text</div>"#;
    let empty = json!({});
    let warnings = check_slot_types(template, &empty);
    assert!(warnings.is_empty());
  }

  #[test]
  fn multiple_warnings() {
    let template =
      r#"<!--seam:user.name:style:color--><!--seam:repos.$.language:attr:class--><div>text</div>"#;
    let warnings = check_slot_types(template, &page_schema());
    assert_eq!(warnings.len(), 2);
  }

  #[test]
  fn resolve_path_basic() {
    let schema = page_schema();
    let resolved = resolve_path(&schema, "user.name").unwrap();
    assert_eq!(resolved, &json!({ "type": "string" }));
  }

  #[test]
  fn resolve_path_array() {
    let schema = page_schema();
    let resolved = resolve_path(&schema, "repos.$.stars").unwrap();
    assert_eq!(resolved, &json!({ "type": "uint32" }));
  }

  #[test]
  fn resolve_path_missing() {
    let schema = page_schema();
    assert!(resolve_path(&schema, "nonexistent.field").is_none());
  }
}
