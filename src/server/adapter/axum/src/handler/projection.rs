/* src/server/adapter/axum/src/handler/projection.rs */

use std::collections::HashMap;

use serde_json::Value;

/// Prune loader data to only include projected fields.
/// None projections = keep all data.
pub(super) fn apply_projection(
	data: &mut serde_json::Map<String, Value>,
	projections: &Option<HashMap<String, Vec<String>>>,
) {
	let Some(proj) = projections else { return };
	if proj.is_empty() {
		return;
	}

	let keys: Vec<String> = data.keys().cloned().collect();
	for key in keys {
		let Some(fields) = proj.get(&key) else {
			// No projection for this key — keep full value
			continue;
		};
		if let Some(value) = data.remove(&key) {
			data.insert(key, prune_value(value, fields));
		}
	}
}

fn prune_value(value: Value, fields: &[String]) -> Value {
	let mut array_fields = Vec::new();
	let mut plain_fields = Vec::new();

	for f in fields {
		if f == "$" {
			// Standalone $ = keep entire array elements
			return value;
		} else if let Some(rest) = f.strip_prefix("$.") {
			array_fields.push(rest);
		} else {
			plain_fields.push(f.as_str());
		}
	}

	if !array_fields.is_empty()
		&& let Value::Array(arr) = value
	{
		let pruned: Vec<Value> = arr
			.into_iter()
			.map(|item| match item {
				Value::Object(map) => Value::Object(pick_fields(&map, &array_fields)),
				other => other,
			})
			.collect();
		return Value::Array(pruned);
	}

	if !plain_fields.is_empty()
		&& let Value::Object(map) = value
	{
		return Value::Object(pick_fields(&map, &plain_fields));
	}

	value
}

fn pick_fields(
	source: &serde_json::Map<String, Value>,
	fields: &[&str],
) -> serde_json::Map<String, Value> {
	let mut result = serde_json::Map::new();
	for &field in fields {
		if let Some(val) = get_nested(source, field) {
			set_nested(&mut result, field, val);
		}
	}
	result
}

fn get_nested(source: &serde_json::Map<String, Value>, path: &str) -> Option<Value> {
	let mut current: &Value = &Value::Object(source.clone());
	for part in path.split('.') {
		match current {
			Value::Object(map) => {
				current = map.get(part)?;
			}
			_ => return None,
		}
	}
	Some(current.clone())
}

fn set_nested(target: &mut serde_json::Map<String, Value>, path: &str, value: Value) {
	let parts: Vec<&str> = path.split('.').collect();
	let mut current = target;
	for &part in &parts[..parts.len() - 1] {
		let entry =
			current.entry(part.to_string()).or_insert_with(|| Value::Object(Default::default()));
		if let Value::Object(map) = entry {
			current = map;
		} else {
			return;
		}
	}
	if let Some(last) = parts.last() {
		current.insert((*last).to_string(), value);
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;

	#[test]
	fn basic_prune() {
		let mut data = serde_json::Map::new();
		data.insert("user".into(), json!({"name": "Alice", "email": "a@b", "age": 30}));
		let proj = Some(HashMap::from([("user".to_string(), vec!["name".into(), "email".into()])]));

		apply_projection(&mut data, &proj);

		let user = data["user"].as_object().unwrap();
		assert!(user.contains_key("name"));
		assert!(user.contains_key("email"));
		assert!(!user.contains_key("age"));
	}

	#[test]
	fn array_fields() {
		let mut data = serde_json::Map::new();
		data
			.insert("repos".into(), json!([{"title": "A", "desc": ".."}, {"title": "B", "desc": ".."}]));
		let proj = Some(HashMap::from([("repos".to_string(), vec!["$.title".into()])]));

		apply_projection(&mut data, &proj);

		let repos = data["repos"].as_array().unwrap();
		assert_eq!(repos.len(), 2);
		assert!(repos[0].as_object().unwrap().contains_key("title"));
		assert!(!repos[0].as_object().unwrap().contains_key("desc"));
	}

	#[test]
	fn none_passthrough() {
		let mut data = serde_json::Map::new();
		data.insert("user".into(), json!("full data"));

		apply_projection(&mut data, &None);
		assert_eq!(data["user"], json!("full data"));
	}

	#[test]
	fn missing_key_passthrough() {
		let mut data = serde_json::Map::new();
		data.insert("user".into(), json!({"name": "Alice", "age": 30}));
		data.insert("theme".into(), json!("dark"));
		let proj = Some(HashMap::from([("user".to_string(), vec!["name".into()])]));

		apply_projection(&mut data, &proj);

		assert_eq!(data["theme"], json!("dark"));
		assert!(!data["user"].as_object().unwrap().contains_key("age"));
	}
}
