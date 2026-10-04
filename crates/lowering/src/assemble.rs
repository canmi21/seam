//! Builds the IR out of what Svelte rendered, rather than out of bytes written here.
//!
//! The component is rewritten so it renders with no data: every expression becomes a string
//! literal holding a sentinel, every if is written as a constant, and every each iterates one
//! element. Every anchor, every escaping decision and every whitespace choice in the result is
//! Svelte's, so none of them is reproduced. What is left is splitting the string.

mod blocks;
mod derive;
mod head;
mod out;
mod scan;
mod skeleton;

pub(crate) use derive::unparenthesised;
pub use skeleton::{Block, Choice, Hole, Kind, Rendered, Result, Skeleton, Stream};

use scan::{
	Dynamic, EMPTY, Landing, Mark, Span, closes, id_name, landing, next_block, next_dynamic,
	next_title, sentinel_at, stamped,
};

use head::split_head;
use out::Out;
use std::collections::BTreeMap;

use crate::ir;

struct Assembler<'a> {
	skeleton: &'a Skeleton,
	derivations: Vec<ir::Derivation>,
	/// The name each expression already has one under, so a text read twice is one derivation and
	/// one value. See `Assembler::path`.
	derived: BTreeMap<(String, Vec<String>, bool), String>,
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
	/// The bodies `Call` nodes walk, by name, collected as their blocks are met.
	fragments: BTreeMap<String, Vec<ir::Node>>,
	/// Set while a held value of an each's item is being named: it is computed per item wherever it
	/// is first met, which may be a boundary's run outside the loop. See `Held::item`.
	forcing: bool,
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
			let title = next_title(html, at, until);

			let first = [
				block.as_ref().map(|one| one.from),
				sentinel.map(|one| one.0),
				dynamic.as_ref().map(|one| one.from),
				title.as_ref().map(|one| one.from),
			];
			let earliest = first.iter().flatten().min().copied();

			// A title where Svelte executed it, as a node the injector decides rather than bytes.
			if title.as_ref().is_some_and(|one| Some(one.from) == earliest) {
				let span = title.ok_or_else(|| "unreachable".to_owned())?;
				out.write(&html[at..span.from]);
				let mut body = Out::default();
				self.region(html, span.content, span.until, &mut body)?;
				out.push(ir::Node::Title { role: span.role, body: body.finish() });
				at = span.to;
				continue;
			}

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
				let Some((index, from, after)) = stamped(html, span.to) else {
					out.write(&html[span.from..span.content]);
					self.region(html, span.content, span.until, out)?;
					out.write(&html[span.until..span.to]);
					at = span.to;
					continue;
				};
				self.block(html, &span, index, out)?;
				// Up to the stamp rather than up to the block's close: what sits between them is the
				// author's own whitespace, which the stamp was written in front of.
				if !self.bare(index) {
					out.write(&html[span.until..from]);
				} else if from > span.to {
					out.write(&html[span.to..from]);
				}
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

			// A call of a fragment: the runtime binds the parameters and walks the body again.
			if let Some(call) = self.skeleton.holes.get(index).and_then(|hole| hole.call.clone()) {
				out.write(&html[at..start]);
				let (_, _, files) = self.hole(index)?;
				let binds = self.binds(&call.binds, &files)?;
				out.push(ir::Node::Call { fragment: call.fragment, binds });
				at = end;
				continue;
			}
			// A `$props.id()` in a component the walk entered, whose hole the walk allocated so that
			// the child's own expressions can read it by name. The first place its marker lands is
			// the anchor Svelte writes at the head of the component, which is where the runtime
			// counts the id out and binds it; every later landing is a read of the binding, wherever
			// the render put the id -- the component computes with the marker as its id.
			if self.skeleton.holes.get(index).is_some_and(|hole| hole.fresh) {
				out.write(&html[at..start]);
				let (expression, _, _) = self.hole(index)?;
				let first = self.consumed[index] == 1;
				out.push(ir::Node::Slot { path: expression, escape: ir::Escape::Content, fresh: first });
				at = end;
				continue;
			}
			match landing(html, start, anchor)? {
				Landing::Content => {
					out.write(&html[at..start]);
					let (expression, raw, files) = self.hole(index)?;
					let escape = if raw { ir::Escape::Raw } else { ir::Escape::Content };
					let path = self.path(&expression, &files)?;
					out.push(ir::Node::Slot { path, escape, fresh: false });
					at = end;
				}
				Landing::Attribute { name, opens_at } => {
					out.write(&html[at..opens_at]);
					// A spread takes the run rather than an attribute in it: everything from the
					// space before the first name to the `>` that closes the tag is one value.
					if self.skeleton.holes.get(index).is_some_and(|hole| hole.spread) {
						let (expression, _, files) = self.hole(index)?;
						let path = self.path(&expression, &files)?;
						out.push(ir::Node::Slot { path, escape: ir::Escape::Raw, fresh: false });
						// A dynamic element's attributes are read as a region that ends at the `>`,
						// so there the run is the rest of the region.
						at = closes(html, opens_at, until).unwrap_or(until);
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
					// A hole that is the whole attribute: `attr_class(...)` writes the space, the
					// name and the value, or nothing, so the run from the space to the closing quote
					// is one raw value.
					if self.skeleton.holes.get(index).is_some_and(|hole| hole.whole) {
						let (expression, _, files) = self.hole(index)?;
						let path = self.path(&expression, &files)?;
						out.push(ir::Node::Slot { path, escape: ir::Escape::Raw, fresh: false });
						at = close + 1;
						continue;
					}
					// A decision owns the whole attribute, including the space before its name and
					// the scoping hash Svelte appended inside it, because each outcome already holds
					// what Svelte would have written -- up to and including writing nothing at all.
					if let Some((choice, files)) = self.choice(index)? {
						for node in self.decide(&choice, &files)? {
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
					let (expression, _, files) = self.hole(index)?;
					let path = self.path(&expression, &files)?;
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
		let files = block.files.clone();
		let tag = self.path(&expression, &files)?;
		let written = self.path(&written, &files)?;
		let not_void = self.path(&not_void, &files)?;
		let not_raw = self.path(&not_raw, &files)?;

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

	/// What a call binds each of a fragment's parameters to, as paths or derivations resolved
	/// where the call sits.
	fn binds(
		&mut self,
		binds: &[(String, String)],
		files: &[String],
	) -> Result<Vec<(String, String)>> {
		let mut found = Vec::with_capacity(binds.len());
		for (name, expression) in binds {
			found.push((name.clone(), self.path(expression, files)?));
		}
		Ok(found)
	}

	/// Whether the block's anchors stay out of the bytes. See `Block::bare`.
	fn bare(&self, index: usize) -> bool {
		self.skeleton.blocks.get(index).is_some_and(|block| block.bare)
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
				if stamped(html, span.to).is_some_and(|(found, _, _)| found == want) {
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
		derived: BTreeMap::new(),
		consumed: vec![0; skeleton.holes.len()],
		stream: Stream::Body,
		locals: Vec::new(),
		fresh: skeleton
			.holes
			.iter()
			.filter(|hole| hole.fresh)
			.map(|hole| hole.expression.clone())
			.collect(),
		fragments: BTreeMap::new(),
		forcing: false,
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
	let (script_bytes, head_bytes, title_bytes, style_bytes) = split_head(&skeleton.head)?;

	assembler.stream = Stream::Head;
	let mut head = Out::default();
	if !head_bytes.is_empty() {
		assembler.region(head_bytes, 0, head_bytes.len(), &mut head)?;
	}

	// What is left in Svelte's channel is a title from a component the walk did not enter: the
	// walk's own titles stand in the head stream as `Title` nodes. See `spec/ir.md`.
	let mut title = Out::default();
	if !title_bytes.is_empty() {
		assembler.region(title_bytes, 0, title_bytes.len(), &mut title)?;
	}
	assembler.placed()?;
	// Nothing this pass planted may reach the bytes. A stamp names a block for the assembler and a
	// sentinel stands for a value; either one left in a static run means a block was not recognised
	// where it closed, and the artifact would ship the marker itself. Measured on a recursive
	// component whose body is one `{#each}`: the bare block wrapping the body and the each end at
	// the same place, their stamps land together, and only the first is read -- the each was never
	// assembled and `%%b1%%` stayed in the output. See `spec/ir.md`.
	for (stream, nodes) in [("body", &out), ("head", &head), ("title", &title)] {
		if let Some(found) = nodes.planted() {
			return Err(format!(
				"`{found}` is left in the {stream} this pass assembled. A block or a value was not \
				 recognised where the render put it, and the artifact would write the marker out. \
				 See spec/ir.md"
			));
		}
	}

	Ok(ir::Compiled {
		ir: ir::ComponentIR {
			component: component.to_owned(),
			body: out.finish(),
			head: if script_bytes.is_empty() {
				head.finish()
			} else {
				let mut nodes = vec![ir::Node::Static { s: script_bytes.to_owned() }];
				nodes.extend(head.finish());
				nodes
			},
			title: title.finish(),
			styles: if style_bytes.is_empty() {
				Vec::new()
			} else {
				vec![ir::Node::Static { s: style_bytes.to_owned() }]
			},
			fragments: assembler.fragments,
		},
		derivations: assembler.derivations,
	})
}
