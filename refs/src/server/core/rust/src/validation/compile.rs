/* src/server/core/rust/src/validation/compile.rs */

use serde_json::{Map, Value};

use super::{CompiledSchema, JtdType};

pub(super) fn parse_jtd_type(s: &str) -> Result<JtdType, String> {
	match s {
		"boolean" => Ok(JtdType::Boolean),
		"string" => Ok(JtdType::String),
		"timestamp" => Ok(JtdType::Timestamp),
		"int8" => Ok(JtdType::Int8),
		"int16" => Ok(JtdType::Int16),
		"int32" => Ok(JtdType::Int32),
		"uint8" => Ok(JtdType::Uint8),
		"uint16" => Ok(JtdType::Uint16),
		"uint32" => Ok(JtdType::Uint32),
		"float32" => Ok(JtdType::Float32),
		"float64" => Ok(JtdType::Float64),
		other => Err(format!("unknown JTD type: {other}")),
	}
}

pub(super) fn compile_inner(
	schema: &Value,
	defs: &Map<String, Value>,
) -> Result<CompiledSchema, String> {
	let obj = schema.as_object().ok_or_else(|| "schema must be an object".to_string())?;

	// Handle nullable wrapper
	let nullable = obj.get("nullable").and_then(Value::as_bool).unwrap_or(false);

	// Handle ref
	if let Some(ref_name) = obj.get("ref").and_then(Value::as_str) {
		let def = defs.get(ref_name).ok_or_else(|| format!("undefined ref: {ref_name}"))?;
		let inner = compile_inner(def, defs)?;
		return if nullable { Ok(CompiledSchema::Nullable(Box::new(inner))) } else { Ok(inner) };
	}

	let inner = if let Some(type_val) = obj.get("type").and_then(Value::as_str) {
		CompiledSchema::Type(parse_jtd_type(type_val)?)
	} else if let Some(enum_val) = obj.get("enum") {
		let arr = enum_val.as_array().ok_or_else(|| "enum must be an array".to_string())?;
		let variants = arr
			.iter()
			.map(|v| {
				v.as_str().map(String::from).ok_or_else(|| "enum values must be strings".to_string())
			})
			.collect::<Result<Vec<_>, _>>()?;
		CompiledSchema::Enum(variants)
	} else if let Some(elements_val) = obj.get("elements") {
		CompiledSchema::Elements(Box::new(compile_inner(elements_val, defs)?))
	} else if let Some(values_val) = obj.get("values") {
		CompiledSchema::Values(Box::new(compile_inner(values_val, defs)?))
	} else if obj.contains_key("properties") || obj.contains_key("optionalProperties") {
		let mut required = Vec::new();
		let mut optional = Vec::new();

		if let Some(props) = obj.get("properties").and_then(Value::as_object) {
			for (key, val) in props {
				required.push((key.clone(), compile_inner(val, defs)?));
			}
		}
		if let Some(props) = obj.get("optionalProperties").and_then(Value::as_object) {
			for (key, val) in props {
				optional.push((key.clone(), compile_inner(val, defs)?));
			}
		}

		let allow_extra = obj.get("additionalProperties").and_then(Value::as_bool).unwrap_or(false);

		CompiledSchema::Properties { required, optional, allow_extra }
	} else if let Some(disc_val) = obj.get("discriminator").and_then(Value::as_str) {
		let mapping_obj = obj
			.get("mapping")
			.and_then(Value::as_object)
			.ok_or_else(|| "discriminator requires mapping".to_string())?;
		let mut mapping = Vec::new();
		for (key, val) in mapping_obj {
			mapping.push((key.clone(), compile_inner(val, defs)?));
		}
		CompiledSchema::Discriminator { tag: disc_val.to_string(), mapping }
	} else {
		CompiledSchema::Empty
	};

	if nullable { Ok(CompiledSchema::Nullable(Box::new(inner))) } else { Ok(inner) }
}

/// Compile a JTD schema JSON value into a `CompiledSchema` for fast validation.
pub fn compile_schema(schema: &Value) -> Result<CompiledSchema, String> {
	let defs = schema.get("definitions").and_then(Value::as_object).cloned().unwrap_or_default();
	compile_inner(schema, &defs)
}
