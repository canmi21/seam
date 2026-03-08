/* src/server/core/rust/src/validation/check.rs */

use serde_json::Value;

use super::{JtdType, ValidationDetail};

/// Bundled state for the recursive validation walker.
pub(super) struct ValidateCtx<'a> {
	pub(super) errors: &'a mut Vec<ValidationDetail>,
	pub(super) max_errors: usize,
	pub(super) max_depth: usize,
}

impl ValidateCtx<'_> {
	pub(super) fn full(&self) -> bool {
		self.errors.len() >= self.max_errors
	}

	pub(super) fn push(
		&mut self,
		path: &str,
		expected: impl Into<String>,
		actual: impl Into<String>,
	) {
		self.errors.push(ValidationDetail {
			path: path.into(),
			expected: expected.into(),
			actual: actual.into(),
		});
	}
}

pub(super) fn value_description(v: &Value) -> String {
	match v {
		Value::Null => "null".into(),
		Value::Bool(_) => "boolean".into(),
		Value::Number(_) => "number".into(),
		Value::String(_) => "string".into(),
		Value::Array(_) => "array".into(),
		Value::Object(_) => "object".into(),
	}
}

pub(super) fn is_valid_timestamp(s: &str) -> bool {
	// Basic RFC 3339 structural check: YYYY-..T..:..:..[Z|+|-]
	if s.len() < 20 {
		return false;
	}
	let bytes = s.as_bytes();
	// First 4 chars must be digits (year)
	if !bytes[..4].iter().all(u8::is_ascii_digit) {
		return false;
	}
	// Must contain date separator and time separators
	if bytes[4] != b'-' {
		return false;
	}
	// Find T or t separator
	let Some(t_pos) = bytes.iter().position(|&b| b == b'T' || b == b't') else {
		return false;
	};
	// Must have colon in time portion
	if !bytes[t_pos..].contains(&b':') {
		return false;
	}
	// Must have timezone indicator after T: Z, z, +, or -
	let after_t = &bytes[t_pos + 1..];
	after_t.iter().any(|&b| b == b'Z' || b == b'z' || b == b'+' || b == b'-')
}

pub(super) fn check_int_range(v: f64, min: f64, max: f64) -> bool {
	v.floor() == v && v >= min && v <= max
}

pub(super) fn validate_type(
	jtd_type: &JtdType,
	data: &Value,
	path: &str,
	ctx: &mut ValidateCtx<'_>,
) {
	match jtd_type {
		JtdType::Boolean => {
			if !data.is_boolean() {
				ctx.push(path, "boolean", value_description(data));
			}
		}
		JtdType::String => {
			if !data.is_string() {
				ctx.push(path, "string", value_description(data));
			}
		}
		JtdType::Timestamp => {
			if let Some(s) = data.as_str() {
				if !is_valid_timestamp(s) {
					ctx.push(path, "timestamp (RFC 3339)", format!("string \"{s}\""));
				}
			} else {
				ctx.push(path, "timestamp (RFC 3339)", value_description(data));
			}
		}
		JtdType::Float32 | JtdType::Float64 => {
			if !data.is_number() {
				ctx.push(path, "number", value_description(data));
			}
		}
		int_type => {
			let (label, min, max) = match int_type {
				JtdType::Int8 => ("int8 (-128..127)", -128.0, 127.0),
				JtdType::Int16 => ("int16 (-32768..32767)", -32768.0, 32767.0),
				JtdType::Int32 => ("int32 (-2147483648..2147483647)", -2_147_483_648.0, 2_147_483_647.0),
				JtdType::Uint8 => ("uint8 (0..255)", 0.0, 255.0),
				JtdType::Uint16 => ("uint16 (0..65535)", 0.0, 65535.0),
				JtdType::Uint32 => ("uint32 (0..4294967295)", 0.0, 4_294_967_295.0),
				_ => unreachable!(),
			};
			if let Some(n) = data.as_f64() {
				if !check_int_range(n, min, max) {
					ctx.push(path, label, format!("number {n}"));
				}
			} else {
				// Strip range from label for "wrong type" message
				let short = label.split(' ').next().unwrap_or(label);
				ctx.push(path, short, value_description(data));
			}
		}
	}
}
