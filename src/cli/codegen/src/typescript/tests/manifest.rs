/* src/cli/codegen/src/typescript/tests/manifest.rs */

use std::collections::BTreeMap;

use serde_json::json;

use super::super::*;
use crate::manifest::ProcedureType;

#[test]
fn full_manifest_render() {
	let manifest = crate::manifest::Manifest {
		version: 1,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"greet".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Query,
					input: json!({
							"properties": { "name": { "type": "string" } }
					}),
					output: Some(json!({
							"properties": { "message": { "type": "string" } }
					})),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
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
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"onCount".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Subscription,
					input: json!({
							"properties": { "max": { "type": "int32" } }
					}),
					output: Some(json!({
							"properties": { "n": { "type": "int32" } }
					})),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
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
	use crate::rpc_hash::RpcHashMap;

	let manifest = crate::manifest::Manifest {
		version: 1,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"greet".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Query,
					input: json!({
							"properties": { "name": { "type": "string" } }
					}),
					output: Some(json!({
							"properties": { "message": { "type": "string" } }
					})),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
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
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"greet".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Query,
					input: json!({
							"properties": { "name": { "type": "string" } }
					}),
					output: Some(json!({
							"properties": { "message": { "type": "string" } }
					})),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
	};
	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("client.query(\"greet\""));
	assert!(!code.contains("configureRpcMap"));
	assert!(!code.contains("batchEndpoint"));
}

#[test]
fn subscription_codegen_with_hashes() {
	use crate::rpc_hash::RpcHashMap;

	let manifest = crate::manifest::Manifest {
		version: 1,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"onCount".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Subscription,
					input: json!({
							"properties": { "max": { "type": "int32" } }
					}),
					output: Some(json!({
							"properties": { "n": { "type": "int32" } }
					})),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
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
		context: BTreeMap::new(),
		procedures: BTreeMap::new(),
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
	};
	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("export { DATA_ID } from \"./meta.js\";"));
}

#[test]
fn data_id_export_custom() {
	let manifest = crate::manifest::Manifest {
		version: 1,
		context: BTreeMap::new(),
		procedures: BTreeMap::new(),
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
	};
	let code = generate_typescript(&manifest, None, "__sd").unwrap();
	assert!(code.contains("export { DATA_ID } from \"./meta.js\";"));
}

#[test]
fn meta_ts_default() {
	let code = generate_typescript_meta("__data");
	assert!(code.contains("export const DATA_ID = \"__data\";"));
	assert!(!code.contains("import"));
}

#[test]
fn meta_ts_custom() {
	let code = generate_typescript_meta("__sd");
	assert!(code.contains("export const DATA_ID = \"__sd\";"));
	assert!(!code.contains("import"));
}

#[test]
fn command_codegen() {
	let manifest = crate::manifest::Manifest {
		version: 1,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"deleteUser".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Command,
					input: json!({
							"properties": { "userId": { "type": "string" } }
					}),
					output: Some(json!({
							"properties": { "success": { "type": "boolean" } }
					})),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
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
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"deleteUser".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Command,
					input: json!({
							"properties": { "userId": { "type": "string" } }
					}),
					output: Some(json!({
							"properties": { "success": { "type": "boolean" } }
					})),
					chunk_output: None,
					error: Some(json!({
							"properties": { "reason": { "type": "string" } }
					})),
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
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
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"greet".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Query,
					input: json!({
							"properties": { "name": { "type": "string" } }
					}),
					output: Some(json!({
							"properties": { "message": { "type": "string" } }
					})),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
	};

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(!code.contains("GreetError"));
	assert!(!code.contains("error:"));
}

