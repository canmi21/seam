/* src/cli/codegen/src/typescript/tests/channel.rs */

use std::collections::BTreeMap;

use serde_json::json;

use super::super::*;
use super::fixtures::{make_manifest_with, make_procedure};
use crate::manifest::{ChannelSchema, IncomingSchema, ProcedureSchema, ProcedureType};

fn make_chat_manifest() -> crate::manifest::Manifest {
	crate::manifest::Manifest {
		channels: BTreeMap::from([(
			"chat".into(),
			ChannelSchema {
				input: json!({ "properties": { "roomId": { "type": "string" } } }),
				incoming: BTreeMap::from([(
					"sendMessage".into(),
					IncomingSchema {
						input: json!({ "properties": { "text": { "type": "string" } } }),
						output: json!({ "properties": { "id": { "type": "string" } } }),
						error: None,
					},
				)]),
				outgoing: BTreeMap::from([(
					"newMessage".into(),
					json!({ "properties": { "text": { "type": "string" } } }),
				)]),
				transport: None,
			},
		)]),
		procedures: BTreeMap::from([
			(
				"chat.sendMessage".into(),
				ProcedureSchema {
					input: json!({ "properties": { "roomId": { "type": "string" }, "text": { "type": "string" } } }),
					output: Some(json!({ "properties": { "id": { "type": "string" } } })),
					..make_procedure(ProcedureType::Command)
				},
			),
			(
				"chat.events".into(),
				ProcedureSchema {
					input: json!({ "properties": { "roomId": { "type": "string" } } }),
					output: Some(json!({
						"discriminator": "type",
						"mapping": {
							"newMessage": { "properties": { "payload": { "properties": { "text": { "type": "string" } } } } }
						}
					})),
					..make_procedure(ProcedureType::Subscription)
				},
			),
		]),
		..make_manifest_with(BTreeMap::new())
	}
}

