//! The node list an assembling pass writes into, merging runs of literal output into one chunk.

use crate::ir;

/// Emits nodes, merging runs of literal output into one chunk apiece.
#[derive(Default)]
pub(super) struct Out {
	pub(super) nodes: Vec<ir::Node>,
	pub(super) buffer: String,
}

impl Out {
	pub(super) fn write(&mut self, text: &str) {
		self.buffer.push_str(text);
	}

	pub(super) fn push(&mut self, node: ir::Node) {
		if !self.buffer.is_empty() {
			self.nodes.push(ir::Node::Static { s: std::mem::take(&mut self.buffer) });
		}
		self.nodes.push(node);
	}

	/// The first marker this pass planted that is still in what it wrote, if any. See `assemble`.
	pub(super) fn planted(&self) -> Option<String> {
		let mut found = None;
		let mut look = |text: &str| {
			if found.is_some() {
				return;
			}
			for open in ["%%s", "%%b", "%%h"] {
				if let Some(at) = text.find(open) {
					let rest = &text[at..];
					let end = rest[open.len()..].find("%%").map_or(rest.len(), |n| at + open.len() + n + 2);
					found = Some(text[at..end].to_owned());
					return;
				}
			}
		};
		for node in &self.nodes {
			if let ir::Node::Static { s } = node {
				look(s);
			}
		}
		look(&self.buffer);
		found
	}

	pub(super) fn finish(mut self) -> Vec<ir::Node> {
		if !self.buffer.is_empty() {
			self.nodes.push(ir::Node::Static { s: self.buffer });
		}
		self.nodes
	}
}
