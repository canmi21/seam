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
}

impl std::fmt::Display for ProcedureType {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      Self::Query => write!(f, "query"),
      Self::Command => write!(f, "command"),
      Self::Subscription => write!(f, "subscription"),
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
  pub output: Value,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub error: Option<Value>,
}

#[cfg(test)]
mod tests {
  use super::*;

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
  fn serialize_outputs_kind() {
    let m = Manifest {
      version: 2,
      procedures: BTreeMap::from([(
        "test".to_string(),
        ProcedureSchema {
          proc_type: ProcedureType::Command,
          input: Value::Object(Default::default()),
          output: Value::Object(Default::default()),
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
