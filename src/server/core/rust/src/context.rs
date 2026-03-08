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

/// Check whether any context fields are defined.
pub fn context_has_extracts(config: &ContextConfig) -> bool {
	!config.is_empty()
}

/// Parse a Cookie header into key-value pairs.
pub fn parse_cookie_header(header: &str) -> Vec<(&str, &str)> {
	header
		.split(';')
		.filter_map(|pair| {
			let pair = pair.trim();
			let idx = pair.find('=')?;
			if idx == 0 {
				return None;
			}
			Some((&pair[..idx], &pair[idx + 1..]))
		})
		.collect()
}

/// Build a RawContextMap keyed by config key from request headers, cookies, and query string.
pub fn extract_raw_context(
	config: &ContextConfig,
	headers: &[(String, String)],
	cookie_header: Option<&str>,
	query_string: Option<&str>,
) -> RawContextMap {
	let mut raw = RawContextMap::new();
	let mut cookie_cache: Option<Vec<(&str, &str)>> = None;

	for (ctx_key, field) in config {
		let Ok((source, extract_key)) = parse_extract_rule(&field.extract) else {
			raw.insert(ctx_key.clone(), None);
			continue;
		};
		let value = match source {
			"header" => {
				let lower = extract_key.to_lowercase();
				headers.iter().find(|(k, _)| k == &lower).map(|(_, v)| v.clone())
			}
			"cookie" => {
				let cookies =
					cookie_cache.get_or_insert_with(|| parse_cookie_header(cookie_header.unwrap_or("")));
				cookies.iter().find(|(k, _)| *k == extract_key).map(|(_, v)| (*v).to_string())
			}
			"query" => query_string.and_then(|qs| form_urlencoded_get(qs, extract_key)),
			_ => None,
		};
		raw.insert(ctx_key.clone(), value);
	}
	raw
}

/// Simple query string parameter lookup without pulling in the `url` crate.
fn form_urlencoded_get(qs: &str, key: &str) -> Option<String> {
	for pair in qs.split('&') {
		if let Some((k, v)) = pair.split_once('=') {
			if k == key {
				return Some(v.to_string());
			}
		} else if pair == key {
			return Some(String::new());
		}
	}
	None
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
		let Some(_field_def) = config.get(key) else {
			ctx.insert(key.clone(), Value::Null);
			continue;
		};

		match raw.get(key) {
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
	fn context_has_extracts_true() {
		let mut config = ContextConfig::new();
		config.insert(
			"token".into(),
			ContextFieldDef {
				extract: "header:Authorization".into(),
				schema: serde_json::json!({"type": "string"}),
			},
		);
		assert!(context_has_extracts(&config));
	}

	#[test]
	fn context_has_extracts_false() {
		assert!(!context_has_extracts(&ContextConfig::new()));
	}

	#[test]
	fn parse_cookie_header_basic() {
		let cookies = parse_cookie_header("session=abc; lang=en");
		assert_eq!(cookies.len(), 2);
		assert!(cookies.contains(&("session", "abc")));
		assert!(cookies.contains(&("lang", "en")));
	}

	#[test]
	fn parse_cookie_header_empty() {
		let cookies = parse_cookie_header("");
		assert!(cookies.is_empty());
	}

	#[test]
	fn extract_raw_context_header() {
		let mut config = ContextConfig::new();
		config.insert(
			"token".into(),
			ContextFieldDef {
				extract: "header:authorization".into(),
				schema: serde_json::json!({"type": "string"}),
			},
		);
		let headers = vec![("authorization".into(), "Bearer abc".into())];
		let raw = extract_raw_context(&config, &headers, None, None);
		assert_eq!(raw["token"], Some("Bearer abc".into()));
	}

	#[test]
	fn extract_raw_context_cookie() {
		let mut config = ContextConfig::new();
		config.insert(
			"session".into(),
			ContextFieldDef {
				extract: "cookie:sid".into(),
				schema: serde_json::json!({"type": "string"}),
			},
		);
		let raw = extract_raw_context(&config, &[], Some("sid=abc123; other=x"), None);
		assert_eq!(raw["session"], Some("abc123".into()));
	}

	#[test]
	fn extract_raw_context_query() {
		let mut config = ContextConfig::new();
		config.insert(
			"lang".into(),
			ContextFieldDef {
				extract: "query:lang".into(),
				schema: serde_json::json!({"type": "string"}),
			},
		);
		let raw = extract_raw_context(&config, &[], None, Some("lang=en&foo=bar"));
		assert_eq!(raw["lang"], Some("en".into()));
	}

	#[test]
	fn extract_raw_context_missing_returns_none() {
		let mut config = ContextConfig::new();
		config.insert(
			"session".into(),
			ContextFieldDef {
				extract: "cookie:sid".into(),
				schema: serde_json::json!({"type": "string"}),
			},
		);
		config.insert(
			"lang".into(),
			ContextFieldDef {
				extract: "query:lang".into(),
				schema: serde_json::json!({"type": "string"}),
			},
		);
		let raw = extract_raw_context(&config, &[], None, None);
		assert_eq!(raw["session"], None);
		assert_eq!(raw["lang"], None);
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
		raw.insert("token".into(), Some("Bearer abc".into()));

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
