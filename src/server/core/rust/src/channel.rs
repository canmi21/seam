/* src/server/core/rust/src/channel.rs */

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::procedure::{
  HandlerFn, ProcedureDef, ProcedureType, SubscriptionDef, SubscriptionHandlerFn,
};

pub struct IncomingDef {
  pub input_schema: Value,
  pub output_schema: Value,
  pub error_schema: Option<Value>,
  pub handler: HandlerFn,
}

pub struct ChannelDef {
  pub name: String,
  pub input_schema: Value,
  pub incoming: Vec<(String, IncomingDef)>,
  pub outgoing: Vec<(String, Value)>,
  pub subscribe_handler: SubscriptionHandlerFn,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelMeta {
  pub input: Value,
  pub incoming: BTreeMap<String, IncomingMeta>,
  pub outgoing: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomingMeta {
  pub input: Value,
  pub output: Value,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub error: Option<Value>,
}

impl ChannelDef {
  /// Expand channel to Level 0 primitives (commands + subscription) and metadata.
  pub fn expand(self) -> (Vec<ProcedureDef>, Vec<SubscriptionDef>, ChannelMeta) {
    let mut procedures = Vec::new();
    let mut incoming_meta = BTreeMap::new();

    for (msg_name, msg_def) in self.incoming {
      let merged_input = merge_object_schemas(&self.input_schema, &msg_def.input_schema);

      procedures.push(ProcedureDef {
        name: format!("{}.{}", self.name, msg_name),
        proc_type: ProcedureType::Command,
        input_schema: merged_input,
        output_schema: msg_def.output_schema.clone(),
        error_schema: msg_def.error_schema.clone(),
        handler: msg_def.handler,
      });

      incoming_meta.insert(
        msg_name,
        IncomingMeta {
          input: msg_def.input_schema,
          output: msg_def.output_schema,
          error: msg_def.error_schema,
        },
      );
    }

    // Build tagged union schema for outgoing events
    let mut mapping = serde_json::Map::new();
    let mut outgoing_meta = BTreeMap::new();
    for (event_name, payload_schema) in &self.outgoing {
      let mut variant = serde_json::Map::new();
      let mut props = serde_json::Map::new();
      props.insert("payload".to_string(), payload_schema.clone());
      variant.insert("properties".to_string(), Value::Object(props));
      mapping.insert(event_name.clone(), Value::Object(variant));
      outgoing_meta.insert(event_name.clone(), payload_schema.clone());
    }
    let union_schema = serde_json::json!({
      "discriminator": "type",
      "mapping": Value::Object(mapping)
    });

    let subscriptions = vec![SubscriptionDef {
      name: format!("{}.events", self.name),
      input_schema: self.input_schema.clone(),
      output_schema: union_schema,
      error_schema: None,
      handler: self.subscribe_handler,
    }];

    let meta =
      ChannelMeta { input: self.input_schema, incoming: incoming_meta, outgoing: outgoing_meta };

    (procedures, subscriptions, meta)
  }
}

/// Merge two JTD object schemas (properties + optionalProperties).
/// Message properties override channel properties on key collision.
fn merge_object_schemas(channel: &Value, message: &Value) -> Value {
  let mut merged = serde_json::Map::new();

  let ch_props = channel.get("properties").and_then(|v| v.as_object());
  let ch_opt = channel.get("optionalProperties").and_then(|v| v.as_object());
  let msg_props = message.get("properties").and_then(|v| v.as_object());
  let msg_opt = message.get("optionalProperties").and_then(|v| v.as_object());

  let mut props = serde_json::Map::new();
  if let Some(p) = ch_props {
    props.extend(p.clone());
  }
  if let Some(p) = msg_props {
    props.extend(p.clone());
  }

  let mut opt_props = serde_json::Map::new();
  if let Some(p) = ch_opt {
    opt_props.extend(p.clone());
  }
  if let Some(p) = msg_opt {
    opt_props.extend(p.clone());
  }

  // Always emit "properties" when there are required props, or when
  // there are no optional props either (empty schema -> empty properties).
  if !props.is_empty() || opt_props.is_empty() {
    merged.insert("properties".to_string(), Value::Object(props));
  }
  if !opt_props.is_empty() {
    merged.insert("optionalProperties".to_string(), Value::Object(opt_props));
  }

  Value::Object(merged)
}

#[cfg(test)]
mod tests {
  use std::sync::Arc;

  use super::*;
  use crate::procedure::BoxStream;

  fn dummy_handler() -> HandlerFn {
    Arc::new(|_| Box::pin(async { Ok(serde_json::json!({})) }))
  }

  struct EmptyStream;

  impl futures_core::Stream for EmptyStream {
    type Item = Result<serde_json::Value, crate::errors::SeamError>;
    fn poll_next(
      self: std::pin::Pin<&mut Self>,
      _cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
      std::task::Poll::Ready(None)
    }
  }

  fn dummy_sub_handler() -> SubscriptionHandlerFn {
    Arc::new(|_| {
      Box::pin(async {
        let stream: BoxStream<Result<serde_json::Value, crate::errors::SeamError>> =
          Box::pin(EmptyStream);
        Ok(stream)
      })
    })
  }

  #[test]
  fn expand_produces_commands_and_subscription() {
    let channel = ChannelDef {
      name: "chat".to_string(),
      input_schema: serde_json::json!({"properties": {"roomId": {"type": "string"}}}),
      incoming: vec![(
        "send".to_string(),
        IncomingDef {
          input_schema: serde_json::json!({"properties": {"text": {"type": "string"}}}),
          output_schema: serde_json::json!({"properties": {"ok": {"type": "boolean"}}}),
          error_schema: None,
          handler: dummy_handler(),
        },
      )],
      outgoing: vec![(
        "message".to_string(),
        serde_json::json!({"properties": {"text": {"type": "string"}}}),
      )],
      subscribe_handler: dummy_sub_handler(),
    };

    let (procs, subs, meta) = channel.expand();

    // One command: chat.send
    assert_eq!(procs.len(), 1);
    assert_eq!(procs[0].name, "chat.send");
    assert_eq!(procs[0].proc_type, ProcedureType::Command);

    // Merged input: roomId (channel) + text (message)
    let input = &procs[0].input_schema;
    assert!(input["properties"]["roomId"].is_object());
    assert!(input["properties"]["text"].is_object());

    // One subscription: chat.events
    assert_eq!(subs.len(), 1);
    assert_eq!(subs[0].name, "chat.events");

    // Tagged union schema
    assert_eq!(subs[0].output_schema["discriminator"], "type");
    assert!(subs[0].output_schema["mapping"]["message"].is_object());

    // Meta preserves original (non-merged) schemas
    assert_eq!(meta.input, serde_json::json!({"properties": {"roomId": {"type": "string"}}}));
    assert!(meta.incoming.contains_key("send"));
    assert_eq!(
      meta.incoming["send"].input,
      serde_json::json!({"properties": {"text": {"type": "string"}}})
    );
    assert!(meta.outgoing.contains_key("message"));
  }

  #[test]
  fn expand_multiple_incoming_and_outgoing() {
    let channel = ChannelDef {
      name: "game".to_string(),
      input_schema: serde_json::json!({"properties": {"gameId": {"type": "string"}}}),
      incoming: vec![
        (
          "move".to_string(),
          IncomingDef {
            input_schema: serde_json::json!({"properties": {"x": {"type": "int32"}}}),
            output_schema: serde_json::json!({}),
            error_schema: Some(serde_json::json!({"properties": {"code": {"type": "string"}}})),
            handler: dummy_handler(),
          },
        ),
        (
          "resign".to_string(),
          IncomingDef {
            input_schema: serde_json::json!({}),
            output_schema: serde_json::json!({}),
            error_schema: None,
            handler: dummy_handler(),
          },
        ),
      ],
      outgoing: vec![
        ("moved".to_string(), serde_json::json!({"properties": {"x": {"type": "int32"}}})),
        ("ended".to_string(), serde_json::json!({"properties": {"winner": {"type": "string"}}})),
      ],
      subscribe_handler: dummy_sub_handler(),
    };

    let (procs, subs, meta) = channel.expand();

    assert_eq!(procs.len(), 2);
    assert_eq!(procs[0].name, "game.move");
    assert_eq!(procs[1].name, "game.resign");
    assert!(procs[0].error_schema.is_some());
    assert!(procs[1].error_schema.is_none());

    assert_eq!(subs.len(), 1);
    assert_eq!(meta.incoming.len(), 2);
    assert_eq!(meta.outgoing.len(), 2);
    assert!(meta.incoming["move"].error.is_some());
    assert!(meta.incoming["resign"].error.is_none());
  }

  #[test]
  fn merge_object_schemas_combines_properties() {
    let channel = serde_json::json!({
      "properties": {"a": {"type": "string"}},
      "optionalProperties": {"b": {"type": "int32"}}
    });
    let message = serde_json::json!({
      "properties": {"c": {"type": "boolean"}}
    });
    let merged = merge_object_schemas(&channel, &message);
    assert!(merged["properties"]["a"].is_object());
    assert!(merged["properties"]["c"].is_object());
    assert!(merged["optionalProperties"]["b"].is_object());
  }

  #[test]
  fn merge_empty_schemas() {
    let merged = merge_object_schemas(&serde_json::json!({}), &serde_json::json!({}));
    // Both empty -> produces empty "properties"
    assert_eq!(merged, serde_json::json!({"properties": {}}));
  }
}
