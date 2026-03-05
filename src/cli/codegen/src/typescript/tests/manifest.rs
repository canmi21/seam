/* src/cli/codegen/src/typescript/tests/manifest.rs */

use std::collections::BTreeMap;

use serde_json::json;

use super::super::*;
use super::fixtures::{make_manifest_with, make_procedure};
use crate::manifest::{ProcedureSchema, ProcedureType};

#[test]
fn full_manifest_render() {
	let manifest = make_manifest_with(BTreeMap::from([(
		"greet".into(),
		ProcedureSchema {
			input: json!({ "properties": { "name": { "type": "string" } } }),
			output: Some(json!({ "properties": { "message": { "type": "string" } } })),
			..make_procedure(ProcedureType::Query)
		},
	)]));

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
	let manifest = make_manifest_with(BTreeMap::from([(
		"onCount".into(),
		ProcedureSchema {
			input: json!({ "properties": { "max": { "type": "int32" } } }),
			output: Some(json!({ "properties": { "n": { "type": "int32" } } })),
			..make_procedure(ProcedureType::Subscription)
		},
	)]));

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

	let manifest = make_manifest_with(BTreeMap::from([(
		"greet".into(),
		ProcedureSchema {
			input: json!({ "properties": { "name": { "type": "string" } } }),
			output: Some(json!({ "properties": { "message": { "type": "string" } } })),
			..make_procedure(ProcedureType::Query)
		},
	)]));
	let hash_map = RpcHashMap {
		salt: "test_salt".into(),
		batch: "b1c2d3e4".into(),
		procedures: BTreeMap::from([("greet".into(), "a1b2c3d4".into())]),
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
	let manifest = make_manifest_with(BTreeMap::from([(
		"greet".into(),
		ProcedureSchema {
			input: json!({ "properties": { "name": { "type": "string" } } }),
			output: Some(json!({ "properties": { "message": { "type": "string" } } })),
			..make_procedure(ProcedureType::Query)
		},
	)]));
	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("client.query(\"greet\""));
	assert!(!code.contains("configureRpcMap"));
	assert!(!code.contains("batchEndpoint"));
}

#[test]
fn subscription_codegen_with_hashes() {
	use crate::rpc_hash::RpcHashMap;

	let manifest = make_manifest_with(BTreeMap::from([(
		"onCount".into(),
		ProcedureSchema {
			input: json!({ "properties": { "max": { "type": "int32" } } }),
			output: Some(json!({ "properties": { "n": { "type": "int32" } } })),
			..make_procedure(ProcedureType::Subscription)
		},
	)]));
	let hash_map = RpcHashMap {
		salt: "test_salt".into(),
		batch: "deadbeef".into(),
		procedures: BTreeMap::from([("onCount".into(), "cafe1234".into())]),
	};
	let code = generate_typescript(&manifest, Some(&hash_map), "__data").unwrap();
	assert!(code.contains("client.subscribe(\"cafe1234\""));
	assert!(code.contains("onCount(input: OnCountInput"));
}

#[test]
fn data_id_export_default() {
	let manifest = make_manifest_with(BTreeMap::new());
	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("export { DATA_ID } from \"./meta.js\";"));
}

#[test]
fn data_id_export_custom() {
	let manifest = make_manifest_with(BTreeMap::new());
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
	let manifest = make_manifest_with(BTreeMap::from([(
		"deleteUser".into(),
		ProcedureSchema {
			input: json!({ "properties": { "userId": { "type": "string" } } }),
			output: Some(json!({ "properties": { "success": { "type": "boolean" } } })),
			..make_procedure(ProcedureType::Command)
		},
	)]));

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("client.command(\"deleteUser\""));
	assert!(code.contains(
		"deleteUser: { kind: \"command\"; input: DeleteUserInput; output: DeleteUserOutput };"
	));
}

#[test]
fn error_schema_codegen() {
	let manifest = make_manifest_with(BTreeMap::from([(
		"deleteUser".into(),
		ProcedureSchema {
			input: json!({ "properties": { "userId": { "type": "string" } } }),
			output: Some(json!({ "properties": { "success": { "type": "boolean" } } })),
			error: Some(json!({ "properties": { "reason": { "type": "string" } } })),
			..make_procedure(ProcedureType::Command)
		},
	)]));

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("export interface DeleteUserError {"));
	assert!(code.contains("  reason: string;"));
	assert!(code.contains(
    "deleteUser: { kind: \"command\"; input: DeleteUserInput; output: DeleteUserOutput; error: DeleteUserError };"
  ));
}

