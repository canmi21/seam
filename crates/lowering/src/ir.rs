//! The shape `spec/ir.md` describes, and the shape `pkgs/injector` walks.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Escape {
	Content,
	Attr,
	/// `{@html}`. Serialises as `false` rather than as a name, because the field answers how a
	/// value is escaped and the answer here is that it is not.
	Raw,
}

impl Serialize for Escape {
	fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
		match self {
			Self::Content => serializer.serialize_str("content"),
			Self::Attr => serializer.serialize_str("attr"),
			Self::Raw => serializer.serialize_bool(false),
		}
	}
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum Node {
	Static {
		s: String,
	},
	Slot {
		path: String,
		escape: Escape,
		/// A `$props.id()` anchor: the value is the next id the runtime counts out rather than
		/// one read from data, and it is bound under `path` for every read that follows. Svelte's
		/// server counts the same way, so the bytes agree. See `spec/ir.md`.
		#[serde(skip_serializing_if = "std::ops::Not::not")]
		fresh: bool,
	},
	If {
		branches: Vec<Branch>,
	},
	Each {
		source: String,
		item: String,
		/// The name bound to the iteration counter, where the source names one. Svelte's server
		/// makes it the loop variable and nothing else; a key is not here because its server
		/// transform never mentions one. See `spec/ir.md`.
		#[serde(skip_serializing_if = "Option::is_none")]
		index: Option<String>,
		/// What a destructuring context binds, as name and how it is reached from one element.
		/// Absent where the context is a name, which is the ordinary case. See `spec/ir.md`.
		#[serde(skip_serializing_if = "Vec::is_empty")]
		binds: Vec<(String, String)>,
		body: Vec<Node>,
	},
	/// A `<title>` the head stream met where Svelte executed it, or the start of a head block that
	/// holds one. Svelte keeps the title in a channel: `set_title` in `internal/server/renderer.js`
	/// keeps the one whose render path compares later, and a head block is hoisted ahead of its
	/// fragment, so the last head block executed wins and, inside it, the first title executed. The
	/// injector applies that rule and appends the winner after the head. `role` is `open` for the
	/// start of a head block, `top` for a title at the block's top level, `nested` for one inside a
	/// block within the head. See `spec/ir.md`.
	Title {
		role: String,
		body: Vec<Node>,
	},
	/// One attribute of the element being opened. `boolean` marks a name that is present or
	/// absent rather than named and valued, which the runtime needs because the render cannot
	/// show it. See `crates/lowering/src/attributes.rs`.
	Attr {
		name: String,
		presence: Presence,
		parts: Vec<Node>,
	},
}

/// How an attribute's value decides whether the attribute appears.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Presence {
	/// Written unless the value is null or undefined.
	Value,
	/// Present or absent: `name=""` when the value is truthy or empty, nothing otherwise.
	Boolean,
	/// Written unless the value comes out empty, which is how `class` and `style` behave.
	NonEmpty,
}

#[derive(Debug, Clone, Serialize)]
pub struct Branch {
	/// A data path, or `None` for the branch Svelte marks `-1`.
	pub test: Option<String>,
	pub body: Vec<Node>,
}

/// Svelte renders two streams and the injector produces two, so the IR carries two. They are
/// named after Svelte's own, because they are the same two: what goes in the document's body and
/// what goes in its head. See `spec/ir.md`.
#[derive(Debug, Serialize)]
pub struct ComponentIR {
	pub component: String,
	pub body: Vec<Node>,
	pub head: Vec<Node>,
	/// The title, which is a channel rather than markup. Walking it gives either nothing or a
	/// whole `<title>` element, and the result belongs after the head. See `spec/ir.md`.
	pub title: Vec<Node>,
}

/// Where a name in a derivation's expression gets its value.
#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
	Path(String),
	Literal(String),
}

/// A pure expression the author wrote that the protocol will not test or interpolate directly.
/// It is evaluated once per request, over data, before anything is injected.
#[derive(Debug, Serialize)]
pub struct Derivation {
	pub name: String,
	pub expression: String,
	/// The names the expression may use. `None` means the payload's own keys, which is the case
	/// for the entry component because its props are the payload. A composed child gets the
	/// bindings from its call site instead, which is what lets the expression stay unrewritten.
	pub scope: Option<std::collections::BTreeMap<String, Source>>,
	/// Computed where it is used rather than once before injection, because it reads a name an
	/// each block binds and that name only exists inside the loop.
	///
	/// A derivation is a pure function of what is in scope. Where that is the payload alone it can
	/// be computed once, which is what every other derivation does; where it also reads what a
	/// block binds, the same function is called per item instead. Both were refused before this,
	/// on the reading that a derivation is computed once *per request* -- but once per request is
	/// a consequence of what its inputs are, not a rule about it. See `spec/derivation.md`.
	#[serde(skip_serializing_if = "std::ops::Not::not")]
	pub scoped: bool,
	/// The files the expression was written across, innermost first, which is where each name in
	/// it resolves: the evaluator gives it the imports of each of these, the innermost shadowing
	/// the rest. Empty for an expression written by the compiler itself. See `spec/derivation.md`.
	#[serde(skip_serializing_if = "Vec::is_empty")]
	pub files: Vec<String>,
}

/// What the compiler emits. The IR is what the injector walks; the derivations are consumed by
/// the stage before it, and the two are separate for the same reason CSS is not in the IR.
#[derive(Debug, Serialize)]
pub struct Compiled {
	pub ir: ComponentIR,
	pub derivations: Vec<Derivation>,
}
