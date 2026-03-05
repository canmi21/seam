/* src/cli/codegen/src/typescript/tests/channel.rs */

use std::collections::BTreeMap;

use serde_json::json;

use super::super::*;
use crate::manifest::ProcedureType;

#[test]
fn channel_procedure_meta_uses_channel_types() {
	use crate::manifest::{ChannelSchema, IncomingSchema};

	let manifest = crate::manifest::Manifest {
		version: 1,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
        "chat.sendMessage".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Command,
          input: json!({ "properties": { "roomId": { "type": "string" }, "text": { "type": "string" } } }),
          output: Some(json!({ "properties": { "id": { "type": "string" } } })),
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
        "chat.events".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Subscription,
          input: json!({ "properties": { "roomId": { "type": "string" } } }),
          output: Some(json!({
            "discriminator": "type",
            "mapping": {
              "newMessage": { "properties": { "payload": { "properties": { "text": { "type": "string" } } } } }
            }
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
					transport: None,
				},
			);
			m
		},
		transport_defaults: BTreeMap::new(),
	};

	let code = generate_typescript(&manifest, None, "__data").unwrap();

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
	use crate::manifest::{ChannelSchema, IncomingSchema};

	let manifest = crate::manifest::Manifest {
		version: 1,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
        "chat.sendMessage".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Command,
          input: json!({ "properties": { "roomId": { "type": "string" }, "text": { "type": "string" } } }),
          output: Some(json!({ "properties": { "id": { "type": "string" } } })),
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
        "chat.events".to_string(),
        crate::manifest::ProcedureSchema {
          proc_type: ProcedureType::Subscription,
          input: json!({ "properties": { "roomId": { "type": "string" } } }),
          output: Some(json!({
            "discriminator": "type",
            "mapping": {
              "newMessage": { "properties": { "payload": { "properties": { "text": { "type": "string" } } } } }
            }
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
					transport: None,
				},
			);
			m
		},
		transport_defaults: BTreeMap::new(),
	};

	let code = generate_typescript(&manifest, None, "__data").unwrap();

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
	let manifest = crate::manifest::Manifest {
		version: 1,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"user.getProfile".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Query,
					input: json!({
							"properties": { "userId": { "type": "string" } }
					}),
					output: Some(json!({
							"properties": { "name": { "type": "string" } }
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
			m.insert(
				"user.updateEmail".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Command,
					input: json!({
							"properties": { "email": { "type": "string" } }
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
			m.insert(
				"counter.onCount".to_string(),
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
	use crate::manifest::TransportConfig;
	use crate::manifest::TransportPreference;

	let mut transport_defaults = BTreeMap::new();
	transport_defaults.insert(
		"query".to_string(),
		TransportConfig { prefer: TransportPreference::Http, fallback: None },
	);
	transport_defaults.insert(
		"channel".to_string(),
		TransportConfig {
			prefer: TransportPreference::Ws,
			fallback: Some(vec![TransportPreference::Http]),
		},
	);

	let manifest = crate::manifest::Manifest {
		version: 2,
		context: BTreeMap::new(),
		procedures: BTreeMap::new(),
		channels: BTreeMap::new(),
		transport_defaults,
	};

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	assert!(code.contains("export const seamTransportHint = {"));
	assert!(code.contains("defaults: {"));
	assert!(code.contains("query: { prefer: \"http\" as const"));
	assert!(code.contains("channel: { prefer: \"ws\" as const"));
}

#[test]
fn hint_with_procedure_override() {
	use crate::manifest::TransportConfig;
	use crate::manifest::TransportPreference;

	let manifest = crate::manifest::Manifest {
		version: 2,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"liveMetrics".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Subscription,
					input: json!({}),
					output: Some(json!({})),
					chunk_output: None,
					error: None,
					invalidates: None,
					context: None,
					transport: Some(TransportConfig {
						prefer: TransportPreference::Ws,
						fallback: Some(vec![TransportPreference::Sse]),
					}),
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
	assert!(code.contains("procedures: {"));
	assert!(code.contains("liveMetrics: { prefer: \"ws\" as const"));
}

#[test]
fn hint_channel_resolved_from_defaults() {
	use crate::manifest::{ChannelSchema, IncomingSchema, TransportConfig, TransportPreference};

	let mut transport_defaults = BTreeMap::new();
	transport_defaults.insert(
		"channel".to_string(),
		TransportConfig {
			prefer: TransportPreference::Sse,
			fallback: Some(vec![TransportPreference::Http]),
		},
	);

	let manifest = crate::manifest::Manifest {
		version: 2,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"room.send".to_string(),
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
			m.insert(
				"room.events".to_string(),
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
			m
		},
		channels: {
			let mut m = BTreeMap::new();
			m.insert(
				"room".to_string(),
				ChannelSchema {
					input: json!({}),
					incoming: {
						let mut im = BTreeMap::new();
						im.insert(
							"send".to_string(),
							IncomingSchema { input: json!({}), output: json!({}), error: None },
						);
						im
					},
					outgoing: {
						let mut om = BTreeMap::new();
						om.insert("msg".to_string(), json!({}));
						om
					},
					transport: None,
				},
			);
			m
		},
		transport_defaults,
	};

	let code = generate_typescript(&manifest, None, "__data").unwrap();
	// Channel should use "sse" from transport_defaults, not hardcoded "ws"
	assert!(code.contains("channelTransports: { room: \"sse\" }"));
	assert!(code.contains("transport: \"sse\" as const"));
}

#[test]
fn factory_backward_compat_no_transport() {
	let manifest = crate::manifest::Manifest {
		version: 2,
		context: BTreeMap::new(),
		procedures: {
			let mut m = BTreeMap::new();
			m.insert(
				"greet".to_string(),
				crate::manifest::ProcedureSchema {
					proc_type: ProcedureType::Query,
					input: json!({ "properties": { "name": { "type": "string" } } }),
					output: Some(json!({ "properties": { "message": { "type": "string" } } })),
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
	// Still generates valid code without transport info
	assert!(code.contains("createSeamClient"));
	assert!(code.contains("client.query(\"greet\""));
	// No channelTransports when no channels
	assert!(!code.contains("channelTransports"));
}