#[test]
fn channel_procedure_meta_uses_channel_types() {
	let code = generate_typescript(&make_chat_manifest(), None, "__data").unwrap();

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
fn transport_hint_codegen() {
	let code = generate_typescript(&make_chat_manifest(), None, "__data").unwrap();

	// Transport hint is emitted
	assert!(code.contains("export const seamTransportHint = {"));
	assert!(code.contains("transport: \"ws\" as const"));
	assert!(code.contains("incoming: [\"chat.sendMessage\"]"));
	assert!(code.contains("outgoing: \"chat.events\""));
	assert!(code.contains("export type SeamTransportHint = typeof seamTransportHint;"));

	// Channel factory delegates to client.channel() instead of inline SSE
	assert!(code.contains("client.channel(name, input)"));
	assert!(!code.contains("client.subscribe(\"chat.events\""));
	assert!(!code.contains("ensureSubscription"));

	// channelTransports is passed to createClient()
	assert!(code.contains("channelTransports: { chat: \"ws\" }"));
}

#[test]
fn dot_namespace_codegen() {
	let manifest = make_manifest_with(BTreeMap::from([
		(
			"user.getProfile".into(),
			ProcedureSchema {
				input: json!({ "properties": { "userId": { "type": "string" } } }),
				output: Some(json!({ "properties": { "name": { "type": "string" } } })),
				..make_procedure(ProcedureType::Query)
			},
		),
		(
			"user.updateEmail".into(),
			ProcedureSchema {
				input: json!({ "properties": { "email": { "type": "string" } } }),
				output: Some(json!({ "properties": { "success": { "type": "boolean" } } })),
				..make_procedure(ProcedureType::Command)
			},
		),
		(
			"counter.onCount".into(),
			ProcedureSchema {
				input: json!({ "properties": { "max": { "type": "int32" } } }),
				output: Some(json!({ "properties": { "n": { "type": "int32" } } })),
				..make_procedure(ProcedureType::Subscription)
			},
		),
	]));

	let code = generate_typescript(&manifest, None, "__data").unwrap();

	// PascalCase type names (dots flattened)
	assert!(code.contains("export interface UserGetProfileInput {"));
	assert!(code.contains("export interface UserGetProfileOutput {"));
	assert!(code.contains("export interface UserUpdateEmailInput {"));
	assert!(code.contains("export interface UserUpdateEmailOutput {"));
	assert!(code.contains("export interface CounterOnCountInput {"));
	assert!(code.contains("export interface CounterOnCountOutput {"));

	// Quoted property names in SeamProcedures interface
	assert!(
		code
			.contains("\"user.getProfile\"(input: UserGetProfileInput): Promise<UserGetProfileOutput>;")
	);
	assert!(code.contains(
		"\"user.updateEmail\"(input: UserUpdateEmailInput): Promise<UserUpdateEmailOutput>;"
	));
	assert!(code.contains("\"counter.onCount\"(input: CounterOnCountInput"));

	// Quoted keys in factory object
	assert!(
		code.contains("\"user.getProfile\": (input) => client.query(\"user.getProfile\", input)")
	);
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

#[test]
fn hint_with_transport_defaults() {
	use crate::manifest::{TransportConfig, TransportPreference};

	let manifest = crate::manifest::Manifest {
		transport_defaults: BTreeMap::from([
			("query".into(), TransportConfig { prefer: TransportPreference::Http, fallback: None }),
			(
				"channel".into(),
				TransportConfig {
					prefer: TransportPreference::Ws,
					fallback: Some(vec![TransportPreference::Http]),
				},
			),
		]),
		..make_manifest_with(BTreeMap::new())
	};

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("export const seamTransportHint = {"));
	assert!(code.contains("defaults: {"));
	assert!(code.contains("query: { prefer: \"http\" as const"));
	assert!(code.contains("channel: { prefer: \"ws\" as const"));
}

#[test]
fn hint_with_procedure_override() {
	use crate::manifest::{TransportConfig, TransportPreference};

	let manifest = make_manifest_with(BTreeMap::from([(
		"liveMetrics".into(),
		ProcedureSchema {
			transport: Some(TransportConfig {
				prefer: TransportPreference::Ws,
				fallback: Some(vec![TransportPreference::Sse]),
			}),
			..make_procedure(ProcedureType::Subscription)
		},
	)]));

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("procedures: {"));
	assert!(code.contains("liveMetrics: { prefer: \"ws\" as const"));
}

#[test]
fn hint_channel_resolved_from_defaults() {
	use crate::manifest::{TransportConfig, TransportPreference};

	let manifest = crate::manifest::Manifest {
		procedures: BTreeMap::from([
			("room.send".into(), make_procedure(ProcedureType::Command)),
			("room.events".into(), make_procedure(ProcedureType::Subscription)),
		]),
		channels: BTreeMap::from([(
			"room".into(),
			ChannelSchema {
				input: json!({}),
				incoming: BTreeMap::from([(
					"send".into(),
					IncomingSchema { input: json!({}), output: json!({}), error: None },
				)]),
				outgoing: BTreeMap::from([("msg".into(), json!({}))]),
				transport: None,
			},
		)]),
		transport_defaults: BTreeMap::from([(
			"channel".into(),
			TransportConfig {
				prefer: TransportPreference::Sse,
				fallback: Some(vec![TransportPreference::Http]),
			},
		)]),
		..make_manifest_with(BTreeMap::new())
	};

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	// Channel should use "sse" from transport_defaults, not hardcoded "ws"
	assert!(code.contains("channelTransports: { room: \"sse\" }"));
	assert!(code.contains("transport: \"sse\" as const"));
}

#[test]
fn factory_backward_compat_no_transport() {
	let manifest = make_manifest_with(BTreeMap::from([(
		"greet".into(),
		ProcedureSchema {
			input: json!({ "properties": { "name": { "type": "string" } } }),
			output: Some(json!({ "properties": { "message": { "type": "string" } } })),
			..make_procedure(ProcedureType::Query)
		},
	)]));

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("createSeamClient"));
	assert!(code.contains("client.query(\"greet\""));
	assert!(!code.contains("channelTransports"));
}
