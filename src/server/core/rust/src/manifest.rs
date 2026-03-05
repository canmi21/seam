/* src/server/core/rust/src/manifest.rs */

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

use crate::channel::ChannelMeta;
use crate::context::ContextConfig;
use crate::procedure::{ProcedureDef, ProcedureType, SubscriptionDef};

#[derive(Serialize)]
pub struct Manifest {
	pub version: u32,
	#[serde(skip_serializing_if = "BTreeMap::is_empty")]
	pub context: BTreeMap<String, ContextManifestEntry>,
	pub procedures: BTreeMap<String, ProcedureSchema>,
	#[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
	pub channels: BTreeMap<String, ChannelMeta>,
	#[serde(rename = "transportDefaults")]
	pub transport_defaults: BTreeMap<String, Value>,
}

#[derive(Serialize)]
pub struct ContextManifestEntry {
	pub extract: String,
	pub schema: Value,
}

#[derive(Serialize)]
pub struct ProcedureSchema {
	#[serde(rename = "kind")]
	pub proc_type: String,
	pub input: serde_json::Value,
	pub output: serde_json::Value,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub error: Option<serde_json::Value>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub context: Option<Vec<String>>,
}

pub fn build_manifest(
	procedures: &[ProcedureDef],
	subscriptions: &[SubscriptionDef],
	channels: BTreeMap<String, ChannelMeta>,
	context_config: &ContextConfig,
) -> Manifest {
	let mut map = BTreeMap::new();
	for proc in procedures {
		let type_str = match proc.proc_type {
			ProcedureType::Query => "query",
			ProcedureType::Command => "command",
		};
		let context = if proc.context_keys.is_empty() { None } else { Some(proc.context_keys.clone()) };
		map.insert(
			proc.name.clone(),
			ProcedureSchema {
				proc_type: type_str.to_string(),
				input: proc.input_schema.clone(),
				output: proc.output_schema.clone(),
				error: proc.error_schema.clone(),
				context,
			},
		);
	}
	for sub in subscriptions {
		let context = if sub.context_keys.is_empty() { None } else { Some(sub.context_keys.clone()) };
		map.insert(
			sub.name.clone(),
			ProcedureSchema {
				proc_type: "subscription".to_string(),
				input: sub.input_schema.clone(),
				output: sub.output_schema.clone(),
				error: sub.error_schema.clone(),
				context,
			},
		);
	}

	let mut context_manifest = BTreeMap::new();
	for (key, field) in context_config {
		context_manifest.insert(
			key.clone(),
			ContextManifestEntry { extract: field.extract.clone(), schema: field.schema.clone() },
		);
	}

	Manifest {
		version: 2,
		context: context_manifest,
		procedures: map,
		channels,
		transport_defaults: BTreeMap::new(),
	}
}

#[cfg(test)]
mod tests {
	use std::sync::Arc;

	use super::*;
	use crate::context::ContextFieldDef;
	use crate::procedure::{BoxStream, HandlerFn, SubscriptionHandlerFn};

	fn dummy_handler() -> HandlerFn {
		Arc::new(|_, _| Box::pin(async { Ok(serde_json::json!({})) }))
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
		Arc::new(|_, _| {
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
			context_keys: vec![],
			handler: dummy_handler(),
		}];
		let manifest = build_manifest(&procs, &[], BTreeMap::new(), &ContextConfig::new());
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
			context_keys: vec![],
			handler: dummy_handler(),
		}];
		let manifest = build_manifest(&procs, &[], BTreeMap::new(), &ContextConfig::new());
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
			context_keys: vec![],
			handler: dummy_handler(),
		}];
		let manifest = build_manifest(&procs, &[], BTreeMap::new(), &ContextConfig::new());
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
			context_keys: vec![],
			handler: dummy_sub_handler(),
		}];
		let manifest = build_manifest(&[], &subs, BTreeMap::new(), &ContextConfig::new());
		let json = serde_json::to_value(&manifest).unwrap();
		assert_eq!(json["procedures"]["onEvent"]["kind"], "subscription");
		assert_eq!(json["procedures"]["onEvent"]["error"], error);
	}

	#[test]
	fn manifest_includes_context() {
		let mut config = ContextConfig::new();
		config.insert(
			"token".into(),
			ContextFieldDef {
				extract: "header:authorization".into(),
				schema: serde_json::json!({"type": "string"}),
			},
		);
		let manifest = build_manifest(&[], &[], BTreeMap::new(), &config);
		let json = serde_json::to_value(&manifest).unwrap();
		assert_eq!(json["context"]["token"]["extract"], "header:authorization");
		assert_eq!(json["context"]["token"]["schema"]["type"], "string");
	}

	#[test]
	fn procedure_includes_context_keys() {
		let procs = vec![ProcedureDef {
			name: "secure".to_string(),
			proc_type: ProcedureType::Query,
			input_schema: serde_json::json!({}),
			output_schema: serde_json::json!({}),
			error_schema: None,
			context_keys: vec!["token".into(), "userId".into()],
			handler: dummy_handler(),
		}];
		let manifest = build_manifest(&procs, &[], BTreeMap::new(), &ContextConfig::new());
		let json = serde_json::to_value(&manifest).unwrap();
		let ctx = json["procedures"]["secure"]["context"].as_array().unwrap();
		assert_eq!(ctx, &[serde_json::json!("token"), serde_json::json!("userId")]);
	}

	#[test]
	fn manifest_v2_full_format() {
		let manifest = build_manifest(&[], &[], BTreeMap::new(), &ContextConfig::new());
		let json = serde_json::to_value(&manifest).unwrap();
		assert_eq!(json["version"], 2);
		assert!(json["procedures"].is_object());
		assert!(json["transportDefaults"].is_object());
	}
}
