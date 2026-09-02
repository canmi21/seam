//! What can be serialized.
//!
//! JavaScript hands `stringify` a live value and reads its type at runtime. Rust has to be told,
//! so the shape it accepts is written out here. The variants are the tags devalue writes, not a
//! design of their own: adding one that devalue does not know would produce output its `parse`
//! could not read.

/// A value devalue can serialize.
///
/// Order is kept where JavaScript keeps it. An object is a list of pairs rather than a map,
/// because devalue writes keys in insertion order and a map would not have one; the same goes for
/// `Set` and `Map`.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
	Undefined,
	Null,
	Bool(bool),
	/// Every JavaScript number is a double, including the ones that look like integers. `NaN`,
	/// the infinities and negative zero are values here and become sentinels on the way out.
	Number(f64),
	/// Held as digits, which is how devalue writes it and how it survives having no bound.
	BigInt(String),
	String(String),
	/// The ISO 8601 string `Date.prototype.toISOString` would have produced. Kept as a string
	/// rather than a date type so the port owes nothing to a calendar library and cannot disagree
	/// with JavaScript about a leap second.
	Date(String),
	RegExp {
		source: String,
		flags: String,
	},
	Url(String),
	UrlSearchParams(String),
	/// A value more than one place refers to. devalue numbers an object by identity, so two
	/// fields holding the same object share one entry while two structurally equal objects do
	/// not. A tree has no identity to compare, so sharing is stated rather than discovered.
	///
	/// A cycle cannot be built from this, which is the one thing the JavaScript devalue carries
	/// and this does not: it would need interior mutability, and a payload does not have cycles.
	Shared(std::rc::Rc<Value>),
	Array(Vec<Value>),
	Object(Vec<(String, Value)>),
	Set(Vec<Value>),
	Map(Vec<(Value, Value)>),
}

impl Value {
	/// Whether this is one of the primitives devalue deduplicates by value rather than by
	/// identity. Two equal strings share an index; two structurally equal objects do not.
	pub(crate) fn primitive(&self) -> bool {
		matches!(self, Self::Null | Self::Bool(_) | Self::Number(_) | Self::BigInt(_) | Self::String(_))
	}
}
