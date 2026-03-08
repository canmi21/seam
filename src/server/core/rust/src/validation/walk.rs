/* src/server/core/rust/src/validation/walk.rs */

use serde_json::Value;

use super::CompiledSchema;
use super::check::{ValidateCtx, validate_type, value_description};

pub(super) fn validate_walk(
	schema: &CompiledSchema,
	data: &Value,
	path: &str,
	ctx: &mut ValidateCtx<'_>,
	depth: usize,
	exclude_key: Option<&str>,
) {
	if ctx.full() {
		return;
	}
	if depth > ctx.max_depth {
		ctx.push(path, "depth <= max", format!("depth {depth} exceeds max {}", ctx.max_depth));
		return;
	}

	match schema {
		CompiledSchema::Empty => {}

		CompiledSchema::Nullable(inner) => {
			if !data.is_null() {
				validate_walk(inner, data, path, ctx, depth + 1, None);
			}
		}

		CompiledSchema::Type(jtd_type) => validate_type(jtd_type, data, path, ctx),

		CompiledSchema::Enum(variants) => {
			if let Some(s) = data.as_str() {
				if !variants.iter().any(|v| v == s) {
					ctx.push(path, format!("one of [{}]", variants.join(", ")), format!("string \"{s}\""));
				}
			} else {
				ctx.push(path, "string (enum)", value_description(data));
			}
		}

		CompiledSchema::Elements(inner) => {
			if let Some(arr) = data.as_array() {
				for (i, item) in arr.iter().enumerate() {
					if ctx.full() {
						break;
					}
					validate_walk(inner, item, &format!("{path}/{i}"), ctx, depth + 1, None);
				}
			} else {
				ctx.push(path, "array", value_description(data));
			}
		}

		CompiledSchema::Values(inner) => {
			if let Some(obj) = data.as_object() {
				for (key, val) in obj {
					if ctx.full() {
						break;
					}
					validate_walk(inner, val, &format!("{path}/{key}"), ctx, depth + 1, None);
				}
			} else {
				ctx.push(path, "object", value_description(data));
			}
		}

		CompiledSchema::Properties { required, optional, allow_extra } => {
			validate_properties(required, optional, *allow_extra, data, path, ctx, depth, exclude_key);
		}

		CompiledSchema::Discriminator { tag, mapping } => {
			validate_discriminator(tag, mapping, data, path, ctx, depth);
		}
	}
}

#[allow(clippy::too_many_arguments)]
pub(super) fn validate_properties(
	required: &[(String, CompiledSchema)],
	optional: &[(String, CompiledSchema)],
	allow_extra: bool,
	data: &Value,
	path: &str,
	ctx: &mut ValidateCtx<'_>,
	depth: usize,
	exclude_key: Option<&str>,
) {
	let Some(obj) = data.as_object() else {
		ctx.push(path, "object", value_description(data));
		return;
	};

	for (key, schema) in required {
		if ctx.full() {
			break;
		}
		match obj.get(key) {
			Some(val) => {
				validate_walk(schema, val, &format!("{path}/{key}"), ctx, depth + 1, None);
			}
			None => ctx.push(&format!("{path}/{key}"), "required property", "missing"),
		}
	}

	for (key, schema) in optional {
		if ctx.full() {
			break;
		}
		if let Some(val) = obj.get(key) {
			validate_walk(schema, val, &format!("{path}/{key}"), ctx, depth + 1, None);
		}
	}

	if !allow_extra {
		for key in obj.keys() {
			if ctx.full() {
				break;
			}
			let is_known = required.iter().any(|(k, _)| k == key)
				|| optional.iter().any(|(k, _)| k == key)
				|| exclude_key == Some(key.as_str());
			if !is_known {
				ctx.push(
					&format!("{path}/{key}"),
					"no extra properties",
					format!("unexpected property \"{key}\""),
				);
			}
		}
	}
}

pub(super) fn validate_discriminator(
	tag: &str,
	mapping: &[(String, CompiledSchema)],
	data: &Value,
	path: &str,
	ctx: &mut ValidateCtx<'_>,
	depth: usize,
) {
	let Some(obj) = data.as_object() else {
		ctx.push(path, "object", value_description(data));
		return;
	};

	match obj.get(tag).and_then(Value::as_str) {
		Some(tag_value) => {
			if let Some((_, branch_schema)) = mapping.iter().find(|(k, _)| k == tag_value) {
				// JTD spec: tag key is implicitly allowed in the branch schema
				validate_walk(branch_schema, data, path, ctx, depth + 1, Some(tag));
			} else {
				let expected = format!(
					"one of [{}]",
					mapping.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>().join(", ")
				);
				ctx.push(&format!("{path}/{tag}"), expected, format!("string \"{tag_value}\""));
			}
		}
		None => {
			let actual =
				if obj.contains_key(tag) { value_description(&obj[tag]) } else { "missing".into() };
			ctx.push(&format!("{path}/{tag}"), format!("string (discriminator tag \"{tag}\")"), actual);
		}
	}
}
