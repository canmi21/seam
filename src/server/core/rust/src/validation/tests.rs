/* src/server/core/rust/src/validation/tests.rs */

use super::*;
use serde_json::json;

// -- empty schema --

#[test]
fn empty_schema_accepts_anything() {
	assert!(validate_input(&json!({}), &json!(42)).is_ok());
	assert!(validate_input(&json!({}), &json!("hello")).is_ok());
	assert!(validate_input(&json!({}), &json!(null)).is_ok());
	assert!(validate_input(&json!({}), &json!([1, 2])).is_ok());
	assert!(validate_input(&json!({}), &json!({"a": 1})).is_ok());
}

// -- string type --

#[test]
fn string_type_accepts_string() {
	assert!(validate_input(&json!({"type": "string"}), &json!("hello")).is_ok());
}

#[test]
fn string_type_rejects_number() {
	assert!(validate_input(&json!({"type": "string"}), &json!(42)).is_err());
}

// -- boolean type --

#[test]
fn boolean_type_accepts_bool() {
	assert!(validate_input(&json!({"type": "boolean"}), &json!(true)).is_ok());
	assert!(validate_input(&json!({"type": "boolean"}), &json!(false)).is_ok());
}

#[test]
fn boolean_type_rejects_string() {
	assert!(validate_input(&json!({"type": "boolean"}), &json!("true")).is_err());
}

// -- int32 --

#[test]
fn int32_accepts_valid() {
	assert!(validate_input(&json!({"type": "int32"}), &json!(42)).is_ok());
	assert!(validate_input(&json!({"type": "int32"}), &json!(-1)).is_ok());
	assert!(validate_input(&json!({"type": "int32"}), &json!(0)).is_ok());
}

#[test]
fn int32_rejects_out_of_range() {
	let result = validate_input(&json!({"type": "int32"}), &json!(2_147_483_648_i64));
	assert!(result.is_err());
}

#[test]
fn int32_rejects_float() {
	let result = validate_input(&json!({"type": "int32"}), &json!(1.5));
	assert!(result.is_err());
}

#[test]
fn int32_rejects_string() {
	let result = validate_input(&json!({"type": "int32"}), &json!("hello"));
	assert!(result.is_err());
}

// -- uint8 --

#[test]
fn uint8_accepts_valid_range() {
	assert!(validate_input(&json!({"type": "uint8"}), &json!(0)).is_ok());
	assert!(validate_input(&json!({"type": "uint8"}), &json!(255)).is_ok());
	assert!(validate_input(&json!({"type": "uint8"}), &json!(128)).is_ok());
}

#[test]
fn uint8_rejects_negative() {
	assert!(validate_input(&json!({"type": "uint8"}), &json!(-1)).is_err());
}

#[test]
fn uint8_rejects_over_255() {
	assert!(validate_input(&json!({"type": "uint8"}), &json!(256)).is_err());
}

// -- int8 --

#[test]
fn int8_accepts_valid_range() {
	assert!(validate_input(&json!({"type": "int8"}), &json!(-128)).is_ok());
	assert!(validate_input(&json!({"type": "int8"}), &json!(127)).is_ok());
}

#[test]
fn int8_rejects_out_of_range() {
	assert!(validate_input(&json!({"type": "int8"}), &json!(128)).is_err());
	assert!(validate_input(&json!({"type": "int8"}), &json!(-129)).is_err());
}

// -- float64 --

#[test]
fn float64_accepts_any_number() {
	assert!(validate_input(&json!({"type": "float64"}), &json!(3.125)).is_ok());
	assert!(validate_input(&json!({"type": "float64"}), &json!(42)).is_ok());
	assert!(validate_input(&json!({"type": "float64"}), &json!(-0.001)).is_ok());
}

#[test]
fn float64_rejects_non_number() {
	assert!(validate_input(&json!({"type": "float64"}), &json!("3.14")).is_err());
}

// -- timestamp --

#[test]
fn timestamp_accepts_rfc3339() {
	assert!(validate_input(&json!({"type": "timestamp"}), &json!("2024-01-15T10:30:00Z")).is_ok());
}

