//! Turning the expressions the skeleton recorded into what the protocol will evaluate.
//!
//! Two questions, and they are the two `spec/pipeline.md` separates. A substitution asks what path
//! or derivation stands behind one sentinel. A decision asks what tree of tests stands behind a
//! set of enumerated outcomes. Both go through `path`, so a test and a value are one mechanism.
//!
//! `placed` is here as well, because it is the same accounting seen from the other end: every hole
//! consumed exactly once is the only evidence this pass has that the render held everything.

use super::scan::sentinel_at;
use super::skeleton::{Choice, Result};
use super::{Assembler, Out};
use crate::ir;

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
	pub(super) fn path(&mut self, expression: &str) -> Result<String> {
		let trimmed = expression.trim();
		// The parentheses substitution wraps it in decide nothing about what it is, so they come
		// off for the question and stay on for the answer: a derivation is recorded as written.
		let inner = bare(trimmed);
		if is_path(inner) {
			return Ok(inner.to_owned());
		}
		// An expression reading a name an each block binds is computed where it is used rather than
		// once before injection, because that name only exists inside the loop. It is the same pure
		// function either way; what changes is how often it is called, and that follows from what
		// its inputs are rather than from a rule about derivations. See spec/derivation.md.
		let read = reads(trimmed);
		let scoped = self.locals.iter().any(|one| read.iter().any(|name| name == one));
		let name = format!("__d{}", self.derivations.len());
		self.derivations.push(ir::Derivation {
			name: name.clone(),
			expression: trimmed.to_owned(),
			scope: None,
			scoped,
		});
		Ok(name)
	}

	/// The hole at `index` where it is a decision, consumed like any other hole when it is one.
	pub(super) fn choice(&mut self, index: usize) -> Result<Option<Choice>> {
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
	pub(super) fn decide(&mut self, choice: &Choice) -> Result<Vec<ir::Node>> {
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
	pub(super) fn pieces(&mut self, outcome: &str) -> Result<Vec<ir::Node>> {
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

	/// Reading a hole marks it used. Every hole has to be used exactly once: the render is the
	/// only evidence the compiler has, so a sentinel that never comes back in it is content that
	/// Svelte put somewhere this pass does not look, and emitting the rest as if nothing were
	/// missing is the worst available outcome.
	pub(super) fn hole(&mut self, index: usize) -> Result<(String, bool)> {
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
	pub(super) fn placed(&self) -> Result<()> {
		for (index, count) in self.consumed.iter().enumerate() {
			if *count == 1 {
				continue;
			}
			let hole = &self.skeleton.holes[index];
			// Planted in markup a component was measured not to write. Every other absence is
			// still one, which is what keeps this check from becoming a formality.
			if *count == 0 && hole.safe {
				continue;
			}
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
				(count, None) => {
					format!("`{expression}` comes back {count} times in the render, and belongs in one place")
				}
			});
		}
		Ok(())
	}
}

/// The same expression without the parentheses that wrap the whole of it.
///
/// Substitution puts them there. A name declared in a script is replaced by `(its initialiser)`
/// and a prop by `(what the call site passed)`, so a component rendered inside an each block gets
/// `((t))` where the author wrote `t`. That is the same expression, but it is not the same string,
/// and the string is what decides whether this is a path resolved per item or a derivation
/// computed once against the payload -- so `{#each tags as t}<Badge label={t} />{/each}` compiled
/// to a derivation reading a name the payload does not carry, and was refused.
///
/// Only a pair that wraps everything is taken: `(a)(b)` opens and closes twice and is a call.
fn bare(source: &str) -> &str {
	let mut at = source;
	loop {
		let trimmed = at.trim();
		if !trimmed.starts_with('(') || !trimmed.ends_with(')') {
			return trimmed;
		}
		let mut depth = 0usize;
		let mut quote = None;
		let mut closed = None;
		for (index, c) in trimmed.char_indices() {
			if let Some(open) = quote {
				if c == '\\' {
					continue;
				}
				if c == open {
					quote = None;
				}
				continue;
			}
			match c {
				'\'' | '"' | '`' => quote = Some(c),
				'(' => depth += 1,
				')' => {
					depth -= 1;
					if depth == 0 {
						closed = Some(index);
						break;
					}
				}
				_ => {}
			}
		}
		// The first pair does not close at the end, so it wraps a part rather than the whole.
		match closed {
			Some(index) if index + 1 == trimmed.len() => at = &trimmed[1..index],
			_ => return trimmed,
		}
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
