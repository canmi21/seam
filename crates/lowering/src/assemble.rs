//! Builds the IR out of what Svelte rendered, rather than out of bytes written here.
//!
//! The component is rewritten so it renders with no data: every expression becomes a string
//! literal holding a sentinel, every if is written as a constant, and every each iterates one
//! element. Every anchor, every escaping decision and every whitespace choice in the result is
//! Svelte's, so none of them is reproduced. What is left is splitting the string.

use std::collections::BTreeMap;

use serde::Deserialize;

use crate::ir;

#[derive(Debug, Deserialize)]
pub struct Hole {
	pub expression: String,
	/// `{@html}`. Everything else about a hole is read off the render.
	pub raw: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
	If,
	Each,
}

/// Which of Svelte's two output streams a block was rendered into. The bytes cannot say: the same
/// two ifs, one in the head and one in the body, render identically whichever came first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Stream {
	Body,
	Head,
}

#[derive(Debug, Deserialize)]
pub struct Block {
	pub kind: Kind,
	pub stream: Stream,
	/// The test of an if, or the source of an each, as written.
	pub expression: String,
	pub item: Option<String>,
}

/// Both of the streams one render produced.
#[derive(Debug, Deserialize)]
pub struct Rendered {
	pub body: String,
	#[serde(default)]
	pub head: String,
}

#[derive(Debug, Deserialize)]
pub struct Skeleton {
	/// Every if taken, every each with one item.
	pub html: String,
	/// The other stream Svelte renders. Read so that writing to it can be refused; assembling it
	/// waits on the IR carrying more than one sequence of nodes.
	#[serde(default)]
	pub head: String,
	/// One render per if, with that one not taken. Keyed by the block's index, and holding both
	/// streams because the if may be in either.
	pub alternates: BTreeMap<String, Rendered>,
	pub holes: Vec<Hole>,
	pub blocks: Vec<Block>,
}

pub type Result<T> = std::result::Result<T, String>;

// --- reading the anchors ------------------------------------------------------------------

/// An anchor pair and what sits between it. Svelte writes these so its client can find block
/// boundaries in a serialised page; the compiler reads them for the same reason.
struct Span {
	/// Where the opening anchor starts.
	from: usize,
	/// Just after the opening anchor.
	content: usize,
	/// Where the closing anchor starts.
	until: usize,
	/// Just after the closing anchor.
	to: usize,
}

const OPEN: &str = "<!--[";
/// What a head block closes with, and what a fragment writes where it holds nothing.
const EMPTY: &str = "<!---->";
const CLOSE: &str = "<!--]-->";

/// Finds the block that opens at or after `from`, at this nesting level, skipping any nested
/// pair. Returns nothing when the next thing at this level is the level's own close.
fn next_block(html: &str, from: usize, until: usize) -> Option<Span> {
	let mut at = from;
	loop {
		let open = html.get(at..until)?.find(OPEN)? + at;
		let close = html.get(at..until).and_then(|s| s.find(CLOSE)).map(|i| i + at);
		if close.is_some_and(|close| close < open) {
			return None;
		}
		let head_end = html.get(open..until)?.find("-->")? + open + 3;
		// `<!---->` is not a block. It is a component boundary or a leading text marker.
		if head_end - open == "<!---->".len() && &html[open..head_end] == "<!---->" {
			at = head_end;
			continue;
		}
		let content = head_end;
		let mut depth = 1;
		let mut scan = content;
		while depth > 0 {
			let next_open = html.get(scan..until).and_then(|s| s.find(OPEN)).map(|i| i + scan);
			let next_close = html.get(scan..until).and_then(|s| s.find(CLOSE)).map(|i| i + scan);
			let next_close = next_close?;
			match next_open {
				Some(next_open) if next_open < next_close => {
					let end = html.get(next_open..until)?.find("-->")? + next_open + 3;
					if !(end - next_open == "<!---->".len() && &html[next_open..end] == "<!---->") {
						depth += 1;
					}
					scan = end;
				}
				_ => {
					depth -= 1;
					scan = next_close + CLOSE.len();
					if depth == 0 {
						return Some(Span { from: open, content, until: next_close, to: scan });
					}
				}
			}
		}
	}
}

// --- splitting at the sentinels -----------------------------------------------------------

fn sentinel_at(html: &str, from: usize, until: usize) -> Option<(usize, usize, usize)> {
	let start = from + html.get(from..until)?.find("%%s")?;
	let rest = html.get(start + 3..until)?;
	let digits = rest.find("%%")?;
	let index: usize = rest.get(..digits)?.parse().ok()?;
	Some((start, start + 3 + digits + 2, index))
}

