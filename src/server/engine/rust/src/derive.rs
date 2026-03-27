/* src/server/engine/rust/src/derive.rs */

//! Execute derive functions via embedded QuickJS runtime.
//!
//! Each derive entry declares `sources` (loader keys) and `fn` (JS function source).
//! This module evaluates the function with the corresponding loader data as arguments
//! and returns all derive results as a JSON object.

use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Deserialize)]
struct DeriveEntry {
	sources: Vec<String>,
	#[serde(rename = "fn")]
	fn_source: String,
}

/// Execute all derive definitions against loader data, returning a JSON object
/// with derive results keyed by derive name.
///
/// # Arguments
/// * `derives_json` - JSON object mapping derive names to `{sources, fn}` entries
/// * `loader_data_json` - JSON object with loader results keyed by loader name
///
/// # Returns
/// JSON string like `{"repoStats":{"totalStars":142}}`
pub fn execute_derives(derives_json: &str, loader_data_json: &str) -> Result<String, String> {
	let derives: BTreeMap<String, DeriveEntry> =
		serde_json::from_str(derives_json).map_err(|e| format!("invalid derives JSON: {e}"))?;

	if derives.is_empty() {
		return Ok("{}".to_string());
	}

	let loader_data: serde_json::Value =
		serde_json::from_str(loader_data_json).map_err(|e| format!("invalid loader data: {e}"))?;

	let rt = rquickjs::Runtime::new().map_err(|e| format!("QuickJS runtime init: {e}"))?;
	let ctx = rquickjs::Context::full(&rt).map_err(|e| format!("QuickJS context init: {e}"))?;

	let mut results = serde_json::Map::new();

	for (key, entry) in &derives {
		let args: Vec<String> = entry
			.sources
			.iter()
			.map(|src| loader_data.get(src).map_or_else(|| "null".to_string(), ToString::to_string))
			.collect();

		let args_str = args.join(",");
		// Wrap in parens to handle arrow functions, ?? null for undefined safety
		let expr = format!("JSON.stringify(({})({}) ?? null)", entry.fn_source, args_str);

		let result_json: String = ctx.with(|ctx| {
			let js_str = ctx
				.eval::<rquickjs::String, _>(expr.as_bytes())
				.map_err(|e| format!("derive \"{key}\" execution failed: {e}"))?;
			js_str.to_string().map_err(|e| format!("derive \"{key}\" result encoding: {e}"))
		})?;

		let value: serde_json::Value = serde_json::from_str(&result_json)
			.map_err(|e| format!("derive \"{key}\" returned invalid JSON: {e}"))?;

		results.insert(key.clone(), value);
	}

	serde_json::to_string(&serde_json::Value::Object(results))
		.map_err(|e| format!("derive results serialization: {e}"))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn array_length() {
		let derives = serde_json::json!({
			"count": {
				"sources": ["repos"],
				"fn": "(repos) => repos.length"
			}
		});
		let data = serde_json::json!({
			"repos": [{"name": "a"}, {"name": "b"}, {"name": "c"}]
		});

		let result = execute_derives(&derives.to_string(), &data.to_string());
		assert!(result.is_ok(), "execute_derives failed: {:?}", result.err());

		let parsed: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
		assert_eq!(parsed["count"], 3);
	}

	#[test]
	fn reduce_sum() {
		let derives = serde_json::json!({
			"repoStats": {
				"sources": ["user", "repos"],
				"fn": "(_user, repos) => ({ totalStars: repos.reduce((s, r) => s + r.stars, 0) })"
			}
		});
		let data = serde_json::json!({
			"user": {"login": "octocat"},
			"repos": [{"stars": 100}, {"stars": 42}]
		});

		let result = execute_derives(&derives.to_string(), &data.to_string()).unwrap();
		let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
		assert_eq!(parsed["repoStats"]["totalStars"], 142);
	}

	#[test]
	fn missing_source_passes_null() {
		let derives = serde_json::json!({
			"check": {
				"sources": ["missing"],
				"fn": "(x) => x === null"
			}
		});
		let data = serde_json::json!({});

		let result = execute_derives(&derives.to_string(), &data.to_string()).unwrap();
		let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
		assert_eq!(parsed["check"], true);
	}

	#[test]
	fn multiple_derives() {
		let derives = serde_json::json!({
			"total": {
				"sources": ["nums"],
				"fn": "(nums) => nums.reduce((a, b) => a + b, 0)"
			},
			"count": {
				"sources": ["nums"],
				"fn": "(nums) => nums.length"
			}
		});
		let data = serde_json::json!({ "nums": [1, 2, 3, 4, 5] });

		let result = execute_derives(&derives.to_string(), &data.to_string()).unwrap();
		let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
		assert_eq!(parsed["total"], 15);
		assert_eq!(parsed["count"], 5);
	}

	#[test]
	fn empty_derives() {
		let result = execute_derives("{}", r#"{"x": 1}"#).unwrap();
		assert_eq!(result, "{}");
	}

	#[test]
	fn js_error_returns_err() {
		let derives = serde_json::json!({
			"bad": {
				"sources": [],
				"fn": "() => { throw new Error('boom') }"
			}
		});

		let result = execute_derives(&derives.to_string(), "{}");
		assert!(result.is_err());
		assert!(result.unwrap_err().contains("bad"));
	}
}
