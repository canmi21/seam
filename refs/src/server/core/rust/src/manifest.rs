/* src/server/core/rust/src/manifest.rs */

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

use crate::channel::ChannelMeta;
use crate::context::ContextConfig;
use crate::procedure::{ProcedureDef, ProcedureType, StreamDef, SubscriptionDef, UploadDef};

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
	#[serde(skip_serializing_if = "Option::is_none")]
	pub output: Option<serde_json::Value>,
	#[serde(rename = "chunkOutput", skip_serializing_if = "Option::is_none")]
	pub chunk_output: Option<serde_json::Value>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub error: Option<serde_json::Value>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub context: Option<Vec<String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub suppress: Option<Vec<String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub cache: Option<serde_json::Value>,
}

fn context_option(keys: &[String]) -> Option<Vec<String>> {
	if keys.is_empty() { None } else { Some(keys.to_vec()) }
}

pub fn build_manifest(
	procedures: &[ProcedureDef],
	subscriptions: &[SubscriptionDef],
	streams: &[StreamDef],
	uploads: &[UploadDef],
	channels: BTreeMap<String, ChannelMeta>,
	context_config: &ContextConfig,
) -> Manifest {
	let mut map = BTreeMap::new();
	for proc in procedures {
		let type_str = match proc.proc_type {
			ProcedureType::Query => "query",
			ProcedureType::Command => "command",
		};
		let context = context_option(&proc.context_keys);
		map.insert(
			proc.name.clone(),
			ProcedureSchema {
				proc_type: type_str.to_string(),
				input: proc.input_schema.clone(),
				output: Some(proc.output_schema.clone()),
				chunk_output: None,
				error: proc.error_schema.clone(),
				context,
				suppress: proc.suppress.clone(),
				cache: proc.cache.clone(),
			},
		);
	}
	for sub in subscriptions {
		let context = context_option(&sub.context_keys);
		map.insert(
			sub.name.clone(),
			ProcedureSchema {
				proc_type: "subscription".to_string(),
				input: sub.input_schema.clone(),
				output: Some(sub.output_schema.clone()),
				chunk_output: None,
				error: sub.error_schema.clone(),
				context,
				suppress: sub.suppress.clone(),
				cache: None,
			},
		);
	}
	for stream in streams {
		let context = context_option(&stream.context_keys);
		map.insert(
			stream.name.clone(),
			ProcedureSchema {
				proc_type: "stream".to_string(),
				input: stream.input_schema.clone(),
				output: None,
				chunk_output: Some(stream.chunk_output_schema.clone()),
				error: stream.error_schema.clone(),
				context,
				suppress: stream.suppress.clone(),
				cache: None,
			},
		);
	}
	for upload in uploads {
		let context = context_option(&upload.context_keys);
		map.insert(
			upload.name.clone(),
			ProcedureSchema {
				proc_type: "upload".to_string(),
				input: upload.input_schema.clone(),
				output: Some(upload.output_schema.clone()),
				chunk_output: None,
				error: upload.error_schema.clone(),
				context,
				suppress: upload.suppress.clone(),
				cache: None,
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
	use crate::procedure::{
		BoxStream, HandlerFn, StreamHandlerFn, SubscriptionHandlerFn, UploadHandlerFn,
	};

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
		Arc::new(|_params| {
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
			suppress: None,
			cache: None,
			handler: dummy_handler(),
		}];
		let manifest = build_manifest(&procs, &[], &[], &[], BTreeMap::new(), &ContextConfig::new());
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
			suppress: None,
			cache: None,
			handler: dummy_handler(),
		}];
		let manifest = build_manifest(&procs, &[], &[], &[], BTreeMap::new(), &ContextConfig::new());
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
			suppress: None,
			cache: None,
			handler: dummy_handler(),
		}];
		let manifest = build_manifest(&procs, &[], &[], &[], BTreeMap::new(), &ContextConfig::new());
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
			suppress: None,
			handler: dummy_sub_handler(),
		}];
		let manifest = build_manifest(&[], &subs, &[], &[], BTreeMap::new(), &ContextConfig::new());
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
		let manifest = build_manifest(&[], &[], &[], &[], BTreeMap::new(), &config);
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
			suppress: None,
			cache: None,
			handler: dummy_handler(),
		}];
		let manifest = build_manifest(&procs, &[], &[], &[], BTreeMap::new(), &ContextConfig::new());
		let json = serde_json::to_value(&manifest).unwrap();
		let ctx = json["procedures"]["secure"]["context"].as_array().unwrap();
		assert_eq!(ctx, &[serde_json::json!("token"), serde_json::json!("userId")]);
	}

	#[test]
	fn manifest_v2_full_format() {
		let manifest = build_manifest(&[], &[], &[], &[], BTreeMap::new(), &ContextConfig::new());
		let json = serde_json::to_value(&manifest).unwrap();
		assert_eq!(json["version"], 2);
		assert!(json["procedures"].is_object());
		assert!(json["transportDefaults"].is_object());
	}

	fn dummy_stream_handler() -> StreamHandlerFn {
		Arc::new(|_params| {
			Box::pin(async {
				let stream: BoxStream<Result<serde_json::Value, crate::errors::SeamError>> =
					Box::pin(EmptyStream);
				Ok(stream)
			})
		})
	}

	fn dummy_upload_handler() -> UploadHandlerFn {
		Arc::new(|_, _, _| Box::pin(async { Ok(serde_json::json!({})) }))
	}

	#[test]
	fn stream_emits_chunk_output() {
		let streams = vec![crate::procedure::StreamDef {
			name: "countStream".to_string(),
			input_schema: serde_json::json!({}),
			chunk_output_schema: serde_json::json!({"properties": {"n": {"type": "int32"}}}),
			error_schema: None,
			context_keys: vec![],
			suppress: None,
			handler: dummy_stream_handler(),
		}];
		let manifest = build_manifest(&[], &[], &streams, &[], BTreeMap::new(), &ContextConfig::new());
		let json = serde_json::to_value(&manifest).unwrap();
		assert_eq!(json["procedures"]["countStream"]["kind"], "stream");
		assert!(json["procedures"]["countStream"]["chunkOutput"].is_object());
		assert!(json["procedures"]["countStream"].get("output").is_none());
	}

	#[test]
	fn upload_emits_output() {
		let uploads = vec![crate::procedure::UploadDef {
			name: "echoUpload".to_string(),
			input_schema: serde_json::json!({}),
			output_schema: serde_json::json!({"properties": {"size": {"type": "int32"}}}),
			error_schema: None,
			context_keys: vec![],
			suppress: None,
			handler: dummy_upload_handler(),
		}];
		let manifest = build_manifest(&[], &[], &[], &uploads, BTreeMap::new(), &ContextConfig::new());
		let json = serde_json::to_value(&manifest).unwrap();
		assert_eq!(json["procedures"]["echoUpload"]["kind"], "upload");
		assert!(json["procedures"]["echoUpload"]["output"].is_object());
		assert!(json["procedures"]["echoUpload"].get("chunkOutput").is_none());
	}

	#[test]
	fn suppress_propagated() {
		let procs = vec![ProcedureDef {
			name: "warned".to_string(),
			proc_type: ProcedureType::Query,
			input_schema: serde_json::json!({}),
			output_schema: serde_json::json!({}),
			error_schema: None,
			context_keys: vec![],
			suppress: Some(vec!["unused".to_string()]),
			cache: None,
			handler: dummy_handler(),
		}];
		let manifest = build_manifest(&procs, &[], &[], &[], BTreeMap::new(), &ContextConfig::new());
		let json = serde_json::to_value(&manifest).unwrap();
		let suppress = json["procedures"]["warned"]["suppress"].as_array().unwrap();
		assert_eq!(suppress, &[serde_json::json!("unused")]);
	}

	#[test]
	fn suppress_omitted_when_none() {
		let procs = vec![ProcedureDef {
			name: "clean".to_string(),
			proc_type: ProcedureType::Query,
			input_schema: serde_json::json!({}),
			output_schema: serde_json::json!({}),
			error_schema: None,
			context_keys: vec![],
			suppress: None,
			cache: None,
			handler: dummy_handler(),
		}];
		let manifest = build_manifest(&procs, &[], &[], &[], BTreeMap::new(), &ContextConfig::new());
		let json = serde_json::to_value(&manifest).unwrap();
		assert!(json["procedures"]["clean"].get("suppress").is_none());
	}

	#[test]
	fn cache_ttl_propagated() {
		let procs = vec![ProcedureDef {
			name: "cached".to_string(),
			proc_type: ProcedureType::Query,
			input_schema: serde_json::json!({}),
			output_schema: serde_json::json!({}),
			error_schema: None,
			context_keys: vec![],
			suppress: None,
			cache: Some(serde_json::json!({"ttl": 30})),
			handler: dummy_handler(),
		}];
		let manifest = build_manifest(&procs, &[], &[], &[], BTreeMap::new(), &ContextConfig::new());
		let json = serde_json::to_value(&manifest).unwrap();
		assert_eq!(json["procedures"]["cached"]["cache"]["ttl"], 30);
	}

	#[test]
	fn cache_false_propagated() {
		let procs = vec![ProcedureDef {
			name: "nocache".to_string(),
			proc_type: ProcedureType::Query,
			input_schema: serde_json::json!({}),
			output_schema: serde_json::json!({}),
			error_schema: None,
			context_keys: vec![],
			suppress: None,
			cache: Some(serde_json::json!(false)),
			handler: dummy_handler(),
		}];
		let manifest = build_manifest(&procs, &[], &[], &[], BTreeMap::new(), &ContextConfig::new());
		let json = serde_json::to_value(&manifest).unwrap();
		assert_eq!(json["procedures"]["nocache"]["cache"], false);
	}

	#[test]
	fn cache_omitted_when_none() {
		let procs = vec![ProcedureDef {
			name: "default".to_string(),
			proc_type: ProcedureType::Query,
			input_schema: serde_json::json!({}),
			output_schema: serde_json::json!({}),
			error_schema: None,
			context_keys: vec![],
			suppress: None,
			cache: None,
			handler: dummy_handler(),
		}];
		let manifest = build_manifest(&procs, &[], &[], &[], BTreeMap::new(), &ContextConfig::new());
		let json = serde_json::to_value(&manifest).unwrap();
		assert!(json["procedures"]["default"].get("cache").is_none());
	}
}
