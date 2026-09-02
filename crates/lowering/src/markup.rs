//! The shape `pkgs/ast` emits. It has decided nothing: every expression is still source text.

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(tag = "k", rename_all = "lowercase")]
pub enum Node {
	Text {
		v: String,
	},
	Expr {
		src: String,
	},
	Html {
		src: String,
	},
	Element {
		name: String,
		attrs: Vec<Attr>,
		body: Vec<Node>,
	},
	If {
		test: String,
		consequent: Vec<Node>,
		alternate: Option<Vec<Node>>,
	},
	Each {
		source: String,
		item: Option<String>,
		index: Option<String>,
		key: Option<String>,
		body: Vec<Node>,
		fallback: Option<Vec<Node>>,
	},
	Component {
		name: String,
		props: Vec<Attr>,
		body: Vec<Node>,
	},
	Unsupported {
		#[serde(rename = "type")]
		kind: String,
		src: String,
	},
}

#[derive(Debug, Deserialize)]
#[serde(tag = "k", rename_all = "lowercase")]
pub enum Attr {
	Attr {
		name: String,
		value: AttrValue,
	},
	Unsupported {
		#[serde(rename = "type")]
		kind: String,
		src: String,
	},
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum AttrValue {
	Present(bool),
	Parts(Vec<Node>),
}

/// One component file, with its imports already resolved to bundle ids by whoever read them.
#[derive(Debug, Deserialize)]
pub struct Module {
	pub markup: Vec<Node>,
	pub imports: std::collections::BTreeMap<String, String>,
}

/// An entry and everything reachable from it.
#[derive(Debug, Deserialize)]
pub struct Bundle {
	pub entry: String,
	pub components: std::collections::BTreeMap<String, Module>,
}