#[test]
fn error_schema_absent_no_error_type() {
	let manifest = make_manifest_with(BTreeMap::from([(
		"greet".into(),
		ProcedureSchema {
			input: json!({ "properties": { "name": { "type": "string" } } }),
			output: Some(json!({ "properties": { "message": { "type": "string" } } })),
			..make_procedure(ProcedureType::Query)
		},
	)]));

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(!code.contains("GreetError"));
	assert!(!code.contains("error:"));
}

#[test]
fn command_with_hashes() {
	use crate::rpc_hash::RpcHashMap;

	let manifest = make_manifest_with(BTreeMap::from([(
		"deleteUser".into(),
		ProcedureSchema {
			input: json!({ "properties": { "userId": { "type": "string" } } }),
			output: Some(json!({ "properties": { "success": { "type": "boolean" } } })),
			..make_procedure(ProcedureType::Command)
		},
	)]));
	let hash_map = RpcHashMap {
		salt: "test_salt".into(),
		batch: "b1c2d3e4".into(),
		procedures: BTreeMap::from([("deleteUser".into(), "dead1234".into())]),
	};
	let code = generate_typescript(&manifest, Some(&hash_map), "__data").unwrap();
	assert!(code.contains("client.command(\"dead1234\""));
	assert!(code.contains("deleteUser(input: DeleteUserInput): Promise<DeleteUserOutput>;"));
}

#[test]
fn stream_codegen() {
	let manifest = make_manifest_with(BTreeMap::from([(
		"countStream".into(),
		ProcedureSchema {
			input: json!({ "properties": { "max": { "type": "int32" } } }),
			output: None,
			chunk_output: Some(json!({ "properties": { "n": { "type": "int32" } } })),
			..make_procedure(ProcedureType::Stream)
		},
	)]));

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("export interface CountStreamInput {"));
	assert!(code.contains("export interface CountStreamChunk {"));
	assert!(code.contains("countStream(input: CountStreamInput): StreamHandle<CountStreamChunk>;"));
	assert!(code.contains("client.stream(\"countStream\""));
	assert!(code.contains("StreamHandle"));
	assert!(code.contains(
		"countStream: { kind: \"stream\"; input: CountStreamInput; output: CountStreamChunk };"
	));
}

#[test]
fn stream_codegen_with_hashes() {
	use crate::rpc_hash::RpcHashMap;

	let manifest = make_manifest_with(BTreeMap::from([(
		"countStream".into(),
		ProcedureSchema {
			input: json!({ "properties": { "max": { "type": "int32" } } }),
			output: None,
			chunk_output: Some(json!({ "properties": { "n": { "type": "int32" } } })),
			..make_procedure(ProcedureType::Stream)
		},
	)]));
	let hash_map = RpcHashMap {
		salt: "test_salt".into(),
		batch: "deadbeef".into(),
		procedures: BTreeMap::from([("countStream".into(), "stream1234".into())]),
	};
	let code = generate_typescript(&manifest, Some(&hash_map), "__data").unwrap();
	assert!(code.contains("client.stream(\"stream1234\""));
	assert!(code.contains("countStream(input: CountStreamInput"));
}

#[test]
fn upload_codegen() {
	let manifest = make_manifest_with(BTreeMap::from([(
		"uploadVideo".into(),
		ProcedureSchema {
			input: json!({ "properties": { "title": { "type": "string" } } }),
			output: Some(json!({ "properties": { "videoId": { "type": "string" } } })),
			..make_procedure(ProcedureType::Upload)
		},
	)]));

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

	let manifest = make_manifest_with(BTreeMap::from([
		(
			"getPost".into(),
			ProcedureSchema {
				input: json!({ "properties": { "postId": { "type": "string" } } }),
				output: Some(json!({ "properties": { "title": { "type": "string" } } })),
				..make_procedure(ProcedureType::Query)
			},
		),
		("listPosts".into(), make_procedure(ProcedureType::Query)),
		(
			"updatePost".into(),
			ProcedureSchema {
				input: json!({ "properties": { "postId": { "type": "string" }, "title": { "type": "string" } } }),
				output: Some(json!({ "properties": { "ok": { "type": "boolean" } } })),
				invalidates: Some(vec![
					InvalidateTarget { query: "getPost".into(), mapping: None },
					InvalidateTarget { query: "listPosts".into(), mapping: None },
				]),
				..make_procedure(ProcedureType::Command)
			},
		),
	]));

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains(
    "updatePost: { kind: \"command\"; input: UpdatePostInput; output: UpdatePostOutput; invalidates: readonly [\"getPost\", \"listPosts\"] };"
  ));
}

