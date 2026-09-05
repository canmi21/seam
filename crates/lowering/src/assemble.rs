//! Builds the IR out of what Svelte rendered, rather than out of bytes written here.
//!
//! The component is rewritten so it renders with no data: every expression becomes a string
//! literal holding a sentinel, every if is written as a constant, and every each iterates one
//! element. Every anchor, every escaping decision and every whitespace choice in the result is
//! Svelte's, so none of them is reproduced. What is left is splitting the string.

mod derive;
mod scan;
mod skeleton;

pub use skeleton::{Block, Choice, Hole, Kind, Rendered, Result, Skeleton, Stream};

use scan::{
	Dynamic, EMPTY, Landing, Mark, Span, closes, id_name, landing, next_block, next_dynamic,
	sentinel_at, stamped,
};

use crate::ir;

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
	/// The stream being walked. A block is numbered across the whole source but appears in one
	/// stream only, and an alternate is read from the same stream the block lives in.
	stream: Stream,
	/// Names an enclosing each block binds. A derivation is computed once against the payload, so
	/// one that reads a name bound per item has no value to be computed from. See spec/ir.md.
	locals: Vec<String>,
	/// The names the ids are bound under, which the runtime decides where they are written: a
	/// derivation reading one is computed where it is used, as one reading an each binding is.
	fresh: Vec<String>,
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
				// A component the walk did not enter writes its own anchors, and they are bytes: the
				// pair is copied out and what sits between it is walked exactly as anything else is,
				// because markup handed to that component renders inside it and those blocks are
				// ours. Stepping over the whole span instead would lose them; treating the close as
				// text would end this region at the first one.
				let Some((index, after)) = stamped(html, span.to) else {
					out.write(&html[span.from..span.content]);
					self.region(html, span.content, span.until, out)?;
					out.write(&html[span.until..span.to]);
					at = span.to;
					continue;
				};
				self.block(html, &span, index, out)?;
				out.write(&html[span.until..span.to]);
				at = after;
				continue;
			}

			let Some((start, end, mark)) = sentinel else {
				out.write(&html[at..until]);
				return Ok(());
			};

			// An id of a component the walk did not enter. It sits inside `<!--$` and `-->`, which
			// `landing` would read as a tag, and it names no path to resolve: the runtime counts the
			// value out and binds it. See `pkgs/skeleton/src/fresh.ts`.
			if let Mark::Id { name, anchor: fresh } = mark {
				out.write(&html[at..start]);
				out.push(ir::Node::Slot { path: id_name(name), escape: ir::Escape::Content, fresh });
				at = end;
				continue;
			}
			let Mark::Hole(index) = mark else { unreachable!() };

			// The anchor of a `$props.id()` in a component the walk entered, whose hole the walk
			// allocated so that the child's own expressions can read it by name.
			if self.skeleton.holes.get(index).is_some_and(|hole| hole.fresh) {
				out.write(&html[at..start]);
				let (expression, _) = self.hole(index)?;
				out.push(ir::Node::Slot { path: expression, escape: ir::Escape::Content, fresh: true });
				at = end;
				continue;
			}
			match landing(html, start, anchor)? {
				Landing::Content => {
					out.write(&html[at..start]);
					let (expression, raw) = self.hole(index)?;
					let escape = if raw { ir::Escape::Raw } else { ir::Escape::Content };
					let path = self.path(&expression)?;
					out.push(ir::Node::Slot { path, escape, fresh: false });
					at = end;
				}
				Landing::Attribute { name, opens_at } => {
					out.write(&html[at..opens_at]);
					// A spread takes the run rather than an attribute in it: everything from the
					// space before the first name to the `>` that closes the tag is one value.
					if self.skeleton.holes.get(index).is_some_and(|hole| hole.spread) {
						let (expression, _) = self.hole(index)?;
						let path = self.path(&expression)?;
						out.push(ir::Node::Slot { path, escape: ir::Escape::Raw, fresh: false });
						at = closes(html, opens_at, until)
							.ok_or_else(|| "an element whose attributes are spread is never closed".to_owned())?;
						continue;
					}
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
		while let Some((start, end, mark)) = sentinel_at(html, at, until) {
			parts.write(&html[at..start]);
			match mark {
				// An id read inside an attribute value, which is where a package puts the id of the
				// thing it points at: `aria-controls="bits-s3"`.
				Mark::Id { name, anchor } => parts.push(ir::Node::Slot {
					path: id_name(name),
					escape: ir::Escape::Attr,
					fresh: anchor,
				}),
				Mark::Hole(index) => {
					let (expression, _) = self.hole(index)?;
					let path = self.path(&expression)?;
					parts.push(ir::Node::Slot { path, escape: ir::Escape::Attr, fresh: false });
				}
			}
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
		// The stand-in tag carries its own number, so a dynamic element needs no stamp: nothing a
		// component writes can look like one.
		let index = span.index;
		let block = self.skeleton.blocks.get(index).ok_or_else(|| {
			format!("the render holds a stand-in for a block {index} that was never declared")
		})?;
		if !matches!(block.kind, Kind::Element) {
			return Err(format!(
				"the render holds a dynamic element where block {index} is not one, which means the \
				 walk and the render stopped agreeing"
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
		open.push(ir::Node::Slot { path: tag.clone(), escape: ir::Escape::Content, fresh: false });
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
		closed.push(ir::Node::Slot { path: tag, escape: ir::Escape::Content, fresh: false });
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
	fn block(&mut self, html: &str, span: &Span, index: usize, out: &mut Out) -> Result<()> {
		let block = self
			.skeleton
			.blocks
			.get(index)
			.ok_or_else(|| format!("the render stamps a block {index} the source never declared"))?;

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
				let counter = block.counter.clone();
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
				if let Some(name) = counter.clone() {
					self.locals.push(name);
				}
				let mut body = Out::default();
				let walked = self.region(html, span.content, span.until, &mut body);
				self.locals.truncate(depth);
				walked?;
				let each = ir::Node::Each { source, item, index: counter, binds, body: body.finish() };
				if !block.alternate {
					out.write(&html[span.from..span.content]);
					out.push(each);
					return Ok(());
				}

				// An each with an `{:else}` is what Svelte's own server writes it as: `if
				// (each_array.length !== 0) { <!--[--> items } else { <!--[!--> fallback }`. So it is
				// an if around the each, with the opening anchor inside the branch it belongs to,
				// and the fallback read from the render made with an empty list the way an else is
				// read from the render made with its if not taken. The test is what
				// `ensure_array_like` decides: nothing, or nothing array-like, is an empty list.
				let test = self.path(&format!("(({})?.length ?? 0) !== 0", block.expression))?;
				let mut some = Out::default();
				some.write(&html[span.from..span.content]);
				some.push(each);
				let key = format!("{index}.-1");
				let rendered = self
					.skeleton
					.alternates
					.get(&key)
					.ok_or_else(|| format!("no render was made with the each block {index} empty"))?;
				let other = match self.stream {
					Stream::Body => rendered.body.as_str(),
					Stream::Head => split_off_title(&rendered.head)?.0,
				};
				let mut none = Out::default();
				let at = self.locate(other, index)?;
				none.write(&other[at.from..at.content]);
				self.region(other, at.content, at.until, &mut none)?;
				out.push(ir::Node::If {
					branches: vec![
						ir::Branch { test: Some(test), body: some.finish() },
						ir::Branch { test: None, body: none.finish() },
					],
				});
				Ok(())
			}
			Kind::If => {
				// One block, one branch per test, and a last one for the else. A chain of
				// `{:else if}` arrives here flattened, the way Svelte's own transform writes it.
				let tests =
					if block.tests.is_empty() { vec![block.expression.clone()] } else { block.tests.clone() };
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
					// Found by its stamp, which is the same place in the other render.
					let at = self.locate(other, index)?;
					body.write(&other[at.from..at.content]);
					// The cursor is not rewound between branches. Blocks are numbered by the source
					// walk in the order it takes them -- this branch's after the last one's -- and
					// this walk takes them in the same order, so continuing is what lines the two up.
					self.region(other, at.content, at.until, &mut body)?;
					let test = if branch < 0 { None } else { paths.get(branch as usize).cloned() };
					branches.push(ir::Branch { test, body: body.finish() });
				}

				out.push(ir::Node::If { branches });
				Ok(())
			}
		}
	}

	/// One block of another render of the same stream, found by the stamp that names it.
	///
	/// It used to be found by counting opening anchors in document order, with the cursor carried
	/// between branches so the two walks stayed in step. The stamp says which block it is, so
	/// neither the counting nor the carrying is needed and neither can drift. The body is wrapped
	/// in a pair that looks like an each and the head is not, so the region to search is whichever
	/// this stream walks.
	fn locate(&self, html: &str, index: usize) -> Result<Span> {
		fn walk(html: &str, from: usize, until: usize, want: usize) -> Option<Span> {
			let mut at = from;
			while let Some(span) = next_block(html, at, until) {
				if stamped(html, span.to).is_some_and(|(found, _)| found == want) {
					return Some(span);
				}
				if let Some(found) = walk(html, span.content, span.until, want) {
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
		walk(html, from, until, index)
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
		locals: Vec::new(),
		fresh: skeleton
			.holes
			.iter()
			.filter(|hole| hole.fresh)
			.map(|hole| hole.expression.clone())
			.collect(),
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
