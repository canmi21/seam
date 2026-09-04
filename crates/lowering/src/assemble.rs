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
	/// Set where the hole is a decision rather than a substitution, which is what a `class:`
	/// directive makes of the attribute it sits on. See `spec/refusals.md`.
	#[serde(default)]
	pub choice: Option<Choice>,
	/// The component this value was handed to and the prop it was handed as, where it was. Carried
	/// for the diagnostic: a component is a plain call with no anchor around what it writes, so an
	/// absence here is all this pass can see on its own.
	#[serde(default)]
	pub given: Option<String>,
}

/// A decision whose outcomes were enumerated at compile time.
///
/// `tests` is one expression per directive in source order and `outcomes` holds one finished
/// attribute string per combination of their truthiness, indexed by the bits -- test `i` truthy
/// sets bit `i`. Each string came out of Svelte's own `attr_class`, so nothing about how a class
/// attribute is joined, escaped or left out is decided here.
#[derive(Debug, Clone, Deserialize)]
pub struct Choice {
	pub tests: Vec<String>,
	pub outcomes: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
	If,
	Each,
	/// `<svelte:element>`, whose tag the request decides. See `spec/refusals.md`.
	Element,
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
	/// Every test of an if, in order, which is one per branch before the final else. A
	/// `{:else if}` chain is one block: Svelte's server transform flattens it and numbers the
	/// marker it opens each branch with, rather than nesting a second pair of anchors.
	#[serde(default)]
	pub tests: Vec<String>,
	pub item: Option<String>,
	/// What a destructuring context binds, as name and how it is reached from one element. Empty
	/// where the context is an ordinary name.
	#[serde(default)]
	pub binds: Vec<(String, String)>,
	/// The name an each block binds to its counter, where it names one. The IR calls it `index`;
	/// here that name is the block's own ordinal.
	#[serde(default)]
	pub counter: Option<String>,
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

/// The stand-in a dynamic element was rendered under, and the parts of what it wrote.
///
/// Svelte's `element()` writes `<!---->`, then the tag with its attributes, then the children, an
/// empty comment and a closing tag unless the tag is void or raw text, then `<!---->`. The render
/// is given a name that is none of those, so what comes back is always the full shape and every
/// piece of it has a known edge.
struct Dynamic {
	/// Where the leading empty comment starts.
	from: usize,
	/// Just after `<seam-elN`, where the attributes begin.
	attributes: usize,
	/// The `>` that closes the opening tag.
	opened: usize,
	/// Where the children end, before the empty comment that precedes the closing tag.
	content: usize,
	/// Just past the trailing empty comment.
	to: usize,
	index: usize,
}

const STANDIN: &str = "<seam-el";

fn next_dynamic(html: &str, from: usize, until: usize) -> Option<Dynamic> {
	let at = html.get(from..until)?.find(STANDIN)? + from;
	let rest = html.get(at + STANDIN.len()..until)?;
	let digits = rest.find(|c: char| !c.is_ascii_digit())?;
	let index: usize = rest.get(..digits)?.parse().ok()?;
	let attributes = at + STANDIN.len() + digits;

	// The first `>` outside a quoted value. Svelte escapes `&` and `"` in an attribute and leaves
	// `>` alone, so one can sit inside a value and the naive scan would stop on it.
	let mut quoted = false;
	let mut opened = None;
	for (offset, c) in html.get(attributes..until)?.char_indices() {
		match c {
			'"' => quoted = !quoted,
			'>' if !quoted => {
				opened = Some(attributes + offset);
				break;
			}
			_ => {}
		}
	}
	let opened = opened?;

	let closing = format!("</seam-el{index}>");
	let close_at = html.get(opened..until)?.find(&closing)? + opened;
	if !html.get(..at)?.ends_with(EMPTY) || !html.get(..close_at)?.ends_with(EMPTY) {
		return None;
	}
	Some(Dynamic {
		from: at - EMPTY.len(),
		attributes,
		opened,
		content: close_at - EMPTY.len(),
		to: close_at + closing.len() + EMPTY.len(),
		index,
	})
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

/// One level of a decision tree: test `at`, then the same again for what is left.
///
/// The empty outcome produces no node rather than an empty one, because writing nothing is what an
/// attribute Svelte left out looks like and a node holding `""` says the same thing twice.
fn nest(tests: &[String], outcomes: &[Vec<ir::Node>], at: usize, bits: usize) -> Vec<ir::Node> {
	let Some(test) = tests.get(at) else {
		return outcomes.get(bits).cloned().unwrap_or_default();
	};
	vec![ir::Node::If {
		branches: vec![
			ir::Branch {
				test: Some(test.clone()),
				body: nest(tests, outcomes, at + 1, bits | (1 << at)),
			},
			ir::Branch { test: None, body: nest(tests, outcomes, at + 1, bits) },
		],
	}]
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
	/// Names an enclosing each block binds. A derivation is computed once against the payload, so
	/// one that reads a name bound per item has no value to be computed from. See spec/ir.md.
	locals: Vec<String>,
}

/// Every identifier an expression reads, ignoring what is inside a string and what follows a dot.
///
/// A property name is not a read -- `x.item` reads `x` -- and a name inside a string is text. The
/// scan is here rather than a parse because the one question asked of it is whether a derivation
/// reaches for something the payload does not carry.
fn reads(source: &str) -> Vec<String> {
	let bytes: Vec<char> = source.chars().collect();
	let mut found = Vec::new();
	let mut at = 0;
	let mut after_dot = false;
	while at < bytes.len() {
		let c = bytes[at];
		if c == '\'' || c == '"' || c == '`' {
			let quote = c;
			at += 1;
			while at < bytes.len() && bytes[at] != quote {
				at += if bytes[at] == '\\' { 2 } else { 1 };
			}
			at += 1;
			after_dot = false;
			continue;
		}
		if c.is_ascii_alphabetic() || c == '_' || c == '$' {
			let from = at;
			while at < bytes.len()
				&& (bytes[at].is_ascii_alphanumeric() || bytes[at] == '_' || bytes[at] == '$')
			{
				at += 1;
			}
			if !after_dot {
				found.push(bytes[from..at].iter().collect());
			}
			after_dot = false;
			continue;
		}
		if !c.is_whitespace() {
			after_dot = c == '.';
		}
		at += 1;
	}
	found
}

impl Assembler<'_> {
	/// A path stays a path; anything else becomes a field on the payload. Composition is Svelte's
	/// here, so there is never a prop scope to carry.
	fn path(&mut self, expression: &str) -> Result<String> {
		let trimmed = expression.trim();
		if is_path(trimmed) {
			return Ok(trimmed.to_owned());
		}
		// A path rooted at an each block's binding is resolved per item by the runtime, which walks
		// a scope stack. An expression is not: it is computed once, against the payload, before
		// anything is injected. So one that reads a per-item name has nothing to be computed from,
		// and this used to compile and then throw at request time. See spec/derivation.md.
		let reaching: Vec<&String> =
			self.locals.iter().filter(|one| reads(trimmed).iter().any(|read| read == *one)).collect();
		if let Some(one) = reaching.first() {
			return Err(format!(
				"`{trimmed}` is computed once against the payload but reads `{one}`, which an each \
				 block binds per item; a path is resolved per item and an expression is not. See \
				 spec/derivation.md"
			));
		}
		let name = format!("__d{}", self.derivations.len());
		self.derivations.push(ir::Derivation {
			name: name.clone(),
			expression: trimmed.to_owned(),
			scope: None,
		});
		Ok(name)
	}

	/// Reading a hole marks it used. Every hole has to be used exactly once: the render is the
	/// only evidence the compiler has, so a sentinel that never comes back in it is content that
	/// Svelte put somewhere this pass does not look, and emitting the rest as if nothing were
	/// missing is the worst available outcome.
	/// The hole at `index` where it is a decision, consumed like any other hole when it is one.
	fn choice(&mut self, index: usize) -> Result<Option<Choice>> {
		let hole = self
			.skeleton
			.holes
			.get(index)
			.ok_or_else(|| format!("the render carries a sentinel {index} with no hole"))?;
		let found = hole.choice.clone();
		if found.is_some() {
			self.consumed[index] += 1;
		}
		Ok(found)
	}

	/// A decision as nested ifs, one per test, ending in the bytes that combination produces.
	///
	/// Nested rather than one branch per combination, because a branch carries one test and a
	/// combination is a conjunction of them. Each test is resolved once, before the tree is built,
	/// so an expression among them becomes one derivation rather than one per path through it.
	fn decide(&mut self, choice: &Choice) -> Result<Vec<ir::Node>> {
		let mut tests = Vec::with_capacity(choice.tests.len());
		for test in &choice.tests {
			tests.push(self.path(test)?);
		}
		let wanted = 1usize << tests.len();
		if choice.outcomes.len() != wanted {
			return Err(format!(
				"a decision over {} tests carries {} outcomes rather than {wanted}",
				tests.len(),
				choice.outcomes.len()
			));
		}
		// Each outcome is finished bytes, and a style decision writes the value inside them, so an
		// outcome is split at its markers the way an attribute's region is. Every marker belongs to
		// one outcome, which is what keeps a value appearing in half of them a hole consumed once.
		let mut leaves = Vec::with_capacity(choice.outcomes.len());
		for outcome in &choice.outcomes {
			leaves.push(self.pieces(outcome)?);
		}
		Ok(nest(&tests, &leaves, 0, 0))
	}

	/// One outcome as nodes: its literal runs, and a slot wherever a marker stands in it.
	fn pieces(&mut self, outcome: &str) -> Result<Vec<ir::Node>> {
		let mut out = Out::default();
		let mut at = 0;
		while let Some((start, end, index)) = sentinel_at(outcome, at, outcome.len()) {
			out.write(&outcome[at..start]);
			let (expression, _) = self.hole(index)?;
			let path = self.path(&expression)?;
			out.push(ir::Node::Slot { path, escape: ir::Escape::Attr });
			at = end;
		}
		out.write(&outcome[at..]);
		Ok(out.finish())
	}

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
			let hole = &self.skeleton.holes[index];
			let expression = &hole.expression;
			return Err(match (*count, hole.given.as_deref()) {
				// The common shape by far, and the one an absence alone says nothing about. What a
				// component may do with a value it is handed is measured in `spec/refusals.md`:
				// write it out, once, is the whole of it.
				(0, Some(given)) => format!(
					"`{expression}` was given to {given} and did not come back. A value handed to a \
					 component has to be written out by it, and this one was used for something \
					 else -- computed with, called, branched on, or not used at all. See \
					 spec/refusals.md"
				),
				(0, None) => format!(
					"`{expression}` is written but never comes back in the render, so it would be \
					 dropped"
				),
				(count, Some(given)) => format!(
					"`{expression}` was given to {given} and comes back {count} times. A value \
					 handed to a component may be written once, because one value cannot stand in \
					 two places. See spec/refusals.md"
				),
				(count, None) => format!(
					"`{expression}` comes back {count} times in the render, and belongs in one place"
				),
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
		self.region_from(html, from, until, out, from)
	}

	/// The same, with the point a sentinel's surroundings are read back from given separately.
	///
	/// An element's attributes are walked as a region of their own, and reading whether a sentinel
	/// sits inside a tag means scanning back to the `<` -- which is behind where that region
	/// starts. So the scan start and the anchor part company for exactly that call.
	fn region_from(
		&mut self,
		html: &str,
		from: usize,
		until: usize,
		out: &mut Out,
		anchor: usize,
	) -> Result<()> {
		let mut at = from;
		loop {
			let block = next_block(html, at, until);
			let sentinel = sentinel_at(html, at, until);
			let dynamic = next_dynamic(html, at, until);

			let first = [
				block.as_ref().map(|one| one.from),
				sentinel.map(|one| one.0),
				dynamic.as_ref().map(|one| one.from),
			];
			let earliest = first.iter().flatten().min().copied();

			if dynamic.as_ref().is_some_and(|one| Some(one.from) == earliest) {
				let span = dynamic.ok_or_else(|| "unreachable".to_owned())?;
				out.write(&html[at..span.from]);
				self.dynamic(html, &span, out)?;
				at = span.to;
				continue;
			}

			if block.as_ref().is_some_and(|one| Some(one.from) == earliest) {
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

			match landing(html, start, anchor)? {
				Landing::Content => {
					out.write(&html[at..start]);
					let (expression, raw) = self.hole(index)?;
					let escape = if raw { ir::Escape::Raw } else { ir::Escape::Content };
					let path = self.path(&expression)?;
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
					// A decision owns the whole attribute, including the space before its name and
					// the scoping hash Svelte appended inside it, because each outcome already holds
					// what Svelte would have written -- up to and including writing nothing at all.
					if let Some(choice) = self.choice(index)? {
						for node in self.decide(&choice)? {
							out.push(node);
						}
					} else {
						let node = self.attribute(&name, html, value_from, close)?;
						out.push(node);
					}
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
			let path = self.path(&expression)?;
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

	/// Writes a dynamic element: the tag put back where the stand-in stood, and what it decides.
	///
	/// `element()` is four shapes and the tag chooses between them, so the tag is a value written
	/// twice and the rest is nested decisions over it. The children sit in one branch only, which
	/// is what keeps them from being walked twice: a void tag is the else of "not void", and the
	/// empty comment a raw text element leaves out is a decision inside that.
	///
	/// What `is_void`, `is_raw_text_element` and the tag name regex are travels in the expressions
	/// the walk wrote, so neither backend keeps a list of its own. See `pkgs/skeleton/src/tags.ts`.
	fn dynamic(&mut self, html: &str, span: &Dynamic, out: &mut Out) -> Result<()> {
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
		if !matches!(block.kind, Kind::Element) || index != span.index {
			return Err(format!(
				"the render holds a dynamic element where block {index} is not one, which means the \
				 walk and the render stopped agreeing about the order"
			));
		}

		let tests = block.tests.clone();
		let expression = block.expression.clone();
		let [written, not_void, not_raw] = <[String; 3]>::try_from(tests)
			.map_err(|_| "a dynamic element without its three tests".to_owned())?;
		let tag = self.path(&expression)?;
		let written = self.path(&written)?;
		let not_void = self.path(&not_void)?;
		let not_raw = self.path(&not_raw)?;

		// The attributes are read as a region so that a value in them lands the way any other
		// attribute's does, anchored at the `<` the stand-in opened.
		let mut attributes = Out::default();
		self.region_from(
			html,
			span.attributes,
			span.opened,
			&mut attributes,
			span.from + EMPTY.len(),
		)?;
		let mut children = Out::default();
		self.region(html, span.opened + 1, span.content, &mut children)?;

		let mut open = Out::default();
		open.write("<");
		// Escaped as content, which changes nothing a valid tag name contains and leaves nothing
		// that could close the tag it is being written into.
		open.push(ir::Node::Slot { path: tag.clone(), escape: ir::Escape::Content });
		let mut body = open.finish();
		body.extend(attributes.finish());
		let mut rest = Out::default();
		rest.write(">");
		let mut closed = Out::default();
		closed.push(ir::Node::If {
			branches: vec![
				ir::Branch { test: Some(not_raw), body: vec![ir::Node::Static { s: EMPTY.to_owned() }] },
				ir::Branch { test: None, body: Vec::new() },
			],
		});
		closed.write("</");
		closed.push(ir::Node::Slot { path: tag, escape: ir::Escape::Content });
		closed.write(">");
		let mut inner = children.finish();
		inner.extend(closed.finish());
		rest.push(ir::Node::If {
			branches: vec![
				ir::Branch { test: Some(not_void), body: inner },
				ir::Branch { test: None, body: Vec::new() },
			],
		});
		body.extend(rest.finish());

		out.write(EMPTY);
		out.push(ir::Node::If {
			branches: vec![
				ir::Branch { test: Some(written), body },
				ir::Branch { test: None, body: Vec::new() },
			],
		});
		out.write(EMPTY);
		Ok(())
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
			Kind::Element => Err(
				"a dynamic element was met where a block's anchors were expected, which means the \
				 render and the block list stopped agreeing about the order"
					.to_owned(),
			),
			Kind::Each => {
				let source = self.path(&block.expression.clone())?;
				let item = block
					.item
					.clone()
					.ok_or_else(|| "an each block without an iteration variable".to_owned())?;
				let index = block.counter.clone();
				let binds = block.binds.clone();
				// The body is walked with what the block binds in scope, so a derivation inside it
				// can be told from a path: one is computed once, the other resolved per item. A
				// destructuring binds names rather than the element, and it is those names an
				// expression could reach for, so they are what goes in scope.
				let depth = self.locals.len();
				if binds.is_empty() {
					self.locals.push(item.clone());
				} else {
					for (name, _) in &binds {
						self.locals.push(name.clone());
					}
				}
				if let Some(counter) = index.clone() {
					self.locals.push(counter);
				}
				let mut body = Out::default();
				let walked = self.region(html, span.content, span.until, &mut body);
				self.locals.truncate(depth);
				walked?;
				out.write(&html[span.from..span.content]);
				out.push(ir::Node::Each { source, item, index, binds, body: body.finish() });
				Ok(())
			}
			Kind::If => {
				// One block, one branch per test, and a last one for the else. A chain of
				// `{:else if}` arrives here flattened, the way Svelte's own transform writes it.
				let tests = if block.tests.is_empty() {
					vec![block.expression.clone()]
				} else {
					block.tests.clone()
				};
				let mut paths = Vec::with_capacity(tests.len());
				for test in &tests {
					paths.push(self.path(test)?);
				}

				let mut branches = Vec::with_capacity(paths.len() + 1);
				// The first branch is the render being walked. The branch marker belongs to the
				// branch, because which one is written is only known per request; Svelte put it at
				// the head of the span it opened.
				let mut first = Out::default();
				first.write(&html[span.from..span.content]);
				self.region(html, span.content, span.until, &mut first)?;
				branches.push(ir::Branch { test: paths.first().cloned(), body: first.finish() });

				// The rest, each from the render made with that branch taken, keyed the way Svelte
				// numbers them: `1` upward for each `{:else if}`, and `-1` for the else.
				let rest = (1..paths.len() as i64).chain(std::iter::once(-1));
				for branch in rest {
					let key = format!("{index}.{branch}");
					let rendered = self.skeleton.alternates.get(&key).ok_or_else(|| {
						format!("no render was made with branch {branch} of block {index} taken")
					})?;
					// The alternate is taken from the same stream the block lives in, and the head's
					// title is split off there too so the two renders are read the same way.
					let other = match self.stream {
						Stream::Body => rendered.body.as_str(),
						Stream::Head => split_off_title(&rendered.head)?.0,
					};
					let mut body = Out::default();
					// Found by counting within the stream, because that is how it was walked.
					let at = self.locate(other, ordinal)?;
					body.write(&other[at.from..at.content]);
					// The cursor is not rewound between branches. Blocks are numbered by the source
					// walk in the order it takes them -- this branch's after the last one's -- and
					// this walk takes them in the same order, so continuing is what lines the two up.
					self.region(other, at.content, at.until, &mut body)?;
					let test = if branch < 0 {
						None
					} else {
						paths.get(branch as usize).cloned()
					};
					branches.push(ir::Branch { test, body: body.finish() });
				}

				out.push(ir::Node::If { branches });
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
		locals: Vec::new(),
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