#[test]
fn command_without_invalidates_no_field() {
	let manifest = make_manifest_with(BTreeMap::from([(
		"deleteUser".into(),
		ProcedureSchema {
			input: json!({ "properties": { "userId": { "type": "string" } } }),
			output: Some(json!({ "properties": { "ok": { "type": "boolean" } } })),
			..make_procedure(ProcedureType::Command)
		},
	)]));

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains(
		"deleteUser: { kind: \"command\"; input: DeleteUserInput; output: DeleteUserOutput };"
	));
	assert!(!code.contains("invalidates"));
}

#[test]
fn invalidates_with_error_codegen() {
	use crate::manifest::InvalidateTarget;

	let manifest = make_manifest_with(BTreeMap::from([
		("getPost".into(), make_procedure(ProcedureType::Query)),
		(
			"updatePost".into(),
			ProcedureSchema {
				input: json!({ "properties": { "postId": { "type": "string" } } }),
				output: Some(json!({ "properties": { "ok": { "type": "boolean" } } })),
				error: Some(json!({ "properties": { "reason": { "type": "string" } } })),
				invalidates: Some(vec![InvalidateTarget { query: "getPost".into(), mapping: None }]),
				..make_procedure(ProcedureType::Command)
			},
		),
	]));

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains(
    "updatePost: { kind: \"command\"; input: UpdatePostInput; output: UpdatePostOutput; error: UpdatePostError; invalidates: readonly [\"getPost\"] };"
  ));
}

#[test]
fn procedure_config_basic() {
	let manifest = make_manifest_with(BTreeMap::from([
		("getUser".into(), make_procedure(ProcedureType::Query)),
		("deleteUser".into(), make_procedure(ProcedureType::Command)),
	]));

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

	let manifest = make_manifest_with(BTreeMap::from([
		(
			"getUser".into(),
			ProcedureSchema {
				cache: Some(CacheHint::Config { ttl: 30 }),
				..make_procedure(ProcedureType::Query)
			},
		),
		(
			"listPosts".into(),
			ProcedureSchema {
				cache: Some(CacheHint::Disabled(false)),
				..make_procedure(ProcedureType::Query)
			},
		),
	]));

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("getUser: { kind: \"query\", cache: { ttl: 30 } },"));
	assert!(code.contains("listPosts: { kind: \"query\", cache: false },"));
}

#[test]
fn procedure_config_invalidates_with_mapping() {
	use crate::manifest::{InvalidateTarget, MappingValue};

	let manifest = make_manifest_with(BTreeMap::from([(
		"updatePost".into(),
		ProcedureSchema {
			invalidates: Some(vec![
				InvalidateTarget { query: "getPost".into(), mapping: None },
				InvalidateTarget {
					query: "listPosts".into(),
					mapping: Some(BTreeMap::from([(
						"authorId".into(),
						MappingValue { from: "userId".into(), each: None },
					)])),
				},
			]),
			..make_procedure(ProcedureType::Command)
		},
	)]));

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("invalidates: [{ query: \"getPost\" }, { query: \"listPosts\", mapping: { authorId: { from: \"userId\" } } }]"));
}

#[test]
fn procedure_config_no_extra_fields() {
	let manifest = make_manifest_with(BTreeMap::from([
		("onUpdates".into(), make_procedure(ProcedureType::Subscription)),
		(
			"countStream".into(),
			ProcedureSchema {
				output: None,
				chunk_output: Some(json!({})),
				..make_procedure(ProcedureType::Stream)
			},
		),
		("uploadVideo".into(), make_procedure(ProcedureType::Upload)),
	]));

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("countStream: { kind: \"stream\" },"));
	assert!(code.contains("onUpdates: { kind: \"subscription\" },"));
	assert!(code.contains("uploadVideo: { kind: \"upload\" },"));
}
