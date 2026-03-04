/* src/cli/codegen/src/manifest.rs */

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProcedureType {
  Query,
  Command,
  Subscription,
  Stream,
  Upload,
}

impl std::fmt::Display for ProcedureType {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      Self::Query => write!(f, "query"),
      Self::Command => write!(f, "command"),
      Self::Subscription => write!(f, "subscription"),
      Self::Stream => write!(f, "stream"),
      Self::Upload => write!(f, "upload"),
    }
  }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Manifest {
  pub version: u32,
  pub procedures: BTreeMap<String, ProcedureSchema>,
  #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
  pub channels: BTreeMap<String, ChannelSchema>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcedureSchema {
  #[serde(rename = "kind", alias = "type")]
  pub proc_type: ProcedureType,
  pub input: Value,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub output: Option<Value>,
  #[serde(default, skip_serializing_if = "Option::is_none", rename = "chunkOutput")]
  pub chunk_output: Option<Value>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub error: Option<Value>,
}

impl ProcedureSchema {
  /// Return the effective output schema: chunkOutput for streams, output for others.
  pub fn effective_output(&self) -> Option<&Value> {
    self.chunk_output.as_ref().or(self.output.as_ref())
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn deserialize_v1_manifest() {
    let json = r#"{
      "version": 1,
      "procedures": {
        "getUser": { "type": "query", "input": {}, "output": {} },
        "createUser": { "type": "command", "input": {}, "output": {} }
      }
    }"#;
    let m: Manifest = serde_json::from_str(json).unwrap();
    assert_eq!(m.version, 1);
    assert_eq!(m.procedures["getUser"].proc_type, ProcedureType::Query);
    assert_eq!(m.procedures["createUser"].proc_type, ProcedureType::Command);
  }

  #[test]
  fn deserialize_v2_manifest() {
    let json = r#"{
      "version": 2,
      "context": {},
      "procedures": {
        "getUser": { "kind": "query", "input": {}, "output": {} },
        "onCount": { "kind": "subscription", "input": {}, "output": {} }
      },
      "transportDefaults": {}
    }"#;
    let m: Manifest = serde_json::from_str(json).unwrap();
    assert_eq!(m.version, 2);
    assert_eq!(m.procedures["getUser"].proc_type, ProcedureType::Query);
    assert_eq!(m.procedures["onCount"].proc_type, ProcedureType::Subscription);
  }

  #[test]
  fn deserialize_stream_manifest() {
    let json = r#"{
      "version": 2,
      "context": {},
      "procedures": {
        "countStream": { "kind": "stream", "input": {}, "chunkOutput": {} }
      },
      "transportDefaults": {}
    }"#;
    let m: Manifest = serde_json::from_str(json).unwrap();
    assert_eq!(m.procedures["countStream"].proc_type, ProcedureType::Stream);
    assert!(m.procedures["countStream"].chunk_output.is_some());
    assert!(m.procedures["countStream"].output.is_none());
  }

  #[test]
  fn effective_output_returns_chunk_output_for_stream() {
    let schema = ProcedureSchema {
      proc_type: ProcedureType::Stream,
      input: Value::Object(Default::default()),
      output: None,
      chunk_output: Some(json!({"properties": {"n": {"type": "int32"}}})),
      error: None,
    };
    assert!(schema.effective_output().is_some());
    assert_eq!(schema.effective_output(), schema.chunk_output.as_ref());
  }

  #[test]
  fn effective_output_returns_output_for_query() {
    let schema = ProcedureSchema {
      proc_type: ProcedureType::Query,
      input: Value::Object(Default::default()),
      output: Some(json!({"properties": {"msg": {"type": "string"}}})),
      chunk_output: None,
      error: None,
    };
    assert!(schema.effective_output().is_some());
    assert_eq!(schema.effective_output(), schema.output.as_ref());
  }

  #[test]
  fn deserialize_upload_manifest() {
    let json = r#"{
      "version": 2,
      "context": {},
      "procedures": {
        "uploadVideo": { "kind": "upload", "input": {}, "output": {} }
      },
      "transportDefaults": {}
    }"#;
    let m: Manifest = serde_json::from_str(json).unwrap();
    assert_eq!(m.procedures["uploadVideo"].proc_type, ProcedureType::Upload);
    assert!(m.procedures["uploadVideo"].output.is_some());
  }

  #[test]
  fn serialize_outputs_kind() {
    let m = Manifest {
      version: 2,
      procedures: BTreeMap::from([(
        "test".to_string(),
        ProcedureSchema {
          proc_type: ProcedureType::Command,
          input: Value::Object(Default::default()),
          output: Some(Value::Object(Default::default())),
          chunk_output: None,
          error: None,
        },
      )]),
      channels: BTreeMap::new(),
    };
    let json = serde_json::to_string(&m).unwrap();
    assert!(json.contains(r#""kind":"command""#));
    assert!(!json.contains(r#""type""#));
  }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChannelSchema {
  pub input: Value,
  pub incoming: BTreeMap<String, IncomingSchema>,
  pub outgoing: BTreeMap<String, Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IncomingSchema {
  pub input: Value,
  pub output: Value,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub error: Option<Value>,
}
