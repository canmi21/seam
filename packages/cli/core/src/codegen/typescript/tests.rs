/* packages/cli/core/src/codegen/typescript/tests.rs */

use std::collections::BTreeMap;

use serde_json::json;

use super::render::{render_top_level, render_type, to_pascal_case};
use super::*;
use crate::manifest::ProcedureType;

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
fn full_manifest_render() {
  let manifest = crate::manifest::Manifest {
    version: 1,
    procedures: {
      let mut m = BTreeMap::new();
      m.insert(
        "greet".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Query,
          input: json!({
              "properties": { "name": { "type": "string" } }
          }),
          output: json!({
              "properties": { "message": { "type": "string" } }
          }),
          error: None,
        },
      );
      m
    },
    channels: BTreeMap::new(),
  };

  let code = generate_typescript(&manifest, None, "__SEAM_DATA__").unwrap();
  assert!(code.contains("export interface GreetInput {"));
  assert!(code.contains("  name: string;"));
  assert!(code.contains("export interface GreetOutput {"));
  assert!(code.contains("  message: string;"));
  assert!(code.contains("greet(input: GreetInput): Promise<GreetOutput>;"));
  assert!(
    code.contains("greet: (input) => client.query(\"greet\", input) as Promise<GreetOutput>,")
  );
  assert!(code.contains("export interface SeamProcedureMeta {"));
  assert!(code.contains("greet: { kind: \"query\"; input: GreetInput; output: GreetOutput };"));
}

#[test]
fn subscription_codegen() {
  let manifest = crate::manifest::Manifest {
    version: 1,
    procedures: {
      let mut m = BTreeMap::new();
      m.insert(
        "onCount".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Subscription,
          input: json!({
              "properties": { "max": { "type": "int32" } }
          }),
          output: json!({
              "properties": { "n": { "type": "int32" } }
          }),
          error: None,
        },
      );
      m
    },
    channels: BTreeMap::new(),
  };

  let code = generate_typescript(&manifest, None, "__SEAM_DATA__").unwrap();
  assert!(code.contains("export interface OnCountInput {"));
  assert!(code.contains("export interface OnCountOutput {"));
  assert!(code.contains(
    "onCount(input: OnCountInput, onData: (data: OnCountOutput) => void, onError?: (err: SeamClientError) => void): Unsubscribe;"
  ));
  assert!(code.contains("client.subscribe(\"onCount\""));
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
fn full_manifest_render_with_hashes() {
  use crate::build::rpc_hash::RpcHashMap;

  let manifest = crate::manifest::Manifest {
    version: 1,
    procedures: {
      let mut m = BTreeMap::new();
      m.insert(
        "greet".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Query,
          input: json!({
              "properties": { "name": { "type": "string" } }
          }),
          output: json!({
              "properties": { "message": { "type": "string" } }
          }),
          error: None,
        },
      );
      m
    },
    channels: BTreeMap::new(),
  };
  let hash_map = RpcHashMap {
    salt: "test_salt".to_string(),
    batch: "b1c2d3e4".to_string(),
    procedures: {
      let mut m = BTreeMap::new();
      m.insert("greet".to_string(), "a1b2c3d4".to_string());
      m
    },
  };
  let code = generate_typescript(&manifest, Some(&hash_map), "__SEAM_DATA__").unwrap();
  assert!(!code.contains("configureRpcMap"));
  assert!(!code.contains("RPC_HASH_MAP"));
  assert!(code.contains("\"a1b2c3d4\""));
  assert!(code.contains("batchEndpoint: \"b1c2d3e4\""));
  assert!(code.contains("client.query(\"a1b2c3d4\""));
  // Interface still uses original names
  assert!(code.contains("greet(input: GreetInput): Promise<GreetOutput>;"));
}

#[test]
fn codegen_without_hashes_unchanged() {
  let manifest = crate::manifest::Manifest {
    version: 1,
    procedures: {
      let mut m = BTreeMap::new();
      m.insert(
        "greet".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Query,
          input: json!({
              "properties": { "name": { "type": "string" } }
          }),
          output: json!({
              "properties": { "message": { "type": "string" } }
          }),
          error: None,
        },
      );
      m
    },
    channels: BTreeMap::new(),
  };
  let code = generate_typescript(&manifest, None, "__SEAM_DATA__").unwrap();
  assert!(code.contains("client.query(\"greet\""));
  assert!(!code.contains("configureRpcMap"));
  assert!(!code.contains("batchEndpoint"));
}