/// Where the sentinel landed, which decides how the value is escaped and whether the characters
/// around it belong to an attribute that can disappear.
enum Landing {
	Content,
	Attribute { name: String, opens_at: usize },
}

/// Inside a tag means inside an attribute value: scanning back, a `<` reached before a `>` says
/// the sentinel sits between a tag's angle brackets. Svelte escapes both in text, so neither can
/// appear in content that is not markup.
fn landing(html: &str, sentinel: usize, from: usize) -> Result<Landing> {
	let before = &html[from..sentinel];
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
	let space = before[..quote]
		.rfind(|c: char| c.is_whitespace())
		.ok_or_else(|| "an attribute with no whitespace before its name".to_owned())?;
	// The node owns the space in front of its name, because it owns whether it is written at
	// all: an absent attribute must take its separator with it.
	Ok(Landing::Attribute { name: before[space + 1..quote].to_owned(), opens_at: from + space })
}

/// Emits nodes, merging runs of literal output into one chunk apiece.
#[derive(Default)]
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
			self.nodes.push(ir::Node::Static { s: std::mem::take(&mut self.buffer) });
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

struct Assembler<'a> {
	skeleton: &'a Skeleton,
	derivations: Vec<ir::Derivation>,
	/// How many times each hole came back in the render. Checked once at the end.
	consumed: Vec<usize>,
	/// The stream being walked, and the source indices of its blocks in the order they appear in
	/// it. Blocks are numbered across the whole source but each appears in one stream only, so
	/// walking a stream steps through its own list rather than through the global numbering.
	stream: Stream,
	order: Vec<usize>,
	taken: usize,
}

impl Assembler<'_> {
	/// A path stays a path; anything else becomes a field on the payload. Composition is Svelte's
	/// here, so there is never a prop scope to carry.
	fn path(&mut self, expression: &str) -> String {
		let trimmed = expression.trim();
		if is_path(trimmed) {
			return trimmed.to_owned();
		}
		let name = format!("__d{}", self.derivations.len());
		self.derivations.push(ir::Derivation {
			name: name.clone(),
			expression: trimmed.to_owned(),
			scope: None,
		});
		name
	}

	/// Reading a hole marks it used. Every hole has to be used exactly once: the render is the
	/// only evidence the compiler has, so a sentinel that never comes back in it is content that
	/// Svelte put somewhere this pass does not look, and emitting the rest as if nothing were
	/// missing is the worst available outcome.
	fn hole(&mut self, index: usize) -> Result<(String, bool)> {
		let hole = self
			.skeleton
			.holes
			.get(index)
			.ok_or_else(|| format!("the render carries a sentinel {index} with no hole"))?;
		let found = (hole.expression.clone(), hole.raw);
		self.consumed[index] += 1;
		Ok(found)
	}

	/// The pass that wrote the bytes walked the markup, so it could refuse a node it did not
	/// know. This one reads a rendered string and has no notion of a node at all, which is why
	/// that refusal had to be rebuilt in terms of what it does see. `<svelte:head>` is the shape
	/// that found it: `render()` returns a head and a body, only the body is read, and a title
	/// compiled without complaint and then did not exist.
	fn placed(&self) -> Result<()> {
		for (index, count) in self.consumed.iter().enumerate() {
			if *count == 1 {
				continue;
			}
			let expression = &self.skeleton.holes[index].expression;
			return Err(if *count == 0 {
				format!(
					"`{expression}` is written but never comes back in the render, so it would be \
					 dropped; content outside the component's body, `<svelte:head>` among it, is \
					 not handled yet"
				)
			} else {
				format!("`{expression}` comes back {count} times in the render, and belongs in one place")
			});
		}
		Ok(())
	}
}

fn is_path(source: &str) -> bool {
	!source.is_empty()
		&& source.split('.').all(|part| {
			let mut chars = part.chars();
			match chars.next() {
				Some(first) if first.is_ascii_alphabetic() || first == '_' || first == '$' => {
					chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
				}
				_ => false,
			}
		})
}

// --- assembling ---------------------------------------------------------------------------