#[test]
fn timestamp_rejects_invalid() {
	let result = validate_input(&json!({"type": "timestamp"}), &json!("not-a-date"));
	assert!(result.is_err());
}

// -- enum --

#[test]
fn enum_accepts_valid_value() {
	let schema = json!({"enum": ["red", "green", "blue"]});
	assert!(validate_input(&schema, &json!("red")).is_ok());
	assert!(validate_input(&schema, &json!("blue")).is_ok());
}

#[test]
fn enum_rejects_invalid_value() {
	let schema = json!({"enum": ["red", "green", "blue"]});
	let result = validate_input(&schema, &json!("yellow"));
	assert!(result.is_err());
	let Err((_, details)) = result else { unreachable!() };
	assert!(details[0].expected.contains("red"));
}

// -- elements --

#[test]
fn elements_validates_array_items() {
	let schema = json!({"elements": {"type": "string"}});
	assert!(validate_input(&schema, &json!(["a", "b", "c"])).is_ok());
	assert!(validate_input(&schema, &json!([])).is_ok());
}

#[test]
fn elements_rejects_invalid_items() {
	let schema = json!({"elements": {"type": "string"}});
	let result = validate_input(&schema, &json!(["a", 42, "c"]));
	assert!(result.is_err());
	let Err((_, details)) = result else { unreachable!() };
	assert_eq!(details[0].path, "/1");
}

#[test]
fn elements_rejects_non_array() {
	let schema = json!({"elements": {"type": "string"}});
	assert!(validate_input(&schema, &json!("not an array")).is_err());
}

// -- values --

#[test]
fn values_validates_object_values() {
	let schema = json!({"values": {"type": "int32"}});
	assert!(validate_input(&schema, &json!({"a": 1, "b": 2})).is_ok());
}

#[test]
fn values_rejects_invalid_values() {
	let schema = json!({"values": {"type": "int32"}});
	assert!(validate_input(&schema, &json!({"a": 1, "b": "nope"})).is_err());
}

// -- properties --

#[test]
fn properties_required_present() {
	let schema = json!({
		"properties": {
			"name": {"type": "string"},
			"age": {"type": "int32"}
		}
	});
	assert!(validate_input(&schema, &json!({"name": "Alice", "age": 30})).is_ok());
}

#[test]
fn properties_required_missing() {
	let schema = json!({
		"properties": {
			"name": {"type": "string"},
			"age": {"type": "int32"}
		}
	});
	let result = validate_input(&schema, &json!({"name": "Alice"}));
	assert!(result.is_err());
	let Err((_, details)) = result else { unreachable!() };
	assert!(details.iter().any(|d| d.path == "/age" && d.actual == "missing"));
}

#[test]
fn properties_optional_present() {
	let schema = json!({
		"properties": {"name": {"type": "string"}},
		"optionalProperties": {"age": {"type": "int32"}}
	});
	assert!(validate_input(&schema, &json!({"name": "Alice", "age": 30})).is_ok());
}

#[test]
fn properties_optional_absent() {
	let schema = json!({
		"properties": {"name": {"type": "string"}},
		"optionalProperties": {"age": {"type": "int32"}}
	});
	assert!(validate_input(&schema, &json!({"name": "Alice"})).is_ok());
}

#[test]
fn properties_allow_extra() {
	let schema = json!({
		"properties": {"name": {"type": "string"}},
		"additionalProperties": true
	});
	assert!(validate_input(&schema, &json!({"name": "Alice", "extra": 42})).is_ok());
}

#[test]
fn properties_reject_extra() {
	let schema = json!({
		"properties": {"name": {"type": "string"}}
	});
	let result = validate_input(&schema, &json!({"name": "Alice", "extra": 42}));
	assert!(result.is_err());
	let Err((_, details)) = result else { unreachable!() };
	assert!(details.iter().any(|d| d.path == "/extra" && d.actual.contains("unexpected")));
}

// -- discriminator --

#[test]
fn discriminator_validates_correct_branch() {
	let schema = json!({
		"discriminator": "type",
		"mapping": {
			"circle": {
				"properties": {"radius": {"type": "float64"}}
			},
			"square": {
				"properties": {"side": {"type": "float64"}}
			}
		}
	});
	assert!(validate_input(&schema, &json!({"type": "circle", "radius": 5.0})).is_ok());
	assert!(validate_input(&schema, &json!({"type": "square", "side": 3.0})).is_ok());
}