#[test]
fn command_with_hashes() {
	use crate::rpc_hash::RpcHashMap;

	let manifest = crate::manifest::Manifest {
		version: 1,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"deleteUser".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Command,
					input: json!({
							"properties": { "userId": { "type": "string" } }
					}),
					output: Some(json!({
							"properties": { "success": { "type": "boolean" } }
					})),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
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

#[test]
fn stream_codegen() {
	let manifest = crate::manifest::Manifest {
		version: 2,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"countStream".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Stream,
					input: json!({
							"properties": { "max": { "type": "int32" } }
					}),
					output: None,
					chunk_output: Some(json!({
							"properties": { "n": { "type": "int32" } }
					})),
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
	};

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("export interface CountStreamInput {"));
	assert!(code.contains("export interface CountStreamChunk {"));
	assert!(code.contains("countStream(input: CountStreamInput): StreamHandle<CountStreamChunk>;"));
	assert!(code.contains("client.stream(\"countStream\""));
	assert!(code.contains("StreamHandle"));
	// Meta should use "stream" kind with Chunk type
	assert!(code.contains(
		"countStream: { kind: \"stream\"; input: CountStreamInput; output: CountStreamChunk };"
	));
}

#[test]
fn stream_codegen_with_hashes() {
	use crate::rpc_hash::RpcHashMap;

	let manifest = crate::manifest::Manifest {
		version: 2,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"countStream".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Stream,
					input: json!({
							"properties": { "max": { "type": "int32" } }
					}),
					output: None,
					chunk_output: Some(json!({
							"properties": { "n": { "type": "int32" } }
					})),
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
	};
	let hash_map = RpcHashMap {
		salt: "test_salt".to_string(),
		batch: "deadbeef".to_string(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert("countStream".to_string(), "stream1234".to_string());
			m
		},
	};
	let code = generate_typescript(&manifest, Some(&hash_map), "__data").unwrap();
	assert!(code.contains("client.stream(\"stream1234\""));
	// Interface still uses original name
	assert!(code.contains("countStream(input: CountStreamInput"));
}

#[test]
fn upload_codegen() {
	let manifest = crate::manifest::Manifest {
		version: 2,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"uploadVideo".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Upload,
					input: json!({
							"properties": { "title": { "type": "string" } }
					}),
					output: Some(json!({
							"properties": { "videoId": { "type": "string" } }
					})),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
	};

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("export interface UploadVideoInput {"));
	assert!(code.contains("export interface UploadVideoOutput {"));
	assert!(code.contains(
		"uploadVideo(input: UploadVideoInput, file: File | Blob): Promise<UploadVideoOutput>;"
	));
	assert!(code.contains("client.upload(\"uploadVideo\""));
	assert!(code.contains(
		"uploadVideo: { kind: \"upload\"; input: UploadVideoInput; output: UploadVideoOutput };"
	));
}

#[test]
fn invalidates_codegen() {
	use crate::manifest::InvalidateTarget;

	let manifest = crate::manifest::Manifest {
		version: 2,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"getPost".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Query,
					input: json!({ "properties": { "postId": { "type": "string" } } }),
					output: Some(json!({ "properties": { "title": { "type": "string" } } })),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m.insert(
				"listPosts".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Query,
					input: json!({}),
					output: Some(json!({})),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m.insert(
        "updatePost".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Command,
          input: json!({ "properties": { "postId": { "type": "string" }, "title": { "type": "string" } } }),
          output: Some(json!({ "properties": { "ok": { "type": "boolean" } } })),
          chunk_output: None,
          error: None,
          invalidates: Some(vec![
            InvalidateTarget { query: "getPost".to_string(), mapping: None },
            InvalidateTarget { query: "listPosts".to_string(), mapping: None },
          ]),
          context: None,
          transport: None,
          suppress: None,
          cache: None,
        },
      );
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
	};

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains(
    "updatePost: { kind: \"command\"; input: UpdatePostInput; output: UpdatePostOutput; invalidates: readonly [\"getPost\", \"listPosts\"] };"
  ));
}

#[test]
fn command_without_invalidates_no_field() {
	let manifest = crate::manifest::Manifest {
		version: 2,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"deleteUser".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Command,
					input: json!({ "properties": { "userId": { "type": "string" } } }),
					output: Some(json!({ "properties": { "ok": { "type": "boolean" } } })),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
	};

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains(
		"deleteUser: { kind: \"command\"; input: DeleteUserInput; output: DeleteUserOutput };"
	));
	assert!(!code.contains("invalidates"));
}

