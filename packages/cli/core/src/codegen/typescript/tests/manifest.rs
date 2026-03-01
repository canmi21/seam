/* packages/cli/core/src/codegen/typescript/tests/manifest.rs */

use std::collections::BTreeMap;

use serde_json::json;

use super::super::*;
use crate::manifest::ProcedureType;

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

  let code = generate_typescript(&manifest, None, "__data").unwrap();
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

  let code = generate_typescript(&manifest, None, "__data").unwrap();
  assert!(code.contains("export interface OnCountInput {"));
  assert!(code.contains("export interface OnCountOutput {"));
  assert!(code.contains(
    "onCount(input: OnCountInput, onData: (data: OnCountOutput) => void, onError?: (err: SeamClientError) => void): Unsubscribe;"
  ));
  assert!(code.contains("client.subscribe(\"onCount\""));
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
  let code = generate_typescript(&manifest, Some(&hash_map), "__data").unwrap();
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
  let code = generate_typescript(&manifest, None, "__data").unwrap();
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
  let code = generate_typescript(&manifest, Some(&hash_map), "__data").unwrap();
  assert!(code.contains("client.subscribe(\"cafe1234\""));
  // Interface still uses original name
  assert!(code.contains("onCount(input: OnCountInput"));
}

#[test]
fn data_id_export_default() {
  let manifest = crate::manifest::Manifest {
    version: 1,
    procedures: BTreeMap::new(),
    channels: BTreeMap::new(),
  };
  let code = generate_typescript(&manifest, None, "__data").unwrap();
  assert!(code.contains("export const DATA_ID = \"__data\";"));
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

  let code = generate_typescript(&manifest, None, "__data").unwrap();
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

  let code = generate_typescript(&manifest, None, "__data").unwrap();
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

  let code = generate_typescript(&manifest, None, "__data").unwrap();
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
  let code = generate_typescript(&manifest, Some(&hash_map), "__data").unwrap();
  assert!(code.contains("client.command(\"dead1234\""));
  assert!(code.contains("deleteUser(input: DeleteUserInput): Promise<DeleteUserOutput>;"));
}
