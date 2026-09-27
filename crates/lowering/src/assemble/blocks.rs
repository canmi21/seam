//! Writing a block into the output: an each, an if with its branches, a boundary, a fragment call.
//! One arm per kind, read against what the render put around each. See spec/ir.md.

use super::Assembler;
use super::head::split_off_title;
use super::out::Out;
use super::scan::{EMPTY, Span};
use super::skeleton::{Kind, Result, Stream};
use crate::ir;

impl Assembler<'_> {
	/// Writes the block into `out`. Which side of the node an anchor falls on differs by kind:
	/// an each opens once for the whole block, so its marker is static and sits outside, while an
	/// if writes a different marker per branch and so carries it inside.
	pub(super) fn block(
		&mut self,
		html: &str,
		span: &Span,
		index: usize,
		out: &mut Out,
	) -> Result<()> {
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
				let source = self.path(&block.expression.clone(), &block.files)?;
				let item = block
					.item
					.clone()
					.ok_or_else(|| "an each block without an iteration variable".to_owned())?;
				let counter = block.counter.clone();
				// The body is walked with what the block binds in scope, so a derivation inside it
				// can be told from a path: one is computed once, the other resolved per item.
				let depth = self.locals.len();
				self.locals.push(item.clone());
				if let Some(name) = counter.clone() {
					self.locals.push(name);
				}
				let mut body = Out::default();
				let walked = self.region(html, span.content, span.until, &mut body);
				self.locals.truncate(depth);
				walked?;
				let each = ir::Node::Each { source, item, index: counter, body: body.finish() };
				// The opening anchor is Svelte's where the block is in the body, and the walk's own
				// where the block stands in the head, which the bytes do not carry. See `Block::bare`.
				if !block.alternate {
					if !block.bare {
						out.write(&html[span.from..span.content]);
					}
					out.push(each);
					return Ok(());
				}

				// An each with an `{:else}` is what Svelte's own server writes it as: `if
				// (each_array.length !== 0) { <!--[--> items } else { <!--[!--> fallback }`. So it is
				// an if around the each, with the opening anchor inside the branch it belongs to,
				// and the fallback read from the render made with an empty list the way an else is
				// read from the render made with its if not taken. The test is what
				// `ensure_array_like` decides: nothing is an empty list, one with a length is itself,
				// and a `Map` or a `Set` goes through `Array.from`, so its size is its length.
				let test = self.path(
					&format!("((({0})?.length ?? ({0})?.size) ?? 0) !== 0", block.expression),
					&block.files,
				)?;
				let mut some = Out::default();
				if !block.bare {
					some.write(&html[span.from..span.content]);
				}
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
				if !block.bare {
					none.write(&other[at.from..at.content]);
				}
				self.region(other, at.content, at.until, &mut none)?;
				out.push(ir::Node::If {
					branches: vec![
						ir::Branch { test: Some(test), body: some.finish() },
						ir::Branch { test: None, body: none.finish() },
					],
				});
				Ok(())
			}
			Kind::Boundary => {
				// Two branches, as an if: the children where nothing threw, read from the render
				// being walked, and the failed snippet, read from the render made with the children
				// throwing. The second opens with the transformed error as JSON, which in that render
				// is the build's; the request's goes in its place, unescaped, since Svelte's own
				// serialisation already escapes what could close the comment. See `spec/ir.md`.
				let [test, json] = <[String; 2]>::try_from(block.tests.clone())
					.map_err(|_| "a boundary without its test and its JSON".to_owned())?;
				let files = block.files.clone();
				let test = self.path(&test, &files)?;
				let json = self.path(&json, &files)?;
				let mut children = Out::default();
				// A bare block is the head half of a body block, and the head carries no anchors of
				// Svelte's: the opening it locates by is this compiler's own and is not written.
				if !block.bare {
					children.write(&html[span.from..span.content]);
				}
				self.region(html, span.content, span.until, &mut children)?;

				let key = format!("{index}.-1");
				let rendered = self
					.skeleton
					.alternates
					.get(&key)
					.ok_or_else(|| format!("no render was made with boundary {index} failing"))?;
				let other = match self.stream {
					Stream::Body => rendered.body.as_str(),
					Stream::Head => split_off_title(&rendered.head)?.0,
				};
				let at = self.locate(other, index)?;
				let mut failed = Out::default();
				if !block.bare {
					let opening = &other[at.from..at.content];
					if !opening.starts_with("<!--[?") {
						return Err(format!(
							"the failed branch of boundary {index} opens with `{opening}`, where Svelte writes `<!--[?`"
						));
					}
					failed.write("<!--[?");
					failed.push(ir::Node::Slot { path: json, escape: ir::Escape::Raw, fresh: false });
					failed.write("-->");
				}
				self.region(other, at.content, at.until, &mut failed)?;
				out.push(ir::Node::If {
					branches: vec![
						ir::Branch { test: Some(test), body: children.finish() },
						ir::Branch { test: None, body: failed.finish() },
					],
				});
				Ok(())
			}
			Kind::If => {
				// A fragment: the body of a recursive snippet or component, wrapped by the walk in a
				// bare `{#if true}` so that it has anchors to be found by. It is kept under its name
				// rather than written in place, with the parameters as locals inside it, and the
				// place it was found becomes the first call. See `spec/ir.md`.
				if let Some(fragment) = block.fragment.clone() {
					let depth = self.locals.len();
					self.locals.extend(fragment.params.iter().cloned());
					let mut body = Out::default();
					// `is_text_first` in `clean_nodes`: a snippet's or component's body that opens with
					// text gets an empty comment ahead of it, so the text node is not fused with its
					// surroundings while hydrating. The bare block the walk wrapped the body in is an
					// if, which gets none, so it is written back here.
					if fragment.text_first {
						body.write(EMPTY);
					}
					let walked = self.region(html, span.content, span.until, &mut body);
					self.locals.truncate(depth);
					walked?;
					self.fragments.insert(fragment.name.clone(), body.finish());
					let binds = self.binds(&fragment.binds, &block.files)?;
					out.push(ir::Node::Call { fragment: fragment.name, binds });
					return Ok(());
				}
				// One block, one branch per test, and a last one for the else. A chain of
				// `{:else if}` arrives here flattened, the way Svelte's own transform writes it.
				let tests =
					if block.tests.is_empty() { vec![block.expression.clone()] } else { block.tests.clone() };
				let mut paths = Vec::with_capacity(tests.len());
				for test in &tests {
					paths.push(self.path(test, &block.files)?);
				}

				let mut branches = Vec::with_capacity(paths.len() + 1);
				// The first branch is the render being walked. The branch marker belongs to the
				// branch, because which one is written is only known per request; Svelte put it at
				// the head of the span it opened.
				let mut first = Out::default();
				if !block.bare {
					first.write(&html[span.from..span.content]);
				}
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
					if !block.bare {
						body.write(&other[at.from..at.content]);
					}
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
}
