//! What the skeleton pass hands over: the render, and the record of every place a value goes.
//!
//! Deserialised rather than built here. The names and the shapes are `pkgs/skeleton/src/shape.ts`,
//! and the two have to agree because one writes what the other reads.

use std::collections::BTreeMap;

use serde::Deserialize;

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
	/// Allowed not to come back. Set by the render pass, and only on positive evidence that the
	/// component holding this markup writes none of it -- never on the value simply being missing,
	/// which is also what a compiler that has stopped working looks like. See `spec/refusals.md`.
	#[serde(default)]
	pub safe: bool,
	/// The whole of an element's attributes rather than one of them. A spread's keys arrive with
	/// the request, so what is written is one finished run and it is already escaped.
	#[serde(default)]
	pub spread: bool,
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
	/// Numbered by the walk and written by nothing, because it sits in markup a component does not
	/// render. It leaves the order counted against, or every ordinal after it shifts.
	#[serde(default)]
	pub absent: bool,
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
