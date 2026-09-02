//! Which attributes are present or absent rather than named and valued.
//!
//! This is one of the few rules reproduced here rather than read out of a render, and the reason
//! is that the render cannot show it. Rewriting an expression to a sentinel makes its value a
//! string literal, and Svelte folds a literal attribute straight into the template instead of
//! calling the helper that decides presence:
//!
//! ```text
//! disabled={data.d}      $.attr('disabled', data.d, true)     the helper, with boolean semantics
//! disabled={"%%s0%%"}    <input disabled="%%s0%%"/>           folded, the semantics gone
//! ```
//!
//! So the bytes collected are correct for the rewritten program and wrong for the written one.
//! No rewrite fixes it either: a boolean attribute's output is `name=""` or nothing at all, and a
//! sentinel can only stand where a value is substituted, never where presence is decided.
//!
//! The list is Svelte's, from `src/utils.js`, and is an HTML fact rather than a Svelte one, which
//! is what makes carrying the rule into the runtime defensible. See `spec/ir.md`.

/// Svelte's `DOM_BOOLEAN_ATTRIBUTES`.
const BOOLEAN: &[&str] = &[
	"allowfullscreen",
	"async",
	"autofocus",
	"autoplay",
	"checked",
	"controls",
	"default",
	"disabled",
	"formnovalidate",
	"indeterminate",
	"inert",
	"ismap",
	"loop",
	"multiple",
	"muted",
	"nomodule",
	"novalidate",
	"open",
	"playsinline",
	"readonly",
	"required",
	"reversed",
	"seamless",
	"selected",
	"webkitdirectory",
	"defer",
	"disablepictureinpicture",
	"disableremoteplayback",
];

/// How an attribute's value decides whether the attribute is written.
///
/// Three answers, and the name picks which one. All three are facts about HTML rather than about
/// Svelte, which is what makes carrying them into the runtime affordable.
pub fn presence(name: &str) -> crate::ir::Presence {
	// `hidden` is not on Svelte's boolean list, but its helper promotes it at runtime for every
	// value but `until-found`. So the name marks it a candidate and the runtime keeps the
	// exception, which is decided by the value.
	if name == "hidden" || BOOLEAN.contains(&name) {
		return crate::ir::Presence::Boolean;
	}
	// `class` and `style` go through helpers that return nothing at all for an empty result, so
	// an element whose computed class comes out empty carries no class attribute. Every other
	// name writes `name=""`.
	if name == "class" || name == "style" {
		return crate::ir::Presence::NonEmpty;
	}
	crate::ir::Presence::Value
}
