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

#[derive(Debug, Serialize)]
pub struct ComponentIR {
	pub component: String,
	pub nodes: Vec<Node>,
}
