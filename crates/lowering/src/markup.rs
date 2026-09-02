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

#[derive(Debug, Deserialize)]
pub struct Markup {
	pub markup: Vec<Node>,
}