#[test]
fn subscription_codegen_with_hashes() {
  use crate::build::rpc_hash::RpcHashMap;

  let manifest = crate::manifest::Manifest {
    version: 1,
    procedures: {
      let mut m = BTreeMap::new();
      m.insert(
        "onCount".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Subscription,
          input: json!({
              "properties": { "max": { "type": "int32" } }
          }),
          output: json!({
              "properties": { "n": { "type": "int32" } }
          }),
          error: None,
        },
      );
      m
    },
    channels: BTreeMap::new(),
  };
  let hash_map = RpcHashMap {
    salt: "test_salt".to_string(),
    batch: "deadbeef".to_string(),
    procedures: {
      let mut m = BTreeMap::new();
      m.insert("onCount".to_string(), "cafe1234".to_string());
      m
    },
  };
  let code = generate_typescript(&manifest, Some(&hash_map), "__SEAM_DATA__").unwrap();
  assert!(code.contains("client.subscribe(\"cafe1234\""));
  // Interface still uses original name
  assert!(code.contains("onCount(input: OnCountInput"));
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
fn data_id_export_default() {
  let manifest = crate::manifest::Manifest {
    version: 1,
    procedures: BTreeMap::new(),
    channels: BTreeMap::new(),
  };
  let code = generate_typescript(&manifest, None, "__SEAM_DATA__").unwrap();
  assert!(code.contains("export const DATA_ID = \"__SEAM_DATA__\";"));
}

#[test]
fn data_id_export_custom() {
  let manifest = crate::manifest::Manifest {
    version: 1,
    procedures: BTreeMap::new(),
    channels: BTreeMap::new(),
  };
  let code = generate_typescript(&manifest, None, "__sd").unwrap();
  assert!(code.contains("export const DATA_ID = \"__sd\";"));
}

#[test]
fn command_codegen() {
  let manifest = crate::manifest::Manifest {
    version: 1,
    procedures: {
      let mut m = BTreeMap::new();
      m.insert(
        "deleteUser".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Command,
          input: json!({
              "properties": { "userId": { "type": "string" } }
          }),
          output: json!({
              "properties": { "success": { "type": "boolean" } }
          }),
          error: None,
        },
      );
      m
    },
    channels: BTreeMap::new(),
  };

  let code = generate_typescript(&manifest, None, "__SEAM_DATA__").unwrap();
  assert!(code.contains("client.command(\"deleteUser\""));
  assert!(code.contains(
    "deleteUser: { kind: \"command\"; input: DeleteUserInput; output: DeleteUserOutput };"
  ));
}

#[test]
fn error_schema_codegen() {
  let manifest = crate::manifest::Manifest {
    version: 1,
    procedures: {
      let mut m = BTreeMap::new();
      m.insert(
        "deleteUser".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Command,
          input: json!({
              "properties": { "userId": { "type": "string" } }
          }),
          output: json!({
              "properties": { "success": { "type": "boolean" } }
          }),
          error: Some(json!({
              "properties": { "reason": { "type": "string" } }
          })),
        },
      );
      m
    },
    channels: BTreeMap::new(),
  };

  let code = generate_typescript(&manifest, None, "__SEAM_DATA__").unwrap();
  assert!(code.contains("export interface DeleteUserError {"));
  assert!(code.contains("  reason: string;"));
  assert!(code.contains(
    "deleteUser: { kind: \"command\"; input: DeleteUserInput; output: DeleteUserOutput; error: DeleteUserError };"
  ));
}

#[test]
fn error_schema_absent_no_error_type() {
  let manifest = crate::manifest::Manifest {
    version: 1,
    procedures: {
      let mut m = BTreeMap::new();
      m.insert(
        "greet".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Query,
          input: json!({
              "properties": { "name": { "type": "string" } }
          }),
          output: json!({
              "properties": { "message": { "type": "string" } }
          }),
          error: None,
        },
      );
      m
    },
    channels: BTreeMap::new(),
  };

  let code = generate_typescript(&manifest, None, "__SEAM_DATA__").unwrap();
  assert!(!code.contains("GreetError"));
  assert!(!code.contains("error:"));
}

#[test]
fn command_with_hashes() {
  use crate::build::rpc_hash::RpcHashMap;

  let manifest = crate::manifest::Manifest {
    version: 1,
    procedures: {
      let mut m = BTreeMap::new();
      m.insert(
        "deleteUser".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Command,
          input: json!({
              "properties": { "userId": { "type": "string" } }
          }),
          output: json!({
              "properties": { "success": { "type": "boolean" } }
          }),
          error: None,
        },
      );
      m
    },
    channels: BTreeMap::new(),
  };
  let hash_map = RpcHashMap {
    salt: "test_salt".to_string(),
    batch: "b1c2d3e4".to_string(),
    procedures: {
      let mut m = BTreeMap::new();
      m.insert("deleteUser".to_string(), "dead1234".to_string());
      m
    },
  };
  let code = generate_typescript(&manifest, Some(&hash_map), "__SEAM_DATA__").unwrap();
  assert!(code.contains("client.command(\"dead1234\""));
  assert!(code.contains("deleteUser(input: DeleteUserInput): Promise<DeleteUserOutput>;"));
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

