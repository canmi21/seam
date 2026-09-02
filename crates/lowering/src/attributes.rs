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

/// Whether an attribute of this name is present or absent rather than named and valued.
///
/// `hidden` is in here although Svelte's list does not carry it: its helper promotes `hidden` at
/// runtime for every value but `until-found`, and the runtime keeps that exception, so what is
/// recorded is that the name is a candidate rather than that it is always boolean.
pub fn boolean(name: &str) -> bool {
	name == "hidden" || BOOLEAN.contains(&name)
}
