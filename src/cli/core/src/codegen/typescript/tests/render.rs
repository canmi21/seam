/* src/cli/core/src/codegen/typescript/tests/render.rs */

use serde_json::json;

use super::super::render::{render_top_level, render_type, to_pascal_case};

#[test]
fn primitive_string() {
  let schema = json!({ "type": "string" });
  assert_eq!(render_type(&schema).unwrap(), "string");
}

#[test]
fn primitive_boolean() {
  let schema = json!({ "type": "boolean" });
  assert_eq!(render_type(&schema).unwrap(), "boolean");
}

#[test]
fn primitive_numbers() {
  for t in &["int8", "int16", "int32", "uint8", "uint16", "uint32", "float32", "float64"] {
    let schema = json!({ "type": t });
    assert_eq!(render_type(&schema).unwrap(), "number", "failed for {t}");
  }
}

#[test]
fn primitive_timestamp() {
  let schema = json!({ "type": "timestamp" });
  assert_eq!(render_type(&schema).unwrap(), "string");
}

#[test]
fn properties_required_and_optional() {
  let schema = json!({
      "properties": {
          "name": { "type": "string" },
          "age": { "type": "int32" }
      },
      "optionalProperties": {
          "email": { "type": "string" }
      }
  });
  let ts = render_type(&schema).unwrap();
  assert_eq!(ts, "{ age: number; name: string; email?: string }");
}

#[test]
fn elements() {
  let schema = json!({ "elements": { "type": "string" } });
  assert_eq!(render_type(&schema).unwrap(), "Array<string>");
}

#[test]
fn values_form() {
  let schema = json!({ "values": { "type": "float64" } });
  assert_eq!(render_type(&schema).unwrap(), "Record<string, number>");
}

#[test]
fn enum_form() {
  let schema = json!({ "enum": ["PENDING", "ACTIVE", "DISABLED"] });
  assert_eq!(render_type(&schema).unwrap(), "\"PENDING\" | \"ACTIVE\" | \"DISABLED\"");
}

#[test]
fn discriminator_form() {
  let schema = json!({
      "discriminator": "type",
      "mapping": {
          "email": {
              "properties": { "address": { "type": "string" } }
          },
          "sms": {
              "properties": { "phone": { "type": "string" } }
          }
      }
  });
  let ts = render_type(&schema).unwrap();
  assert_eq!(
    ts,
    "({ type: \"email\" } & { address: string }) | ({ type: \"sms\" } & { phone: string })"
  );
}

#[test]
fn nullable_primitive() {
  let schema = json!({ "type": "string", "nullable": true });
  assert_eq!(render_type(&schema).unwrap(), "string | null");
}

#[test]
fn nullable_elements() {
  let schema = json!({ "elements": { "type": "int32" }, "nullable": true });
  assert_eq!(render_type(&schema).unwrap(), "Array<number> | null");
}

#[test]
fn empty_schema() {
  let schema = json!({});
  assert_eq!(render_type(&schema).unwrap(), "unknown");
}

#[test]
fn nested_properties() {
  let schema = json!({
      "properties": {
          "user": {
              "properties": {
                  "name": { "type": "string" },
                  "id": { "type": "uint32" }
              }
          }
      }
  });
  let ts = render_type(&schema).unwrap();
  assert_eq!(ts, "{ user: { id: number; name: string } }");
}

#[test]
fn top_level_properties_uses_interface() {
  let ts = render_top_level(
    "GreetInput",
    &json!({
        "properties": { "name": { "type": "string" } }
    }),
  )
  .unwrap();
  assert!(ts.starts_with("export interface GreetInput {"));
}

#[test]
fn top_level_non_properties_uses_type_alias() {
  let ts = render_top_level(
    "ListUsersOutput",
    &json!({
        "elements": {
            "properties": {
                "id": { "type": "uint32" },
                "name": { "type": "string" }
            }
        }
    }),
  )
  .unwrap();
  assert!(ts.starts_with("export type ListUsersOutput = Array<"));
}

#[test]
fn empty_properties_uses_type_alias() {
  let ts = render_top_level("EmptyInput", &json!({"properties": {}})).unwrap();
  assert_eq!(ts, "export type EmptyInput = Record<string, never>;\n");
}

#[test]
fn empty_optional_properties_uses_type_alias() {
  let ts = render_top_level("EmptyInput", &json!({"optionalProperties": {}})).unwrap();
  assert_eq!(ts, "export type EmptyInput = Record<string, never>;\n");
}

#[test]
fn to_pascal_case_simple() {
  assert_eq!(to_pascal_case("greet"), "Greet");
}

#[test]
fn to_pascal_case_dotted() {
  assert_eq!(to_pascal_case("user.getProfile"), "UserGetProfile");
}

#[test]
fn to_pascal_case_multi_dot() {
  assert_eq!(to_pascal_case("a.b.c"), "ABC");
}
