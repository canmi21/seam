/* packages/cli/core/src/codegen/typescript/tests/channel.rs */

use std::collections::BTreeMap;

use serde_json::json;

use super::super::*;
use crate::manifest::ProcedureType;

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

  let code = generate_typescript(&manifest, None, "__data").unwrap();

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