#[test]
fn discriminator_missing_tag() {
	let schema = json!({
		"discriminator": "type",
		"mapping": {
			"circle": {"properties": {"radius": {"type": "float64"}}}
		}
	});
	let result = validate_input(&schema, &json!({"radius": 5.0}));
	assert!(result.is_err());
	let Err((_, details)) = result else { unreachable!() };
	assert!(details[0].actual == "missing");
}

// -- nullable --

#[test]
fn nullable_accepts_null() {
	let schema = json!({"type": "string", "nullable": true});
	assert!(validate_input(&schema, &json!(null)).is_ok());
}

#[test]
fn nullable_accepts_valid_inner() {
	let schema = json!({"type": "string", "nullable": true});
	assert!(validate_input(&schema, &json!("hello")).is_ok());
}

#[test]
fn nullable_rejects_invalid_inner() {
	let schema = json!({"type": "string", "nullable": true});
	assert!(validate_input(&schema, &json!(42)).is_err());
}

// -- ref/definitions --

#[test]
fn ref_resolves_definition() {
	let schema = json!({
		"definitions": {
			"coords": {
				"properties": {
					"x": {"type": "float64"},
					"y": {"type": "float64"}
				}
			}
		},
		"properties": {
			"origin": {"ref": "coords"},
			"dest": {"ref": "coords"}
		}
	});
	assert!(
		validate_input(
			&schema,
			&json!({
				"origin": {"x": 0.0, "y": 0.0},
				"dest": {"x": 1.0, "y": 2.0}
			})
		)
		.is_ok()
	);
}

#[test]
fn ref_validates_definition() {
	let schema = json!({
		"definitions": {
			"name": {"type": "string"}
		},
		"ref": "name"
	});
	assert!(validate_input(&schema, &json!("Alice")).is_ok());
	assert!(validate_input(&schema, &json!(42)).is_err());
}

// -- depth limit --

#[test]
fn depth_limit_produces_error() {
	// Build a deeply nested schema that exceeds MAX_DEPTH
	let mut schema = json!({"type": "string"});
	for _ in 0..35 {
		schema = json!({"elements": schema});
	}
	let compiled = compile::compile_schema(&schema).unwrap();

	// Build matching deeply nested data
	let mut data: Value = json!("deep");
	for _ in 0..35 {
		data = json!([data]);
	}

	let result = validate_compiled(&compiled, &data);
	assert!(result.is_err());
	let Err((_, details)) = result else { unreachable!() };
	assert!(details.iter().any(|d| d.actual.contains("exceeds max")));
}

// -- max errors cap --

#[test]
fn max_errors_caps_at_10() {
	let schema = json!({"elements": {"type": "string"}});
	// 20 invalid items
	let data: Value = Value::Array((0..20).map(|i| json!(i)).collect());
	let result = validate_input(&schema, &data);
	assert!(result.is_err());
	let Err((_, details)) = result else { unreachable!() };
	assert_eq!(details.len(), MAX_ERRORS);
}

// -- validate_compiled --

#[test]
fn validate_compiled_works() {
	let schema = json!({"type": "string"});
	let compiled = compile::compile_schema(&schema).unwrap();
	assert!(validate_compiled(&compiled, &json!("ok")).is_ok());
	assert!(validate_compiled(&compiled, &json!(42)).is_err());
}

// -- validation_detail json --

#[test]
fn validation_detail_to_json() {
	let detail =
		ValidationDetail { path: "/name".into(), expected: "string".into(), actual: "number".into() };
	let j = detail.to_json();
	assert_eq!(j["path"], "/name");
	assert_eq!(j["expected"], "string");
	assert_eq!(j["actual"], "number");
}

// -- should_validate --

#[test]
fn should_validate_never() {
	assert!(!should_validate(&ValidationMode::Never));
}

#[test]
fn should_validate_always() {
	assert!(should_validate(&ValidationMode::Always));
}