impl Assembler<'_> {
	/// Walks one region of a render, emitting nodes. `html[from..until]` is the region; blocks
	/// inside it are consumed in order, and their bodies recursed into.
	fn region(&mut self, html: &str, from: usize, until: usize, out: &mut Out) -> Result<()> {
		let mut at = from;
		loop {
			let block = next_block(html, at, until);
			let sentinel = sentinel_at(html, at, until);

			let block_first = match (&block, &sentinel) {
				(Some(block), Some(sentinel)) => block.from < sentinel.0,
				(Some(_), None) => true,
				_ => false,
			};

			if block_first {
				let span = block.ok_or_else(|| "unreachable".to_owned())?;
				out.write(&html[at..span.from]);
				self.block(html, &span, out)?;
				out.write(&html[span.until..span.to]);
				at = span.to;
				continue;
			}

			let Some((start, end, index)) = sentinel else {
				out.write(&html[at..until]);
				return Ok(());
			};

			match landing(html, start, from)? {
				Landing::Content => {
					out.write(&html[at..start]);
					let (expression, raw) = self.hole(index)?;
					let escape = if raw { ir::Escape::Raw } else { ir::Escape::Content };
					let path = self.path(&expression);
					out.push(ir::Node::Slot { path, escape });
					at = end;
				}
				Landing::Attribute { name, opens_at } => {
					out.write(&html[at..opens_at]);
					let value_from = html[opens_at..until]
						.find("=\"")
						.ok_or_else(|| format!("attribute `{name}` has no value"))?
						+ opens_at
						+ 2;
					// Svelte escapes a quote inside an attribute, so the first one after the
					// opening closes it. That makes the extent findable without parsing HTML.
					let close = html[value_from..until]
						.find('"')
						.ok_or_else(|| format!("attribute `{name}` is never closed"))?
						+ value_from;
					let node = self.attribute(&name, html, value_from, close)?;
					out.push(node);
					at = close + 1;
				}
			}
		}
	}

	fn attribute(&mut self, name: &str, html: &str, from: usize, until: usize) -> Result<ir::Node> {
		let mut parts = Out::default();
		let mut at = from;
		while let Some((start, end, index)) = sentinel_at(html, at, until) {
			parts.write(&html[at..start]);
			let (expression, _) = self.hole(index)?;
			let path = self.path(&expression);
			parts.push(ir::Node::Slot { path, escape: ir::Escape::Attr });
			at = end;
		}
		parts.write(&html[at..until]);
		Ok(ir::Node::Attr {
			name: name.to_owned(),
			presence: crate::attributes::presence(name),
			parts: parts.finish(),
		})
	}

	/// Writes the block into `out`. Which side of the node an anchor falls on differs by kind:
	/// an each opens once for the whole block, so its marker is static and sits outside, while an
	/// if writes a different marker per branch and so carries it inside.
	fn block(&mut self, html: &str, span: &Span, out: &mut Out) -> Result<()> {
		let ordinal = self.taken;
		self.taken += 1;
		let index = *self
			.order
			.get(ordinal)
			.ok_or_else(|| "the render holds more blocks than the source declared".to_owned())?;
		let block = self
			.skeleton
			.blocks
			.get(index)
			.ok_or_else(|| "the render holds more blocks than the source declared".to_owned())?;

		match block.kind {
			Kind::Each => {
				let source = self.path(&block.expression.clone());
				let item = block
					.item
					.clone()
					.ok_or_else(|| "an each block without an iteration variable".to_owned())?;
				let mut body = Out::default();
				self.region(html, span.content, span.until, &mut body)?;
				out.write(&html[span.from..span.content]);
				out.push(ir::Node::Each { source, item, body: body.finish() });
				Ok(())
			}
			Kind::If => {
				let test = self.path(&block.expression.clone());
				let mut taken = Out::default();
				// The branch marker belongs to the branch, because which one is written is only
				// known per request. Svelte put it at the head of the span it opened.
				taken.write(&html[span.from..span.content]);
				self.region(html, span.content, span.until, &mut taken)?;

				let rendered = self
					.skeleton
					.alternates
					.get(&index.to_string())
					.ok_or_else(|| format!("no render was made with block {index} not taken"))?;
				// The alternate is taken from the same stream the block lives in, and the head's
				// title is split off there too so the two renders are read the same way.
				let other = match self.stream {
					Stream::Body => rendered.body.as_str(),
					Stream::Head => split_off_title(&rendered.head)?.0,
				};
				let mut otherwise = Out::default();
				// Found by counting within the stream, because that is how it was walked.
				let at = self.locate(other, ordinal)?;
				otherwise.write(&other[at.from..at.content]);
				let saved = std::mem::replace(&mut self.taken, ordinal + 1);
				self.region(other, at.content, at.until, &mut otherwise)?;
				self.taken = saved;

				out.push(ir::Node::If {
					branches: vec![
						ir::Branch { test: Some(test), body: taken.finish() },
						ir::Branch { test: None, body: otherwise.finish() },
					],
				});
				Ok(())
			}
		}
	}

	/// The nth block of another render of the same stream, found by counting opening anchors in
	/// document order. The body is wrapped in a pair that looks like an each and the head is not,
	/// so the region to count within is whichever this stream walks.
	fn locate(&self, html: &str, index: usize) -> Result<Span> {
		fn walk(html: &str, from: usize, until: usize, seen: &mut usize, want: usize) -> Option<Span> {
			let mut at = from;
			while let Some(span) = next_block(html, at, until) {
				if *seen == want {
					return Some(span);
				}
				*seen += 1;
				if let Some(found) = walk(html, span.content, span.until, seen, want) {
					return Some(found);
				}
				at = span.to;
			}
			None
		}
		let (from, until) = match self.stream {
			Stream::Body => {
				let outer = next_block(html, 0, html.len())
					.ok_or_else(|| "a render with no component boundary".to_owned())?;
				(outer.content, outer.until)
			}
			Stream::Head => (0, html.len()),
		};
		let mut seen = 0;
		walk(html, from, until, &mut seen, index)
			.ok_or_else(|| format!("block {index} does not appear in the render made for it"))
	}
}

