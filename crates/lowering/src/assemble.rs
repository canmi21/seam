//! Builds the IR out of what Svelte rendered, rather than out of bytes written here.
//!
//! The input is one render of the component with a sentinel wherever a value would have gone.
//! Every anchor, every escaping decision and every whitespace choice in that render is Svelte's,
//! so none of them is reproduced. What is left is splitting the string at the sentinels.

use serde::Deserialize;

use crate::ir;

#[derive(Debug, Deserialize)]
pub struct Hole {
	pub expression: String,
	/// `{@html}`. Everything else about a hole is read off the render.
	pub raw: bool,
}

/// Where the sentinel landed, which decides how the value is escaped and whether the surrounding
/// characters belong to an attribute that can disappear.
enum Landing {
	Content,
	Attribute { name: String, opens_at: usize },
}

/// Inside a tag means inside an attribute value: scanning back, a `<` reached before a `>` says
/// the sentinel is between a tag's angle brackets. Svelte escapes both in text, so neither can
/// appear in content that is not markup.
fn landing(html: &str, sentinel_at: usize) -> Result<Landing> {
	let before = &html[..sentinel_at];
	let open = before.rfind('<');
	let close = before.rfind('>');
	let inside = match (open, close) {
		(Some(open), Some(close)) => open > close,
		(Some(_), None) => true,
		_ => false,
	};
	if !inside {
		return Ok(Landing::Content);
	}

	let quote = before
		.rfind("=\"")
		.ok_or_else(|| "a sentinel inside a tag is not inside an attribute value".to_owned())?;
	let name_end = quote;
	let space = before[..name_end]
		.rfind(|c: char| c.is_whitespace())
		.ok_or_else(|| "an attribute with no whitespace before its name".to_owned())?;
	// The node owns the space in front of its name, because it owns whether it is written at
	// all: an absent attribute must take its separator with it.
	Ok(Landing::Attribute { name: before[space + 1..name_end].to_owned(), opens_at: space })
}

#[derive(Debug, Deserialize)]
pub struct Skeleton {
	pub html: String,
	pub holes: Vec<Hole>,
}

pub type Result<T> = std::result::Result<T, String>;

fn sentinel_at(html: &str, from: usize) -> Option<(usize, usize, usize)> {
	let start = from + html.get(from..)?.find("%%s")?;
	let rest = html.get(start + 3..)?;
	let digits = rest.find("%%")?;
	let index: usize = rest.get(..digits)?.parse().ok()?;
	Some((start, start + 3 + digits + 2, index))
}

/// Emits `nodes`, merging runs of literal output into one chunk apiece.
struct Out {
	nodes: Vec<ir::Node>,
	buffer: String,
}

impl Out {
	fn write(&mut self, text: &str) {
		self.buffer.push_str(text);
	}

	fn push(&mut self, node: ir::Node) {
		if !self.buffer.is_empty() {
			let s = std::mem::take(&mut self.buffer);
			self.nodes.push(ir::Node::Static { s });
		}
		self.nodes.push(node);
	}

	fn finish(mut self) -> Vec<ir::Node> {
		if !self.buffer.is_empty() {
			self.nodes.push(ir::Node::Static { s: self.buffer });
		}
		self.nodes
	}
}

pub fn assemble(component: &str, skeleton: &Skeleton) -> Result<ir::ComponentIR> {
	let html = &skeleton.html;
	let mut out = Out { nodes: Vec::new(), buffer: String::new() };
	let mut at = 0;

	while let Some((start, end, index)) = sentinel_at(html, at) {
		let hole = skeleton
			.holes
			.get(index)
			.ok_or_else(|| format!("the render carries a sentinel {index} with no hole"))?;

		match landing(html, start)? {
			Landing::Content => {
				out.write(&html[at..start]);
				let escape = if hole.raw { ir::Escape::Raw } else { ir::Escape::Content };
				out.push(ir::Node::Slot { path: hole.expression.clone(), escape });
				at = end;
			}
			Landing::Attribute { name, opens_at } => {
				if opens_at < at {
					return Err(format!("attribute `{name}` opens before the position being read"));
				}
				out.write(&html[at..opens_at]);

				let value_from =
					html[opens_at..].find("=\"").ok_or_else(|| format!("attribute `{name}` has no value"))?
						+ opens_at
						+ 2;
				// Svelte escapes a quote inside an attribute, so the first one after the opening
				// closes it. That makes the extent findable without parsing HTML.
				let close = html[value_from..]
					.find('"')
					.ok_or_else(|| format!("attribute `{name}` is never closed"))?
					+ value_from;

				out.push(attribute(&name, &html[value_from..close], skeleton)?);
				at = close + 1;
			}
		}
	}

	out.write(&html[at..]);
	Ok(ir::ComponentIR { component: component.to_owned(), nodes: out.finish() })
}

fn attribute(name: &str, value: &str, skeleton: &Skeleton) -> Result<ir::Node> {
	let mut parts = Out { nodes: Vec::new(), buffer: String::new() };
	let mut at = 0;
	while let Some((start, end, index)) = sentinel_at(value, at) {
		let hole = skeleton
			.holes
			.get(index)
			.ok_or_else(|| format!("attribute `{name}` carries a sentinel {index} with no hole"))?;
		parts.write(&value[at..start]);
		parts.push(ir::Node::Slot { path: hole.expression.clone(), escape: ir::Escape::Attr });
		at = end;
	}
	parts.write(&value[at..]);
	Ok(ir::Node::Attr { name: name.to_owned(), parts: parts.finish() })
}
