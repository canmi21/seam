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

#[derive(Debug, Serialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum Node {
	Static { s: String },
	Slot { path: String, escape: Escape },
	If { branches: Vec<Branch> },
	Each { source: String, item: String, body: Vec<Node> },
	Attr { name: String, parts: Vec<Node> },
}

#[derive(Debug, Serialize)]
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
}

/// What the compiler emits. The IR is what the injector walks; the derivations are consumed by
/// the stage before it, and the two are separate for the same reason CSS is not in the IR.
#[derive(Debug, Serialize)]
pub struct Compiled {
	pub ir: ComponentIR,
	pub derivations: Vec<Derivation>,
}