#[test]
fn invalidates_with_error_codegen() {
	use crate::manifest::InvalidateTarget;

	let manifest = crate::manifest::Manifest {
		version: 2,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"getPost".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Query,
					input: json!({}),
					output: Some(json!({})),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m.insert(
				"updatePost".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Command,
					input: json!({ "properties": { "postId": { "type": "string" } } }),
					output: Some(json!({ "properties": { "ok": { "type": "boolean" } } })),
					chunk_output: None,
					error: Some(json!({ "properties": { "reason": { "type": "string" } } })),
					invalidates: Some(vec![InvalidateTarget { query: "getPost".to_string(), mapping: None }]),
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
	};

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	// Both error and invalidates should appear
	assert!(code.contains(
    "updatePost: { kind: \"command\"; input: UpdatePostInput; output: UpdatePostOutput; error: UpdatePostError; invalidates: readonly [\"getPost\"] };"
  ));
}

#[test]
fn procedure_config_basic() {
	let manifest = crate::manifest::Manifest {
		version: 2,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"getUser".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Query,
					input: json!({}),
					output: Some(json!({})),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m.insert(
				"deleteUser".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Command,
					input: json!({}),
					output: Some(json!({})),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
	};

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("export const seamProcedureConfig = {"));
	assert!(code.contains("getUser: { kind: \"query\" },"));
	assert!(code.contains("deleteUser: { kind: \"command\" },"));
	assert!(code.contains("} as const;"));
	assert!(code.contains("export type SeamProcedureConfig = typeof seamProcedureConfig;"));
}

#[test]
fn procedure_config_cache_hint() {
	use crate::manifest::CacheHint;

	let manifest = crate::manifest::Manifest {
		version: 2,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"getUser".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Query,
					input: json!({}),
					output: Some(json!({})),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: Some(CacheHint::Config { ttl: 30 }),
				},
			);
			m.insert(
				"listPosts".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Query,
					input: json!({}),
					output: Some(json!({})),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: Some(CacheHint::Disabled(false)),
				},
			);
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
	};

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("getUser: { kind: \"query\", cache: { ttl: 30 } },"));
	assert!(code.contains("listPosts: { kind: \"query\", cache: false },"));
}

#[test]
fn procedure_config_invalidates_with_mapping() {
	use crate::manifest::{InvalidateTarget, MappingValue};

	let manifest = crate::manifest::Manifest {
		version: 2,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"updatePost".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Command,
					input: json!({}),
					output: Some(json!({})),
					chunk_output: None,
					error: None,
					invalidates: Some(vec![
						InvalidateTarget { query: "getPost".to_string(), mapping: None },
						InvalidateTarget {
							query: "listPosts".to_string(),
							mapping: Some(BTreeMap::from([(
								"authorId".to_string(),
								MappingValue { from: "userId".to_string(), each: None },
							)])),
						},
					]),
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
	};

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("invalidates: [{ query: \"getPost\" }, { query: \"listPosts\", mapping: { authorId: { from: \"userId\" } } }]"));
}

#[test]
fn procedure_config_no_extra_fields() {
	let manifest = crate::manifest::Manifest {
		version: 2,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"onUpdates".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Subscription,
					input: json!({}),
					output: Some(json!({})),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m.insert(
				"countStream".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Stream,
					input: json!({}),
					output: None,
					chunk_output: Some(json!({})),
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m.insert(
				"uploadVideo".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Upload,
					input: json!({}),
					output: Some(json!({})),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: None,
					suppress: None,
					cache: None,
				},
			);
			m
		},
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
	};

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("countStream: { kind: \"stream\" },"));
	assert!(code.contains("onUpdates: { kind: \"subscription\" },"));
	assert!(code.contains("uploadVideo: { kind: \"upload\" },"));
}
