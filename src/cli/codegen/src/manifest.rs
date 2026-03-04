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
pub struct ContextSchema {
  pub extract: String,
  pub schema: Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Manifest {
  pub version: u32,
  #[serde(default)]
  pub context: BTreeMap<String, ContextSchema>,
  pub procedures: BTreeMap<String, ProcedureSchema>,
  #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
  pub channels: BTreeMap<String, ChannelSchema>,
}

impl Manifest {
  pub fn validate_context_refs(&self) -> Result<(), Vec<String>> {
    let mut errors = vec![];
    for (proc_name, schema) in &self.procedures {
      if let Some(ctx_keys) = &schema.context {
        for key in ctx_keys {
          if !self.context.contains_key(key) {
            errors
              .push(format!("Procedure '{proc_name}' references undefined context '{key}'"));
          }
        }
      }
    }
    if errors.is_empty() { Ok(()) } else { Err(errors) }
  }
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
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub invalidates: Option<Vec<InvalidateTarget>>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub context: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InvalidateTarget {
  pub query: String,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub mapping: Option<BTreeMap<String, MappingValue>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MappingValue {
  pub from: String,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub each: Option<bool>,
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
      invalidates: None,
      context: None,
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
      invalidates: None,
      context: None,
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
      context: BTreeMap::new(),
      procedures: BTreeMap::from([(
        "test".to_string(),
        ProcedureSchema {
          proc_type: ProcedureType::Command,
          input: Value::Object(Default::default()),
          output: Some(Value::Object(Default::default())),
          chunk_output: None,
          error: None,
          invalidates: None,
          context: None,
        },
      )]),
      channels: BTreeMap::new(),
    };
    let json = serde_json::to_string(&m).unwrap();
    assert!(json.contains(r#""kind":"command""#));
    assert!(!json.contains(r#""type""#));
  }

  #[test]
  fn deserialize_invalidates() {
    let json = r#"{
      "version": 2,
      "context": {},
      "procedures": {
        "getPost": { "kind": "query", "input": {}, "output": {} },
        "updatePost": {
          "kind": "command",
          "input": {},
          "output": {},
          "invalidates": [
            { "query": "getPost" },
            { "query": "listPosts", "mapping": { "authorId": { "from": "userId" } } }
          ]
        }
      },
      "transportDefaults": {}
    }"#;
    let m: Manifest = serde_json::from_str(json).unwrap();
    let inv = m.procedures["updatePost"].invalidates.as_ref().unwrap();
    assert_eq!(inv.len(), 2);
    assert_eq!(inv[0].query, "getPost");
    assert!(inv[0].mapping.is_none());
    assert_eq!(inv[1].query, "listPosts");
    let mapping = inv[1].mapping.as_ref().unwrap();
    assert_eq!(mapping["authorId"].from, "userId");
    assert!(mapping["authorId"].each.is_none());
  }

  #[test]
  fn deserialize_invalidates_with_each() {
    let json = r#"{
      "version": 2,
      "procedures": {
        "bulkUpdate": {
          "kind": "command",
          "input": {},
          "output": {},
          "invalidates": [
            { "query": "getUser", "mapping": { "userId": { "from": "userIds", "each": true } } }
          ]
        }
      }
    }"#;
    let m: Manifest = serde_json::from_str(json).unwrap();
    let inv = m.procedures["bulkUpdate"].invalidates.as_ref().unwrap();
    let mapping = inv[0].mapping.as_ref().unwrap();
    assert_eq!(mapping["userId"].from, "userIds");
    assert_eq!(mapping["userId"].each, Some(true));
  }

  #[test]
  fn deserialize_manifest_with_context() {
    let json = r#"{
      "version": 2,
      "context": {
        "auth": { "extract": "extractAuth", "schema": { "properties": { "userId": { "type": "string" } } } }
      },
      "procedures": {
        "getPost": { "kind": "query", "input": {}, "output": {}, "context": ["auth"] }
      }
    }"#;
    let m: Manifest = serde_json::from_str(json).unwrap();
    assert!(m.context.contains_key("auth"));
    assert_eq!(m.context["auth"].extract, "extractAuth");
    let ctx = m.procedures["getPost"].context.as_ref().unwrap();
    assert_eq!(ctx, &vec!["auth".to_string()]);
  }

  #[test]
  fn validate_context_refs_pass() {
    let m = Manifest {
      version: 2,
      context: BTreeMap::from([(
        "auth".to_string(),
        ContextSchema { extract: "extractAuth".to_string(), schema: json!({}) },
      )]),
      procedures: BTreeMap::from([(
        "getPost".to_string(),
        ProcedureSchema {
          proc_type: ProcedureType::Query,
          input: json!({}),
          output: Some(json!({})),
          chunk_output: None,
          error: None,
          invalidates: None,
          context: Some(vec!["auth".to_string()]),
        },
      )]),
      channels: BTreeMap::new(),
    };
    assert!(m.validate_context_refs().is_ok());
  }

  #[test]
  fn validate_context_refs_fail() {
    let m = Manifest {
      version: 2,
      context: BTreeMap::new(),
      procedures: BTreeMap::from([(
        "getPost".to_string(),
        ProcedureSchema {
          proc_type: ProcedureType::Query,
          input: json!({}),
          output: Some(json!({})),
          chunk_output: None,
          error: None,
          invalidates: None,
          context: Some(vec!["auth".to_string()]),
        },
      )]),
      channels: BTreeMap::new(),
    };
    let err = m.validate_context_refs().unwrap_err();
    assert_eq!(err.len(), 1);
    assert!(err[0].contains("getPost"));
    assert!(err[0].contains("auth"));
  }

  #[test]
  fn context_field_in_procedure_schema() {
    let schema = ProcedureSchema {
      proc_type: ProcedureType::Query,
      input: json!({}),
      output: Some(json!({})),
      chunk_output: None,
      error: None,
      invalidates: None,
      context: Some(vec!["auth".to_string()]),
    };
    assert_eq!(schema.context.as_ref().unwrap(), &vec!["auth".to_string()]);
  }

  #[test]
  fn deserialize_command_without_invalidates() {
    let json = r#"{
      "version": 2,
      "procedures": {
        "deleteUser": { "kind": "command", "input": {}, "output": {} }
      }
    }"#;
    let m: Manifest = serde_json::from_str(json).unwrap();
    assert!(m.procedures["deleteUser"].invalidates.is_none());
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