#[test]
fn channel_procedure_meta_uses_channel_types() {
  use crate::manifest::{ChannelSchema, IncomingSchema};

  let manifest = crate::manifest::Manifest {
    version: 1,
    procedures: {
      let mut m = BTreeMap::new();
      m.insert(
        "chat.sendMessage".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Command,
          input: json!({ "properties": { "roomId": { "type": "string" }, "text": { "type": "string" } } }),
          output: json!({ "properties": { "id": { "type": "string" } } }),
          error: None,
        },
      );
      m.insert(
        "chat.events".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Subscription,
          input: json!({ "properties": { "roomId": { "type": "string" } } }),
          output: json!({
            "discriminator": "type",
            "mapping": {
              "newMessage": { "properties": { "payload": { "properties": { "text": { "type": "string" } } } } }
            }
          }),
          error: None,
        },
      );
      m
    },
    channels: {
      let mut m = BTreeMap::new();
      m.insert(
        "chat".to_string(),
        ChannelSchema {
          input: json!({ "properties": { "roomId": { "type": "string" } } }),
          incoming: {
            let mut im = BTreeMap::new();
            im.insert(
              "sendMessage".to_string(),
              IncomingSchema {
                input: json!({ "properties": { "text": { "type": "string" } } }),
                output: json!({ "properties": { "id": { "type": "string" } } }),
                error: None,
              },
            );
            im
          },
          outgoing: {
            let mut om = BTreeMap::new();
            om.insert(
              "newMessage".to_string(),
              json!({ "properties": { "text": { "type": "string" } } }),
            );
            om
          },
        },
      );
      m
    },
  };

  let code = generate_typescript(&manifest, None, "__SEAM_DATA__").unwrap();

  // chat.events should reference ChatChannelInput / ChatEvent (channel types)
  assert!(code.contains(
    "\"chat.events\": { kind: \"subscription\"; input: ChatChannelInput; output: ChatEvent };"
  ));
  // chat.sendMessage should use standard naming (not channel-special-cased)
  assert!(code.contains(
    "\"chat.sendMessage\": { kind: \"command\"; input: ChatSendMessageInput; output: ChatSendMessageOutput };"
  ));
}

#[test]
fn dot_namespace_codegen() {
  let manifest = crate::manifest::Manifest {
    version: 1,
    procedures: {
      let mut m = BTreeMap::new();
      m.insert(
        "user.getProfile".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Query,
          input: json!({
              "properties": { "userId": { "type": "string" } }
          }),
          output: json!({
              "properties": { "name": { "type": "string" } }
          }),
          error: None,
        },
      );
      m.insert(
        "user.updateEmail".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Command,
          input: json!({
              "properties": { "email": { "type": "string" } }
          }),
          output: json!({
              "properties": { "success": { "type": "boolean" } }
          }),
          error: None,
        },
      );
      m.insert(
        "counter.onCount".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Subscription,
          input: json!({
              "properties": { "max": { "type": "int32" } }
          }),
          output: json!({
              "properties": { "n": { "type": "int32" } }
          }),
          error: None,
        },
      );
      m
    },
    channels: BTreeMap::new(),
  };

  let code = generate_typescript(&manifest, None, "__SEAM_DATA__").unwrap();

  // PascalCase type names (dots flattened)
  assert!(code.contains("export interface UserGetProfileInput {"));
  assert!(code.contains("export interface UserGetProfileOutput {"));
  assert!(code.contains("export interface UserUpdateEmailInput {"));
  assert!(code.contains("export interface UserUpdateEmailOutput {"));
  assert!(code.contains("export interface CounterOnCountInput {"));
  assert!(code.contains("export interface CounterOnCountOutput {"));

  // Quoted property names in SeamProcedures interface
  assert!(code
    .contains("\"user.getProfile\"(input: UserGetProfileInput): Promise<UserGetProfileOutput>;"));
  assert!(code.contains(
    "\"user.updateEmail\"(input: UserUpdateEmailInput): Promise<UserUpdateEmailOutput>;"
  ));
  assert!(code.contains("\"counter.onCount\"(input: CounterOnCountInput"));

  // Quoted keys in factory object
  assert!(code.contains("\"user.getProfile\": (input) => client.query(\"user.getProfile\", input)"));
  assert!(
    code.contains("\"user.updateEmail\": (input) => client.command(\"user.updateEmail\", input)")
  );
  assert!(code.contains(
    "\"counter.onCount\": (input, onData, onError) => client.subscribe(\"counter.onCount\""
  ));

  // Quoted keys in SeamProcedureMeta
  assert!(code.contains(
    "\"user.getProfile\": { kind: \"query\"; input: UserGetProfileInput; output: UserGetProfileOutput };"
  ));
  assert!(code.contains(
    "\"user.updateEmail\": { kind: \"command\"; input: UserUpdateEmailInput; output: UserUpdateEmailOutput };"
  ));

  // Wire name strings are the original dotted names (not PascalCase)
  assert!(code.contains("client.query(\"user.getProfile\""));
  assert!(code.contains("client.command(\"user.updateEmail\""));
  assert!(code.contains("client.subscribe(\"counter.onCount\""));
}
