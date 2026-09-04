use std::collections::BTreeMap;

use crate::ir;
use crate::markup;

/// Elements HTML gives no closing tag. Svelte writes them self-closed, `<br/>` with no space.
const VOID: &[&str] = &[
	"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track",
	"wbr",
];

pub type Result<T> = std::result::Result<T, String>;

/// What a name resolves to once a component's props have been substituted. A literal is the
/// interesting case: a prop passed as text makes the child's slot disappear into the skeleton,
/// which is compile-time rendering doing exactly what it is for.
#[derive(Debug, Clone)]
enum Binding {
	Path(String),
	Literal(String),
}

struct Scope<'a> {
	/// `None` for the entry component, whose props are the payload and need no substitution.
	props: Option<&'a BTreeMap<String, Binding>>,
	/// Names bound by an each block, which belong to the component and are not props.
	locals: Vec<String>,
}

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

/// Svelte's own sets, from svelte/src/escaping.js. Applied here because a literal substituted at
/// compile time has to carry the escaping the runtime would have given it.
fn escape(text: &str, mode: ir::Escape) -> String {
	let mut out = String::with_capacity(text.len());
	for c in text.chars() {
		match (c, mode) {
			('&', ir::Escape::Content | ir::Escape::Attr) => out.push_str("&amp;"),
			('<', ir::Escape::Content | ir::Escape::Attr) => out.push_str("&lt;"),
			('"', ir::Escape::Attr) => out.push_str("&quot;"),
			_ => out.push(c),
		}
	}
	out
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

/// `p.name`, `t`, `p.tags`. Anything else is refused rather than interpreted: the protocol never
/// evaluates a Svelte expression, and an IR that accepts one comparison grows an evaluator. See
/// spec/ir.md.
fn resolve(scope: &Scope, source: &str) -> Result<Binding> {
	let trimmed = source.trim();
	if !is_path(trimmed) {
		return Err(format!("`{trimmed}` is not a data path; derive it into a payload field first"));
	}

	let (head, rest) = match trimmed.split_once('.') {
		Some((head, rest)) => (head, Some(rest)),
		None => (trimmed, None),
	};

	if scope.locals.iter().any(|local| local == head) {
		return Ok(Binding::Path(trimmed.to_owned()));
	}

	let Some(props) = scope.props else {
		return Ok(Binding::Path(trimmed.to_owned()));
	};

	match props.get(head) {
		Some(Binding::Path(path)) => Ok(Binding::Path(match rest {
			Some(rest) => format!("{path}.{rest}"),
			None => path.clone(),
		})),
		Some(Binding::Literal(text)) => match rest {
			None => Ok(Binding::Literal(text.clone())),
			Some(rest) => Err(format!("`{head}` was passed a literal, so `.{rest}` has nothing to read")),
		},
		None => Err(format!("`{head}` is not among the props this component was given")),
	}
}

fn slot(
	builder: &mut Builder,
	scope: &Scope,
	derivations: &mut Derivations,
	source: &str,
	mode: ir::Escape,
) -> Result<()> {
	// Not a path, so it becomes one: the expression moves to a derived field and the slot reads
	// that field. The protocol still only ever tests and interpolates paths.
	if !is_path(source.trim()) {
		let name = derivations.add(scope, source)?;
		builder.push(ir::Node::Slot { path: name, escape: mode });
		return Ok(());
	}
	match resolve(scope, source)? {
		Binding::Path(path) => builder.push(ir::Node::Slot { path, escape: mode }),
		Binding::Literal(text) => builder.write(&escape(&text, mode)),
	}
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
		markup::Node::Component { name, .. } => format!("<{name} />"),
		markup::Node::Unsupported { kind, .. } => format!("a {kind}"),
	}
}

