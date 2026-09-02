use crate::ir;
use crate::markup;

/// Elements HTML gives no closing tag. Svelte writes them self-closed, `<br/>` with no space.
const VOID: &[&str] = &[
	"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track",
	"wbr",
];

pub type Result<T> = std::result::Result<T, String>;

/// Accumulates literal output, so that a run of markup becomes one static chunk rather than one
/// per node. The injector walks nodes, so fewer nodes is less work per request.
#[derive(Default)]
struct Builder {
	nodes: Vec<ir::Node>,
	buffer: String,
}

impl Builder {
	fn write(&mut self, text: &str) {
		self.buffer.push_str(text);
	}

	fn push(&mut self, node: ir::Node) {
		self.flush();
		self.nodes.push(node);
	}

	fn flush(&mut self) {
		if !self.buffer.is_empty() {
			let s = std::mem::take(&mut self.buffer);
			self.nodes.push(ir::Node::Static { s });
		}
	}

	fn finish(mut self) -> Vec<ir::Node> {
		self.flush();
		self.nodes
	}
}

/// `p.name`, `t`, `p.tags`. Anything else is refused rather than interpreted: the protocol
/// never evaluates a Svelte expression, and an IR that accepts one comparison grows an
/// evaluator. See spec/ir.md.
fn path(source: &str) -> Result<String> {
	let trimmed = source.trim();
	let ok = !trimmed.is_empty()
		&& trimmed.split('.').all(|part| {
			let mut chars = part.chars();
			match chars.next() {
				Some(first) if first.is_ascii_alphabetic() || first == '_' || first == '$' => {
					chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
				}
				_ => false,
			}
		});
	if ok {
		Ok(trimmed.to_owned())
	} else {
		Err(format!("`{trimmed}` is not a data path; derive it into a payload field first"))
	}
}

fn attributes(builder: &mut Builder, attrs: &[markup::Attr]) -> Result<()> {
	for attr in attrs {
		match attr {
			// Svelte serialises no event handler, so neither does this. The name is the whole
			// test, which is Svelte's own rule and not a heuristic about the value.
			markup::Attr::Attr { name, .. } if name.starts_with("on") && name.len() > 2 => {}
			markup::Attr::Attr { name, value } => match value {
				markup::AttrValue::Present(true) => builder.write(&format!(" {name}=\"\"")),
				markup::AttrValue::Present(false) => {}
				markup::AttrValue::Parts(parts) => attribute(builder, name, parts)?,
			},
			markup::Attr::Unsupported { kind, src } => {
				return Err(format!("`{src}` is a {kind}, which lowering does not handle yet"));
			}
		}
	}
	Ok(())
}

/// A wholly literal attribute is written into the surrounding static chunk. One with an
/// expression anywhere becomes a node instead, because such an attribute can decide to write
/// nothing at all, and characters already committed to a static chunk cannot be taken back.
fn attribute(builder: &mut Builder, name: &str, parts: &[markup::Node]) -> Result<()> {
	if parts.iter().all(|part| matches!(part, markup::Node::Text { .. })) {
		let mut text = String::new();
		for part in parts {
			if let markup::Node::Text { v } = part {
				text.push_str(v);
			}
		}
		builder.write(&format!(" {name}=\"{text}\""));
		return Ok(());
	}

	let mut inner = Builder::default();
	for part in parts {
		match part {
			markup::Node::Text { v } => inner.write(v),
			markup::Node::Expr { src } => {
				inner.push(ir::Node::Slot { path: path(src)?, escape: ir::Escape::Attr });
			}
			other => return Err(format!("attribute `{name}` contains {}", describe(other))),
		}
	}
	builder.push(ir::Node::Attr { name: name.to_owned(), parts: inner.finish() });
	Ok(())
}

fn describe(node: &markup::Node) -> String {
	match node {
		markup::Node::Text { .. } => "text".to_owned(),
		markup::Node::Expr { src } => format!("the expression `{src}`"),
		markup::Node::Html { src } => format!("`{{@html {src}}}`"),
		markup::Node::Element { name, .. } => format!("<{name}>"),
		markup::Node::If { .. } => "an if block".to_owned(),
		markup::Node::Each { .. } => "an each block".to_owned(),
		markup::Node::Unsupported { kind, .. } => format!("a {kind}"),
	}
}

fn nodes(builder: &mut Builder, source: &[markup::Node]) -> Result<()> {
	for node in source {
		match node {
			markup::Node::Text { v } => builder.write(v),

			markup::Node::Expr { src } => {
				builder.push(ir::Node::Slot { path: path(src)?, escape: ir::Escape::Content });
			}

			// Svelte brackets raw HTML with a pair of empty comments, so the anchors are static
			// and only the content between them is a slot.
			markup::Node::Html { src } => {
				builder.write("<!---->");
				builder.push(ir::Node::Slot { path: path(src)?, escape: ir::Escape::Raw });
				builder.write("<!---->");
			}

			markup::Node::Element { name, attrs, body } => {
				builder.write(&format!("<{name}"));
				attributes(builder, attrs)?;
				if VOID.contains(&name.as_str()) {
					builder.write("/>");
					continue;
				}
				builder.write(">");
				nodes(builder, body)?;
				builder.write(&format!("</{name}>"));
			}

			markup::Node::If { test, consequent, alternate } => {
				// Branch 0 is the `if`, and -1 is the else or nothing matching at all -- Svelte
				// writes the same marker for both. The marker belongs to the branch rather than
				// to the block, because which one is written is only known per request.
				let mut taken = Builder::default();
				taken.write("<!--[0-->");
				nodes(&mut taken, consequent)?;

				let mut otherwise = Builder::default();
				otherwise.write("<!--[-1-->");
				if let Some(alternate) = alternate {
					nodes(&mut otherwise, alternate)?;
				}

				builder.push(ir::Node::If {
					branches: vec![
						ir::Branch { test: Some(path(test)?), body: taken.finish() },
						ir::Branch { test: None, body: otherwise.finish() },
					],
				});
				builder.write("<!--]-->");
			}

			markup::Node::Each { source, item, index, key, body, fallback } => {
				if fallback.is_some() {
					return Err("`{:else}` on an each block is not in the protocol yet".to_owned());
				}
				if index.is_some() || key.is_some() {
					return Err("an each block with an index or a key is not handled yet".to_owned());
				}
				let Some(item) = item else {
					return Err("an each block without an iteration variable is not handled yet".to_owned());
				};
				let mut inner = Builder::default();
				nodes(&mut inner, body)?;
				// The open and close markers sit outside the node: one pair for the block, not
				// one per iteration.
				builder.write("<!--[-->");
				builder.push(ir::Node::Each {
					source: path(source)?,
					item: path(item)?,
					body: inner.finish(),
				});
				builder.write("<!--]-->");
			}

			markup::Node::Unsupported { kind, src } => {
				return Err(format!("`{src}` is a {kind}, which lowering does not handle yet"));
			}
		}
	}
	Ok(())
}

pub fn lower(component: &str, markup: &markup::Markup) -> Result<ir::ComponentIR> {
	let mut builder = Builder::default();
	// Svelte wraps every component render in this pair. It is the composition seam as well as
	// the output seam, which is why it is written here rather than by whatever embeds the result.
	builder.write("<!--[-->");
	nodes(&mut builder, &markup.markup)?;
	builder.write("<!--]-->");
	Ok(ir::ComponentIR { component: component.to_owned(), nodes: builder.finish() })
}
