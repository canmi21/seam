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
	/// The files the expression was written across, innermost first: the component it sits in,
	/// then each caller up to the entry, relative to the root. A name in it resolves in the first
	/// of these that imports it, which is how a prop expression substituted from a call site
	/// keeps the caller's imports. See `spec/derivation.md`.
	#[serde(default)]
	pub files: Vec<String>,
	/// Allowed not to come back. Set by the render pass, and only on positive evidence that the
	/// component holding this markup writes none of it -- never on the value simply being missing,
	/// which is also what a compiler that has stopped working looks like. See `spec/refusals.md`.
	#[serde(default)]
	pub safe: bool,
	/// The whole of an element's attributes rather than one of them. A spread's keys arrive with
	/// the request, so what is written is one finished run and it is already escaped.
	#[serde(default)]
	pub spread: bool,
	/// The whole of one attribute rather than its value: the space, the name and the value, or
	/// nothing. A class written as an expression beside a `class:` directive is `attr_class(value,
	/// hash, directives)`, one call whose result is that attribute or the empty string, and it is
	/// carried the way `attributes` is. See `spec/refusals.md`.
	#[serde(default)]
	pub whole: bool,
	/// A call of a fragment: the runtime binds the fragment's parameters and walks it again. See
	/// `Block::fragment` and `spec/ir.md`.
	#[serde(default)]
	pub call: Option<Call>,
	/// The anchor of a `$props.id()`, whose value the runtime counts out. `expression` is then
	/// the name the id is bound under. See `pkgs/skeleton/src/fresh.ts`.
	#[serde(default)]
	pub fresh: bool,
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
	/// An if that Svelte writes without anchors: a content binding's `if (body) { value } else {
	/// children }`, read out of `RegularElement.js`. The walk gives it a block so that the else is
	/// rendered and found the way every other else is, and the anchors that render carries are
	/// left out of the bytes, because the client was compiled against markup that has none.
	#[serde(default)]
	pub bare: bool,
	/// A bare block around the body of a recursive snippet or component, kept as a fragment the
	/// runtime calls rather than written in place: its parameters are locals inside it, as an
	/// each's item is, and `binds` are what the first call binds them to. See `spec/ir.md`.
	#[serde(default)]
	pub fragment: Option<Fragment>,
	/// True where an each has an `{:else}`, which is a second shape rendered from an empty list
	/// and keyed `-1` among the alternates the way an if's else is. Unused for an if, whose else
	/// is already among its branches.
	#[serde(default)]
	pub alternate: bool,
	/// The files its expression and tests were written across, as a hole's. See `Hole::files`.
	#[serde(default)]
	pub files: Vec<String>,
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
	/// The names the entry's `$props()` destructures, which are the payload's keys, or `None`
	/// where the walk could not read them. A path is only a path when it is rooted at one of
	/// these, at a name a block binds, or at an id the runtime makes; anything else -- a constant
	/// a file imported, `undefined`, `true` -- is an expression to evaluate.
	#[serde(default)]
	pub payload: Option<Vec<String>>,
}

pub type Result<T> = std::result::Result<T, String>;

/// A fragment the runtime calls: a recursive snippet's or component's body, named, with what each
/// of its parameters is bound to at the call.
#[derive(Debug, Clone, Deserialize)]
pub struct Fragment {
	pub name: String,
	pub params: Vec<String>,
	pub binds: Vec<(String, String)>,
	/// Whether the body opens with text, which Svelte writes an empty comment ahead of in a
	/// snippet's or component's fragment and not in an if's. See `spec/ir.md`.
	#[serde(default, rename = "textFirst")]
	pub text_first: bool,
}

/// One call of a fragment, at a hole.
#[derive(Debug, Clone, Deserialize)]
pub struct Call {
	pub fragment: String,
	pub binds: Vec<(String, String)>,
}
