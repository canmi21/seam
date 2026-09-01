/* src/server/core/rust/src/validation/mod.rs */

mod check;
mod compile;
mod walk;

use serde_json::Value;
use std::env;

use check::ValidateCtx;
pub use compile::compile_schema;
use walk::validate_walk;

/// Controls when input validation runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidationMode {
	/// Validate only in dev mode (default).
	Dev,
	/// Always validate.
	Always,
	/// Never validate.
	Never,
}

/// Check whether validation should run for the given mode.
pub fn should_validate(mode: &ValidationMode) -> bool {
	match mode {
		ValidationMode::Never => false,
		ValidationMode::Always => true,
		ValidationMode::Dev => {
			if let Ok(v) = env::var("SEAM_ENV") {
				return v != "production";
			}
			if let Ok(v) = env::var("NODE_ENV") {
				return v != "production";
			}
			true
		}
	}
}

/// JTD primitive type identifiers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JtdType {
	Boolean,
	String,
	Timestamp,
	Int8,
	Int16,
	Int32,
	Uint8,
	Uint16,
	Uint32,
	Float32,
	Float64,
}

/// Pre-compiled JTD schema for fast repeated validation.
#[derive(Debug, Clone)]
pub enum CompiledSchema {
	Empty,
	Type(JtdType),
	Enum(Vec<String>),
	Elements(Box<CompiledSchema>),
	Values(Box<CompiledSchema>),
	Properties {
		required: Vec<(String, CompiledSchema)>,
		optional: Vec<(String, CompiledSchema)>,
		allow_extra: bool,
	},
	Discriminator {
		tag: String,
		mapping: Vec<(String, CompiledSchema)>,
	},
	Nullable(Box<CompiledSchema>),
}

/// A single validation error with path, expected type, and actual value description.
#[derive(Debug, Clone)]
pub struct ValidationDetail {
	pub path: String,
	pub expected: String,
	pub actual: String,
}

impl ValidationDetail {
	pub fn to_json(&self) -> Value {
		serde_json::json!({
			"path": self.path,
			"expected": self.expected,
			"actual": self.actual,
		})
	}
}

const MAX_ERRORS: usize = 10;
const MAX_DEPTH: usize = 32;

/// Validate `data` against a JTD schema (compiles on each call).
/// Returns `Ok(())` if valid, or `Err((summary, details))` on failure.
pub fn validate_input(schema: &Value, data: &Value) -> Result<(), (String, Vec<ValidationDetail>)> {
	let compiled = compile_schema(schema).map_err(|e| (e, vec![]))?;
	validate_compiled(&compiled, data)
}

/// Validate `data` against a pre-compiled schema.
/// Returns `Ok(())` if valid, or `Err((summary, details))` on failure.
pub fn validate_compiled(
	schema: &CompiledSchema,
	data: &Value,
) -> Result<(), (String, Vec<ValidationDetail>)> {
	let mut errors = Vec::new();
	let mut ctx = ValidateCtx { errors: &mut errors, max_errors: MAX_ERRORS, max_depth: MAX_DEPTH };
	validate_walk(schema, data, "", &mut ctx, 0, None);
	if errors.is_empty() {
		Ok(())
	} else {
		let count = errors.len();
		let summary = if count == 1 {
			"validation failed: 1 error".into()
		} else {
			format!("validation failed: {count} errors")
		};
		Err((summary, errors))
	}
}

#[cfg(test)]
mod tests;