pub fn assemble(component: &str, skeleton: &Skeleton) -> Result<ir::Compiled> {
	// render() wraps the whole component in a pair that looks like an each. Stepping over it
	// here keeps it in the output and out of the block count.
	let outer = next_block(&skeleton.html, 0, skeleton.html.len())
		.ok_or_else(|| "a render with no component boundary".to_owned())?;

	let mut assembler = Assembler {
		skeleton,
		derivations: Vec::new(),
		consumed: vec![0; skeleton.holes.len()],
		stream: Stream::Body,
		order: order_in(skeleton, Stream::Body),
		taken: 0,
	};
	let mut out = Out::default();
	out.write(&skeleton.html[outer.from..outer.content]);
	assembler.region(&skeleton.html, outer.content, outer.until, &mut out)?;
	out.write(&skeleton.html[outer.until..outer.to]);

	// Each head block is a hash anchor, its content, and an empty comment; a child's is already
	// merged in ahead of it. The title is not part of any of them -- Svelte keeps it in a channel
	// of its own and appends it after the lot -- so the last empty comment is where the head ends
	// and the title begins. Both are assembled after the body, because blocks are numbered in
	// source order and counted as they are met, which lines up only while the head holds none.
	let (head_bytes, title_bytes) = split_off_title(&skeleton.head)?;

	assembler.stream = Stream::Head;
	assembler.order = order_in(skeleton, Stream::Head);
	assembler.taken = 0;
	let mut head = Out::default();
	if !head_bytes.is_empty() {
		assembler.region(head_bytes, 0, head_bytes.len(), &mut head)?;
	}

	// The title holds no block: one written inside one is refused by the render pass, because the
	// title is not part of the block on either side and nothing in the bytes ties them together.
	let mut title = Out::default();
	if !title_bytes.is_empty() {
		assembler.region(title_bytes, 0, title_bytes.len(), &mut title)?;
	}
	assembler.placed()?;

	Ok(ir::Compiled {
		ir: ir::ComponentIR {
			component: component.to_owned(),
			body: out.finish(),
			head: head.finish(),
			title: title.finish(),
		},
		derivations: assembler.derivations,
	})
}

/// The source indices of one stream's blocks, in the order they appear in it.
fn order_in(skeleton: &Skeleton, stream: Stream) -> Vec<usize> {
	skeleton
		.blocks
		.iter()
		.enumerate()
		.filter(|(_, block)| block.stream == stream)
		.map(|(index, _)| index)
		.collect()
}

/// Splits the rendered head into the head blocks and the title, at the close of the last block.
///
/// `head()` writes `<!--hash-->`, the content, then an empty comment, and `#close_render` appends
/// `get_title()` after every one of those. So the split is that line of Svelte's rather than a
/// position worked out here, and the title is checked to be a whole element so that a release
/// which appends something else is a failure rather than a silent misreading.
fn split_off_title(head: &str) -> Result<(&str, &str)> {
	if head.is_empty() {
		return Ok(("", ""));
	}
	let close = head.rfind(EMPTY).ok_or_else(|| "a rendered head with no block close".to_owned())?
		+ EMPTY.len();
	let (blocks, title) = head.split_at(close);
	if !title.is_empty() && !(title.starts_with("<title>") && title.ends_with("</title>")) {
		return Err(format!("the head carries `{title}` after its blocks, which is not a title"));
	}
	Ok((blocks, title))
}