fn attributes(
	builder: &mut Builder,
	ctx: &Context,
	scope: &Scope,
	derivations: &mut Derivations,
	attrs: &[markup::Attr],
) -> Result<()> {
	for attr in attrs {
		match attr {
			// Svelte serialises no event handler, so neither does this. The name is the whole
			// test, which is Svelte's own rule and not a heuristic about the value.
			markup::Attr::Attr { name, .. } if name.starts_with("on") && name.len() > 2 => {}
			markup::Attr::Attr { name, value } => match value {
				markup::AttrValue::Present(true) => builder.write(&format!(" {name}=\"\"")),
				markup::AttrValue::Present(false) => {}
				markup::AttrValue::Parts(parts) => {
					attribute(builder, ctx, scope, derivations, name, parts)?;
				}
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
fn attribute(
	builder: &mut Builder,
	ctx: &Context,
	scope: &Scope,
	derivations: &mut Derivations,
	name: &str,
	parts: &[markup::Node],
) -> Result<()> {
	let mut inner = Builder::default();
	for part in parts {
		match part {
			markup::Node::Text { v } => inner.write(v),
			markup::Node::Expr { src } => slot(&mut inner, scope, derivations, src, ir::Escape::Attr)?,
			other => return Err(format!("attribute `{name}` contains {}", describe(other))),
		}
	}
	let _ = ctx;

	let nodes = inner.finish();
	// A substituted literal leaves nothing dynamic behind, so the attribute goes back into the
	// static chunk it would have come from had it been written literally.
	if let [ir::Node::Static { s }] = nodes.as_slice() {
		builder.write(&format!(" {name}=\"{s}\""));
		return Ok(());
	}
	if nodes.is_empty() {
		builder.write(&format!(" {name}=\"\""));
		return Ok(());
	}
	builder.push(ir::Node::Attr {
		name: name.to_owned(),
		presence: crate::attributes::presence(name),
		parts: nodes,
	});
	Ok(())
}

struct Context<'a> {
	bundle: &'a markup::Bundle,
	module: &'a markup::Module,
	/// Component ids currently being inlined, so a cycle is an error rather than a hang.
	stack: Vec<String>,
}

/// Collected as lowering walks, because an expression that is not a path becomes a field on the
/// payload rather than an error.
#[derive(Default)]
struct Derivations {
	list: Vec<ir::Derivation>,
}

impl Derivations {
	/// The expression is carried unrewritten, with the names it may use and where each comes
	/// from. Rewriting it would mean parsing JavaScript in Rust, which is the thing being
	/// avoided; carrying the scope moves that work to whatever already speaks JavaScript.
	fn add(&mut self, scope: &Scope, expression: &str) -> Result<String> {
		if !scope.locals.is_empty() {
			return Err(format!(
				"`{expression}` is inside an each block, and a derivation is computed once per \
				 request rather than once per item"
			));
		}
		let captured = scope.props.map(|props| {
			props
				.iter()
				.map(|(name, binding)| {
					let source = match binding {
						Binding::Path(path) => ir::Source::Path(path.clone()),
						Binding::Literal(text) => ir::Source::Literal(text.clone()),
					};
					(name.clone(), source)
				})
				.collect()
		});
		let name = format!("__d{}", self.list.len());
		self.list.push(ir::Derivation {
			name: name.clone(),
			expression: expression.trim().to_owned(),
			scope: captured,
		});
		Ok(name)
	}
}

/// A fragment whose content gets spliced into a stream -- the root, and an each body, whose
/// iterations concatenate -- needs a marker before a leading text node, because the client
/// cannot otherwise find where it starts. An element or a block opens with something locatable
/// and needs none. Measured across each fragment kind, not derived.
fn leading_anchor(source: &[markup::Node]) -> bool {
	matches!(
		source.first(),
		Some(markup::Node::Text { .. } | markup::Node::Expr { .. } | markup::Node::Html { .. })
	)
}

/// `anchored` says the fragment's end already carries a marker of its own -- the root, an if
/// branch, an each body. Svelte omits a component's trailing anchor exactly there, and writes it
/// everywhere else. That rule is read out of its server codegen rather than derived.
fn nodes(
	builder: &mut Builder,
	ctx: &Context,
	scope: &Scope,
	derivations: &mut Derivations,
	source: &[markup::Node],
	anchored: bool,
) -> Result<()> {
	for (index, node) in source.iter().enumerate() {
		let last = index + 1 == source.len();
		match node {
			markup::Node::Text { v } => builder.write(v),

			markup::Node::Expr { src } => slot(builder, scope, derivations, src, ir::Escape::Content)?,

			// Svelte brackets raw HTML with a pair of empty comments, so the anchors are static
			// and only the content between them is a slot.
			markup::Node::Html { src } => {
				builder.write("<!---->");
				slot(builder, scope, derivations, src, ir::Escape::Raw)?;
				builder.write("<!---->");
			}

			markup::Node::Element { name, attrs, body } => {
				builder.write(&format!("<{name}"));
				attributes(builder, ctx, scope, derivations, attrs)?;
				if VOID.contains(&name.as_str()) {
					builder.write("/>");
					continue;
				}
				builder.write(">");
				nodes(builder, ctx, scope, derivations, body, false)?;
				builder.write(&format!("</{name}>"));
			}

			markup::Node::If { test, consequent, alternate } => {
				// Branch 0 is the `if`, and -1 is the else or nothing matching at all -- Svelte
				// writes the same marker for both. The marker belongs to the branch rather than
				// to the block, because which one is written is only known per request.
				// A literal test is a constant branch, but Svelte still writes the marker for
				// whichever branch it took, so folding it away would not match its bytes.
				let path = if is_path(test.trim()) {
					match resolve(scope, test)? {
						Binding::Path(path) => path,
						Binding::Literal(_) => {
							return Err(format!("`{test}` resolves to a literal, which an if cannot test"));
						}
					}
				} else {
					derivations.add(scope, test)?
				};

				let mut taken = Builder::default();
				taken.write("<!--[0-->");
				nodes(&mut taken, ctx, scope, derivations, consequent, true)?;

				let mut otherwise = Builder::default();
				otherwise.write("<!--[-1-->");
				if let Some(alternate) = alternate {
					nodes(&mut otherwise, ctx, scope, derivations, alternate, true)?;
				}

				builder.push(ir::Node::If {
					branches: vec![
						ir::Branch { test: Some(path), body: taken.finish() },
						ir::Branch { test: None, body: otherwise.finish() },
					],
				});
				builder.write("<!--]-->");
			}

			markup::Node::Each { source: from, item, index: at, key, body, fallback } => {
				if fallback.is_some() {
					return Err("`{:else}` on an each block is not in the protocol yet".to_owned());
				}
				// A key changes nothing here: Svelte's own server transform never mentions one, and
				// a keyed each renders byte for byte what an unkeyed one renders. It belongs to the
				// client, which compiles from the source and keeps it.
				let _ = key;
				let Some(item) = item else {
					return Err("an each block without an iteration variable is not handled yet".to_owned());
				};
				let Binding::Path(from) = resolve(scope, from)? else {
					return Err("an each block cannot iterate a literal".to_owned());
				};
				if !is_path(item) {
					return Err(format!("`{item}` is not a name an each block can bind"));
				}

				let mut inner_scope = Scope { props: scope.props, locals: scope.locals.clone() };
				inner_scope.locals.push(item.clone());
				// The counter is a name of the block's own, bound beside the item rather than
				// reached through it. Svelte's server makes it the `for` loop's variable.
				if let Some(at) = at.clone() {
					if !is_path(&at) {
						return Err(format!("`{at}` is not a name an each block can bind"));
					}
					inner_scope.locals.push(at);
				}

				let mut inner = Builder::default();
				if leading_anchor(body) {
					inner.write("<!---->");
				}
				nodes(&mut inner, ctx, &inner_scope, derivations, body, true)?;
				// The open and close markers sit outside the node: one pair for the block, not
				// one per iteration.
				builder.write("<!--[-->");
				// This path writes the bytes from the markup rather than reading them off a render,
				// and it has never been taught a destructuring context. Rejected rather than emitted
				// with the pattern standing where a name goes, which would be an IR that resolves
				// nothing and says so nowhere.
				if !item.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '$') {
					return Err(format!(
						"`{item}` is a destructuring, which writing the bytes has not been taught; the \
						 render pass takes it"
					));
				}
				builder.push(ir::Node::Each {
					source: from,
					item: item.clone(),
					index: at.clone(),
					binds: Vec::new(),
					body: inner.finish(),
				});
				builder.write("<!--]-->");
			}

			markup::Node::Component { name, props, body } => {
				if !body.is_empty() {
					return Err(format!("<{name}> was given children, which needs snippets"));
				}
				compose(builder, ctx, scope, derivations, name, props)?;
				if !(last && anchored) {
					builder.write("<!---->");
				}
			}

			markup::Node::Unsupported { kind, src } => {
				return Err(format!("`{src}` is a {kind}, which lowering does not handle yet"));
			}
		}
	}
	Ok(())
}

/// Inlines a child rather than referring to it. Every prop value is already a path or a literal,
/// so the child's own paths can be rewritten at compile time and the runtime needs no notion of
/// a component at all. It also means a prop passed as text disappears into the skeleton.
fn compose(
	builder: &mut Builder,
	ctx: &Context,
	scope: &Scope,
	derivations: &mut Derivations,
	name: &str,
	props: &[markup::Attr],
) -> Result<()> {
	let Some(id) = ctx.module.imports.get(name) else {
		return Err(format!("<{name} /> is not imported from a .svelte file"));
	};
	if ctx.stack.iter().any(|seen| seen == id) {
		return Err(format!("<{name} /> is part of a cycle: {}", ctx.stack.join(" -> ")));
	}
	let Some(child) = ctx.bundle.components.get(id) else {
		return Err(format!("<{name} /> resolves to `{id}`, which the bundle does not carry"));
	};

	let mut bindings = BTreeMap::new();
	for prop in props {
		match prop {
			markup::Attr::Attr { name: prop, value } => match value {
				markup::AttrValue::Present(true) => {
					bindings.insert(prop.clone(), Binding::Literal("true".to_owned()));
				}
				markup::AttrValue::Present(false) => {}
				markup::AttrValue::Parts(parts) => match parts.as_slice() {
					[markup::Node::Expr { src }] => {
						bindings.insert(prop.clone(), resolve(scope, src)?);
					}
					parts if parts.iter().all(|p| matches!(p, markup::Node::Text { .. })) => {
						let mut text = String::new();
						for part in parts {
							if let markup::Node::Text { v } = part {
								text.push_str(v);
							}
						}
						bindings.insert(prop.clone(), Binding::Literal(text));
					}
					_ => {
						return Err(format!(
							"prop `{prop}` on <{name} /> mixes text and expressions, which has no \
							 value to pass until it is computed"
						));
					}
				},
			},
			markup::Attr::Unsupported { kind, src } => {
				return Err(format!("`{src}` on <{name} /> is a {kind}, which is not handled yet"));
			}
		}
	}

	let mut stack = ctx.stack.clone();
	stack.push(id.clone());
	let inner = Context { bundle: ctx.bundle, module: child, stack };
	let scope = Scope { props: Some(&bindings), locals: Vec::new() };
	nodes(builder, &inner, &scope, derivations, &child.markup, false)
}

pub fn lower(bundle: &markup::Bundle) -> Result<ir::Compiled> {
	let Some(module) = bundle.components.get(&bundle.entry) else {
		return Err(format!("the bundle has no entry `{}`", bundle.entry));
	};
	let ctx = Context { bundle, module, stack: vec![bundle.entry.clone()] };
	let scope = Scope { props: None, locals: Vec::new() };
	let mut derivations = Derivations::default();

	let mut builder = Builder::default();
	// Svelte wraps every component render in this pair, and only the outermost one: a child is
	// spliced in without a boundary of its own.
	//
	// The root fragment suppresses a trailing component anchor only when the component is the
	// whole fragment. With a sibling anywhere, the anchor comes back -- measured, not derived,
	// and the reason the conformance corpus carries a case for each position.
	builder.write("<!--[-->");
	if leading_anchor(&module.markup) {
		builder.write("<!---->");
	}
	nodes(&mut builder, &ctx, &scope, &mut derivations, &module.markup, module.markup.len() == 1)?;
	builder.write("<!--]-->");

	Ok(ir::Compiled {
		// This pass refuses `<svelte:head>`, so its head is empty by construction rather than by
		// omission.
		ir: ir::ComponentIR {
			component: bundle.entry.clone(),
			body: builder.finish(),
			head: Vec::new(),
			title: Vec::new(),
		},
		derivations: derivations.list,
	})
}
