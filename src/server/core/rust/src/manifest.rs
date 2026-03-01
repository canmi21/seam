/* src/server/core/rust/src/manifest.rs */

use std::collections::BTreeMap;

use serde::Serialize;

use crate::channel::ChannelMeta;
use crate::procedure::{ProcedureDef, ProcedureType, SubscriptionDef};

#[derive(Serialize)]
pub struct Manifest {
  pub version: u32,
  pub procedures: BTreeMap<String, ProcedureSchema>,
  #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
  pub channels: BTreeMap<String, ChannelMeta>,
}

#[derive(Serialize)]
pub struct ProcedureSchema {
  #[serde(rename = "type")]
  pub proc_type: String,
  pub input: serde_json::Value,
  pub output: serde_json::Value,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<serde_json::Value>,
}

pub fn build_manifest(
  procedures: &[ProcedureDef],
  subscriptions: &[SubscriptionDef],
  channels: BTreeMap<String, ChannelMeta>,
) -> Manifest {
  let mut map = BTreeMap::new();
  for proc in procedures {
    let type_str = match proc.proc_type {
      ProcedureType::Query => "query",
      ProcedureType::Command => "command",
    };
    map.insert(
      proc.name.clone(),
      ProcedureSchema {
        proc_type: type_str.to_string(),
        input: proc.input_schema.clone(),
        output: proc.output_schema.clone(),
        error: proc.error_schema.clone(),
      },
    );
  }
  for sub in subscriptions {
    map.insert(
      sub.name.clone(),
      ProcedureSchema {
        proc_type: "subscription".to_string(),
        input: sub.input_schema.clone(),
        output: sub.output_schema.clone(),
        error: sub.error_schema.clone(),
      },
    );
  }
  Manifest { version: 1, procedures: map, channels }
}

#[cfg(test)]
mod tests {
  use std::sync::Arc;

  use super::*;
  use crate::procedure::{BoxStream, HandlerFn, SubscriptionHandlerFn};

  fn dummy_handler() -> HandlerFn {
    Arc::new(|_| Box::pin(async { Ok(serde_json::json!({})) }))
  }

  // Minimal empty stream for test dummies
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
  fn command_procedure_emits_command_type() {
    let procs = vec![ProcedureDef {
      name: "createUser".to_string(),
      proc_type: ProcedureType::Command,
      input_schema: serde_json::json!({}),
      output_schema: serde_json::json!({}),
      error_schema: None,
      handler: dummy_handler(),
    }];
    let manifest = build_manifest(&procs, &[], BTreeMap::new());
    let schema = manifest.procedures.get("createUser").unwrap();
    assert_eq!(schema.proc_type, "command");
  }

  #[test]
  fn error_schema_present_emits_error_field() {
    let error = serde_json::json!({"properties": {"code": {"type": "string"}}});
    let procs = vec![ProcedureDef {
      name: "risky".to_string(),
      proc_type: ProcedureType::Query,
      input_schema: serde_json::json!({}),
      output_schema: serde_json::json!({}),
      error_schema: Some(error.clone()),
      handler: dummy_handler(),
    }];
    let manifest = build_manifest(&procs, &[], BTreeMap::new());
    let json = serde_json::to_value(&manifest).unwrap();
    assert_eq!(json["procedures"]["risky"]["error"], error);
  }

  #[test]
  fn error_schema_none_omits_error_field() {
    let procs = vec![ProcedureDef {
      name: "safe".to_string(),
      proc_type: ProcedureType::Query,
      input_schema: serde_json::json!({}),
      output_schema: serde_json::json!({}),
      error_schema: None,
      handler: dummy_handler(),
    }];
    let manifest = build_manifest(&procs, &[], BTreeMap::new());
    let json = serde_json::to_value(&manifest).unwrap();
    assert!(json["procedures"]["safe"].get("error").is_none());
  }

  #[test]
  fn subscription_with_error_schema() {
    let error = serde_json::json!({"properties": {"reason": {"type": "string"}}});
    let subs = vec![SubscriptionDef {
      name: "onEvent".to_string(),
      input_schema: serde_json::json!({}),
      output_schema: serde_json::json!({}),
      error_schema: Some(error.clone()),
      handler: dummy_sub_handler(),
    }];
    let manifest = build_manifest(&[], &subs, BTreeMap::new());
    let json = serde_json::to_value(&manifest).unwrap();
    assert_eq!(json["procedures"]["onEvent"]["type"], "subscription");
    assert_eq!(json["procedures"]["onEvent"]["error"], error);
  }
}
