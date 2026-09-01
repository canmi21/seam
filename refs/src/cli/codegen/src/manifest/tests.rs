/* src/cli/codegen/src/manifest/tests.rs */

use std::collections::BTreeMap;

use serde_json::json;

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
		transport: None,
		suppress: None,
		cache: None,
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
		transport: None,
		suppress: None,
		cache: None,
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
				transport: None,
				suppress: None,
				cache: None,
			},
		)]),
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
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
				transport: None,
				suppress: None,
				cache: None,
			},
		)]),
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
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
				transport: None,
				suppress: None,
				cache: None,
			},
		)]),
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
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
		transport: None,
		suppress: None,
		cache: None,
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

#[test]
fn deserialize_transport_defaults() {
	let json = r#"{
    "version": 2,
    "context": {},
    "procedures": {
      "getUser": { "kind": "query", "input": {}, "output": {} }
    },
    "transportDefaults": {
      "query": { "prefer": "http" },
      "subscription": { "prefer": "ws", "fallback": ["sse", "http"] }
    }
  }"#;
	let m: Manifest = serde_json::from_str(json).unwrap();
	assert_eq!(m.transport_defaults.len(), 2);
	assert_eq!(m.transport_defaults["query"].prefer, TransportPreference::Http);
	let sub = &m.transport_defaults["subscription"];
	assert_eq!(sub.prefer, TransportPreference::Ws);
	assert_eq!(sub.fallback.as_ref().unwrap().len(), 2);
}

#[test]
fn deserialize_procedure_transport() {
	let json = r#"{
    "version": 2,
    "procedures": {
      "live": { "kind": "subscription", "input": {}, "output": {}, "transport": { "prefer": "ws", "fallback": ["http"] } }
    }
  }"#;
	let m: Manifest = serde_json::from_str(json).unwrap();
	let t = m.procedures["live"].transport.as_ref().unwrap();
	assert_eq!(t.prefer, TransportPreference::Ws);
	assert_eq!(t.fallback.as_ref().unwrap(), &vec![TransportPreference::Http]);
}

#[test]
fn backward_compat_empty_transport() {
	let json = r#"{
    "version": 2,
    "procedures": {
      "getUser": { "kind": "query", "input": {}, "output": {} }
    },
    "transportDefaults": {}
  }"#;
	let m: Manifest = serde_json::from_str(json).unwrap();
	assert!(m.transport_defaults.is_empty());
}

#[test]
fn suppress_roundtrip() {
	let schema = ProcedureSchema {
		proc_type: ProcedureType::Query,
		input: Value::Object(Default::default()),
		output: Some(Value::Object(Default::default())),
		chunk_output: None,
		error: None,
		invalidates: None,
		context: None,
		transport: None,
		suppress: Some(vec!["unused".into()]),
		cache: None,
	};
	let json = serde_json::to_string(&schema).unwrap();
	assert!(json.contains(r#""suppress":["unused"]"#));
	let deserialized: ProcedureSchema = serde_json::from_str(&json).unwrap();
	assert_eq!(deserialized.suppress, Some(vec!["unused".to_string()]));
}

#[test]
fn suppress_omitted_when_none() {
	let schema = ProcedureSchema {
		proc_type: ProcedureType::Query,
		input: Value::Object(Default::default()),
		output: Some(Value::Object(Default::default())),
		chunk_output: None,
		error: None,
		invalidates: None,
		context: None,
		transport: None,
		suppress: None,
		cache: None,
	};
	let json = serde_json::to_string(&schema).unwrap();
	assert!(!json.contains("suppress"));
}

#[test]
fn cache_hint_config_roundtrip() {
	let json = r#"{ "ttl": 30 }"#;
	let hint: CacheHint = serde_json::from_str(json).unwrap();
	assert_eq!(hint, CacheHint::Config { ttl: 30 });
	let serialized = serde_json::to_string(&hint).unwrap();
	assert!(serialized.contains("\"ttl\":30"));
}

#[test]
fn cache_hint_disabled_roundtrip() {
	let hint: CacheHint = serde_json::from_str("false").unwrap();
	assert_eq!(hint, CacheHint::Disabled(false));
	let serialized = serde_json::to_string(&hint).unwrap();
	assert_eq!(serialized, "false");
}

#[test]
fn cache_hint_omitted() {
	let json = r#"{
    "version": 2,
    "procedures": {
      "getUser": { "kind": "query", "input": {}, "output": {} }
    }
  }"#;
	let m: Manifest = serde_json::from_str(json).unwrap();
	assert!(m.procedures["getUser"].cache.is_none());
}

#[test]
fn cache_hint_in_manifest() {
	let json = r#"{
    "version": 2,
    "procedures": {
      "getUser": { "kind": "query", "input": {}, "output": {}, "cache": { "ttl": 60 } },
      "listPosts": { "kind": "query", "input": {}, "output": {}, "cache": false }
    }
  }"#;
	let m: Manifest = serde_json::from_str(json).unwrap();
	assert_eq!(m.procedures["getUser"].cache, Some(CacheHint::Config { ttl: 60 }));
	assert_eq!(m.procedures["listPosts"].cache, Some(CacheHint::Disabled(false)));
}
