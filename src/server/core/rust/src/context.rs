/* src/server/core/rust/src/context.rs */

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::errors::SeamError;

/// Definition for a single context field: where to extract it and its schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextFieldDef {
	pub extract: String,
	pub schema: Value,
}

/// Map of context key -> field definition.
pub type ContextConfig = BTreeMap<String, ContextFieldDef>;

/// Raw extracted values from HTTP request (e.g. headers).
/// `None` means the source was not present.
pub type RawContextMap = BTreeMap<String, Option<String>>;

/// Parse an extract rule like "header:authorization" into (source, key).
pub fn parse_extract_rule(rule: &str) -> Result<(&str, &str), SeamError> {
	rule
		.split_once(':')
		.ok_or_else(|| SeamError::context_error(format!("Invalid extract rule: '{rule}'")))
}

/// Collect all HTTP header names that need extraction from context config.
/// Deduplicates and returns lowercase header names.
pub fn context_extract_keys(config: &ContextConfig) -> Vec<String> {
	let mut keys = Vec::new();
	let mut seen = std::collections::HashSet::new();
	for field in config.values() {
		if let Ok(("header", header_name)) = parse_extract_rule(&field.extract) {
			let lower = header_name.to_lowercase();
			if seen.insert(lower.clone()) {
				keys.push(lower);
			}
		}
	}
	keys
}

/// Resolve context values from raw extracted data for the given requested keys.
/// Returns a JSON object with the requested context fields.
pub fn resolve_context(
	config: &ContextConfig,
	raw: &RawContextMap,
	requested_keys: &[String],
) -> Result<Value, SeamError> {
	let mut ctx = serde_json::Map::new();

	for key in requested_keys {
		let Some(field_def) = config.get(key) else {
			ctx.insert(key.clone(), Value::Null);
			continue;
		};

		let (_source, header_name) = parse_extract_rule(&field_def.extract)?;
		let lower = header_name.to_lowercase();

		match raw.get(&lower) {
			Some(Some(value)) => {
				// Try JSON parse for complex types, fallback to string
				let parsed = serde_json::from_str(value).unwrap_or(Value::String(value.clone()));
				ctx.insert(key.clone(), parsed);
			}
			_ => {
				ctx.insert(key.clone(), Value::Null);
			}
		}
	}

	Ok(Value::Object(ctx))
}

/// Extract property key names from a JTD schema's `properties` field.
pub fn context_keys_from_schema(schema: &Value) -> Vec<String> {
	schema
		.get("properties")
		.and_then(|p| p.as_object())
		.map(|obj| obj.keys().cloned().collect())
		.unwrap_or_default()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parse_extract_rule_valid() {
		let (source, key) = parse_extract_rule("header:authorization").unwrap();
		assert_eq!(source, "header");
		assert_eq!(key, "authorization");
	}

	#[test]
	fn parse_extract_rule_invalid() {
		assert!(parse_extract_rule("no-colon").is_err());
	}

	#[test]
	fn context_extract_keys_deduplicates() {
		let mut config = ContextConfig::new();
		config.insert(
			"token".into(),
			ContextFieldDef {
				extract: "header:Authorization".into(),
				schema: serde_json::json!({"type": "string"}),
			},
		);
		config.insert(
			"auth".into(),
			ContextFieldDef {
				extract: "header:Authorization".into(),
				schema: serde_json::json!({"type": "string"}),
			},
		);
		let keys = context_extract_keys(&config);
		assert_eq!(keys.len(), 1);
		assert_eq!(keys[0], "authorization");
	}

	#[test]
	fn resolve_context_string_value() {
		let mut config = ContextConfig::new();
		config.insert(
			"token".into(),
			ContextFieldDef {
				extract: "header:authorization".into(),
				schema: serde_json::json!({"type": "string"}),
			},
		);
		let mut raw = RawContextMap::new();
		raw.insert("authorization".into(), Some("Bearer abc".into()));

		let ctx = resolve_context(&config, &raw, &["token".into()]).unwrap();
		assert_eq!(ctx["token"], "Bearer abc");
	}

	#[test]
	fn resolve_context_null_value() {
		let mut config = ContextConfig::new();
		config.insert(
			"token".into(),
			ContextFieldDef {
				extract: "header:authorization".into(),
				schema: serde_json::json!({"type": "string"}),
			},
		);
		let raw = RawContextMap::new();

		let ctx = resolve_context(&config, &raw, &["token".into()]).unwrap();
		assert_eq!(ctx["token"], Value::Null);
	}

	#[test]
	fn resolve_context_undefined_key() {
		let config = ContextConfig::new();
		let raw = RawContextMap::new();

		let ctx = resolve_context(&config, &raw, &["missing".into()]).unwrap();
		assert_eq!(ctx["missing"], Value::Null);
	}

	#[test]
	fn context_keys_from_schema_extracts_properties() {
		let schema = serde_json::json!({
			"properties": {
				"token": {"type": "string"},
				"userId": {"type": "string"}
			}
		});
		let mut keys = context_keys_from_schema(&schema);
		keys.sort();
		assert_eq!(keys, vec!["token", "userId"]);
	}

	#[test]
	fn context_keys_from_schema_empty() {
		let schema = serde_json::json!({"type": "string"});
		let keys = context_keys_from_schema(&schema);
		assert!(keys.is_empty());
	}
}
