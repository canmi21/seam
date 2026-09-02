//! `devalue.stringify`, reproduced.
//!
//! The output is a JSON array. Index 0 is the root, every other entry is a value some entry
//! refers to by its index, and a small set of negative numbers stand for the values JSON has no
//! spelling for. A root that is one of those is written on its own, without the array.
//!
//! An index is allocated before the value's children are walked, so a parent always numbers below
//! what it contains. That is not an implementation detail: it decides the numbering, and the
//! numbering is the output.

use std::collections::HashMap;

use crate::escape::string;
use crate::number;
use crate::value::Value;

const UNDEFINED: i64 = -1;
const NAN: i64 = -3;
const POSITIVE_INFINITY: i64 = -4;
const NEGATIVE_INFINITY: i64 = -5;
const NEGATIVE_ZERO: i64 = -6;

/// Turns a value into a string `devalue.parse` reads.
pub fn stringify(value: &Value) -> String {
	let mut run = Run { out: Vec::new(), seen: HashMap::new(), shared: HashMap::new() };
	let index = run.flatten(value);
	if index < 0 {
		return index.to_string();
	}
	format!("[{}]", run.out.join(","))
}

/// A primitive's identity, which devalue takes to be its value. Two equal strings are one entry;
/// two structurally equal objects are two.
#[derive(PartialEq, Eq, Hash)]
enum Key {
	Null,
	Bool(bool),
	/// By bit pattern, which is exact for every number that gets this far. The three that a bit
	/// pattern would compare badly -- `NaN` and the two zeroes -- never reach here.
	Number(u64),
	BigInt(String),
	String(String),
}

struct Run {
	out: Vec<String>,
	seen: HashMap<Key, i64>,
	/// Shared values, by address, which is the closest thing a tree has to identity.
	shared: HashMap<*const Value, i64>,
}

impl Run {
	fn key(value: &Value) -> Option<Key> {
		match value {
			Value::Null => Some(Key::Null),
			Value::Bool(v) => Some(Key::Bool(*v)),
			Value::Number(v) => Some(Key::Number(v.to_bits())),
			Value::BigInt(v) => Some(Key::BigInt(v.clone())),
			Value::String(v) => Some(Key::String(v.clone())),
			_ => None,
		}
	}

	fn flatten(&mut self, value: &Value) -> i64 {
		if let Value::Shared(inner) = value {
			let address = std::rc::Rc::as_ptr(inner);
			if let Some(index) = self.shared.get(&address) {
				return *index;
			}
			let index = self.allocate();
			self.shared.insert(address, index);
			let written = self.write(inner);
			self.fill(index, written);
			return index;
		}

		// The sentinels are returned before anything is numbered, so they never take an entry.
		match value {
			Value::Undefined => return UNDEFINED,
			Value::Number(n) => {
				if n.is_nan() {
					return NAN;
				}
				if *n == f64::INFINITY {
					return POSITIVE_INFINITY;
				}
				if *n == f64::NEG_INFINITY {
					return NEGATIVE_INFINITY;
				}
				if *n == 0.0 && n.is_sign_negative() {
					return NEGATIVE_ZERO;
				}
			}
			_ => {}
		}

		let key = value.primitive().then(|| Self::key(value)).flatten();
		if let Some(key) = &key
			&& let Some(index) = self.seen.get(key)
		{
			return *index;
		}

		let index = self.allocate();
		if let Some(key) = key {
			self.seen.insert(key, index);
		}

		let written = self.write(value);
		self.fill(index, written);
		index
	}

	/// Takes the next entry before the value's children are walked, because a child may refer
	/// back to it and because the order of these calls is the numbering in the output.
	fn allocate(&mut self) -> i64 {
		let index = i64::try_from(self.out.len()).unwrap_or(i64::MAX);
		self.out.push(String::new());
		index
	}

	fn fill(&mut self, index: i64, written: String) {
		if let Some(slot) = self.out.get_mut(usize::try_from(index).unwrap_or(0)) {
			*slot = written;
		}
	}

	fn write(&mut self, value: &Value) -> String {
		match value {
			// Both handled in `flatten`; reaching either here would mean it had been numbered.
			Value::Shared(inner) => self.write(inner),
			Value::Undefined => UNDEFINED.to_string(),
			Value::Null => "null".to_owned(),
			Value::Bool(v) => v.to_string(),
			Value::Number(n) => number::format(*n),
			Value::BigInt(digits) => format!("[\"BigInt\",\"{digits}\"]"),
			Value::String(s) => string(s),
			Value::Date(iso) => format!("[\"Date\",\"{iso}\"]"),
			Value::RegExp { source, flags } => {
				if flags.is_empty() {
					format!("[\"RegExp\",{}]", string(source))
				} else {
					format!("[\"RegExp\",{},\"{flags}\"]", string(source))
				}
			}
			Value::Url(href) => format!("[\"URL\",{}]", string(href)),
			Value::UrlSearchParams(query) => format!("[\"URLSearchParams\",{}]", string(query)),
			Value::Array(items) => {
				let parts: Vec<String> = items.iter().map(|item| self.flatten(item).to_string()).collect();
				format!("[{}]", parts.join(","))
			}
			Value::Set(items) => {
				let mut out = String::from("[\"Set\"");
				for item in items {
					out.push(',');
					out.push_str(&self.flatten(item).to_string());
				}
				out.push(']');
				out
			}
			Value::Map(entries) => {
				let mut out = String::from("[\"Map\"");
				for (key, item) in entries {
					out.push(',');
					out.push_str(&self.flatten(key).to_string());
					out.push(',');
					out.push_str(&self.flatten(item).to_string());
				}
				out.push(']');
				out
			}
			Value::Object(entries) => {
				let mut out = String::from("{");
				for (position, (key, item)) in entries.iter().enumerate() {
					if position > 0 {
						out.push(',');
					}
					out.push_str(&string(key));
					out.push(':');
					out.push_str(&self.flatten(item).to_string());
				}
				out.push('}');
				out
			}
		}
	}
}
