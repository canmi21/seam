//! The shape `spec/ir.md` describes, and the shape `pkgs/injector` walks.

use serde::Serialize;

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Escape {
	Content,
	Attr,
}

#[derive(Debug, Serialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum Node {
	Static { s: String },
	Slot { path: String, escape: Escape },
	If { branches: Vec<Branch> },
	Each { source: String, item: String, body: Vec<Node> },
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
