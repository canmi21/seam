//! Finding the edges in what Svelte rendered: its anchors, our sentinels, and the tag a dynamic
//! element was rendered under.
//!
//! Nothing here interprets. Each function answers where something starts and where it ends, and
//! every rule it uses -- which comment opens a block, what `element()` writes around a tag, that
//! `<` and `>` are escaped in text and so cannot appear outside markup -- is Svelte's own.

use super::skeleton::Result;

/// An anchor pair and what sits between it. Svelte writes these so its client can find block
/// boundaries in a serialised page; the compiler reads them for the same reason.
pub(super) struct Span {
	/// Where the opening anchor starts.
	pub(super) from: usize,
	/// Just after the opening anchor.
	pub(super) content: usize,
	/// Where the closing anchor starts.
	pub(super) until: usize,
	/// Just after the closing anchor.
	pub(super) to: usize,
}

pub(super) const OPEN: &str = "<!--[";
/// What a head block closes with, and what a fragment writes where it holds nothing.
pub(super) const EMPTY: &str = "<!---->";
pub(super) const CLOSE: &str = "<!--]-->";

/// Finds the block that opens at or after `from`, at this nesting level, skipping any nested
/// pair. Returns nothing when the next thing at this level is the level's own close.
pub(super) fn next_block(html: &str, from: usize, until: usize) -> Option<Span> {
	let mut at = from;
	loop {
		let open = html.get(at..until)?.find(OPEN)? + at;
		let close = html.get(at..until).and_then(|s| s.find(CLOSE)).map(|i| i + at);
		if close.is_some_and(|close| close < open) {
			return None;
		}
		let head_end = html.get(open..until)?.find("-->")? + open + 3;
		// `<!---->` is not a block. It is a component boundary or a leading text marker.
		if head_end - open == "<!---->".len() && &html[open..head_end] == "<!---->" {
			at = head_end;
			continue;
		}
		let content = head_end;
		let mut depth = 1;
		let mut scan = content;
		while depth > 0 {
			let next_open = html.get(scan..until).and_then(|s| s.find(OPEN)).map(|i| i + scan);
			let next_close = html.get(scan..until).and_then(|s| s.find(CLOSE)).map(|i| i + scan);
			let next_close = next_close?;
			match next_open {
				Some(next_open) if next_open < next_close => {
					let end = html.get(next_open..until)?.find("-->")? + next_open + 3;
					if !(end - next_open == "<!---->".len() && &html[next_open..end] == "<!---->") {
						depth += 1;
					}
					scan = end;
				}
				_ => {
					depth -= 1;
					scan = next_close + CLOSE.len();
					if depth == 0 {
						return Some(Span { from: open, content, until: next_close, to: scan });
					}
				}
			}
		}
	}
}

// --- splitting at the sentinels -----------------------------------------------------------

/// What a marker in the render stands for.
///
/// Three families, all written by `pkgs/skeleton/src/sentinel.ts` and all read here by the same
/// scan, so a value in an attribute and a value in content take one path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Mark {
	/// `%%sN%%`: the hole at this index, which is where a value the walk recorded goes.
	Hole(usize),
	/// `%%qN%%`: the anchor of a `$props.id()` in a component the walk did not enter. The runtime
	/// counts the id out and binds it under this name. See `pkgs/skeleton/src/fresh.ts`.
	Id { name: usize, anchor: bool },
}

/// The first marker at or after `from`, whichever family it belongs to.
pub(super) fn sentinel_at(html: &str, from: usize, until: usize) -> Option<(usize, usize, Mark)> {
	let text = html.get(from..until)?;
	let start = from + text.find("%%")?;
	let rest = html.get(start + 3..until)?;
	let digits = rest.find("%%")?;
	let number: usize = rest.get(..digits)?.parse().ok()?;
	let mark = match html.as_bytes().get(start + 2)? {
		b's' => Mark::Hole(number),
		b'q' => Mark::Id { name: number, anchor: true },
		b'p' => Mark::Id { name: number, anchor: false },
		_ => return None,
	};
	Some((start, start + 3 + digits + 2, mark))
}

/// The name the runtime binds an id under, which is the number Svelte gave it in that render.
pub(super) fn id_name(name: usize) -> String {
	format!("__p{name}")
}

/// The block this pass declared, where the render says so just after a block's close.
///
/// Svelte's anchors say a block opened, not which one. A component the walk did not enter writes
/// its own -- an `{#if}` or an `{#each}` in a package's markup opens and closes exactly as ours
/// does -- so matching by the order they appear in counted somebody else's blocks as ours and ran
/// out of block list. This is the stamp `pkgs/skeleton/src/sentinel.ts` writes: present means the
/// block is one of ours and says which, absent means it belongs to a component and is bytes.
///
/// What the stamp is written inside is decided where it is written, against the element the block
/// sits in -- `carrier()` in `pkgs/skeleton/src/sentinel.ts`, which has the measurement. Here they
/// are simply all read.
///
/// Returns the index and where the stamp ends.
pub(super) fn stamped(html: &str, at: usize) -> Option<(usize, usize)> {
	let rest = html.get(at..)?;
	// Three carriers, because what the stamp may be is decided by the element it sits in --
	// `carrier()` in `pkgs/skeleton/src/sentinel.ts` chooses, and this reads whichever came back.
	// A `<template>` carries attributes of its own where the component has a stylesheet that
	// scopes every element in it, which a `@keyframes` rule does, so its tag is read to the `>`
	// rather than matched whole. Anything that opens like a carrier and does not hold a stamp is
	// not one, so there is nothing to fall through to.
	let (body, close, opened) = if let Some(after) = rest.strip_prefix("<template") {
		let end = after.find('>')? + 1;
		(after.get(end..)?, "</template>", "<template".len() + end)
	} else if let Some(after) = rest.strip_prefix("<option value=\"") {
		(after, "\"></option>", "<option value=\"".len())
	} else {
		(rest, "", 0)
	};
	let digits = body.strip_prefix("%%b")?;
	let end = digits.find("%%")?;
	let index = digits.get(..end)?.parse::<usize>().ok()?;
	if !digits.get(end + 2..)?.starts_with(close) {
		return None;
	}
	Some((index, at + opened + 3 + end + 2 + close.len()))
}

/// The stand-in a dynamic element was rendered under, and the parts of what it wrote.
///
/// Svelte's `element()` writes `<!---->`, then the tag with its attributes, then the children, an
/// empty comment and a closing tag unless the tag is void or raw text, then `<!---->`. The render
/// is given a name that is none of those, so what comes back is always the full shape and every
/// piece of it has a known edge.
pub(super) struct Dynamic {
	/// Where the leading empty comment starts.
	pub(super) from: usize,
	/// Just after `<seam-elN`, where the attributes begin.
	pub(super) attributes: usize,
	/// The `>` that closes the opening tag.
	pub(super) opened: usize,
	/// Where the children end, before the empty comment that precedes the closing tag.
	pub(super) content: usize,
	/// Just past the trailing empty comment.
	pub(super) to: usize,
	pub(super) index: usize,
}

/// The `>` that closes a tag, skipping any inside a quoted value. Svelte escapes `&` and `"` in
/// an attribute and leaves `>` alone, so one can sit inside a value.
pub(super) fn closes(html: &str, from: usize, until: usize) -> Option<usize> {
	let mut quoted = false;
	for (offset, c) in html.get(from..until)?.char_indices() {
		match c {
			'"' => quoted = !quoted,
			// The `/` of a void element belongs to what comes after the attributes, not to them.
			'>' if !quoted => {
				let at = from + offset;
				return Some(if html.get(..at)?.ends_with('/') { at - 1 } else { at });
			}
			_ => {}
		}
	}
	None
}

pub(super) const STANDIN: &str = "<seam-el";

pub(super) fn next_dynamic(html: &str, from: usize, until: usize) -> Option<Dynamic> {
	let at = html.get(from..until)?.find(STANDIN)? + from;
	let rest = html.get(at + STANDIN.len()..until)?;
	let digits = rest.find(|c: char| !c.is_ascii_digit())?;
	let index: usize = rest.get(..digits)?.parse().ok()?;
	let attributes = at + STANDIN.len() + digits;

	// The first `>` outside a quoted value. Svelte escapes `&` and `"` in an attribute and leaves
	// `>` alone, so one can sit inside a value and the naive scan would stop on it.
	let mut quoted = false;
	let mut opened = None;
	for (offset, c) in html.get(attributes..until)?.char_indices() {
		match c {
			'"' => quoted = !quoted,
			'>' if !quoted => {
				opened = Some(attributes + offset);
				break;
			}
			_ => {}
		}
	}
	let opened = opened?;

	let closing = format!("</seam-el{index}>");
	let close_at = html.get(opened..until)?.find(&closing)? + opened;
	if !html.get(..at)?.ends_with(EMPTY) || !html.get(..close_at)?.ends_with(EMPTY) {
		return None;
	}
	Some(Dynamic {
		from: at - EMPTY.len(),
		attributes,
		opened,
		content: close_at - EMPTY.len(),
		to: close_at + closing.len() + EMPTY.len(),
		index,
	})
}

/// Where the sentinel landed, which decides how the value is escaped and whether the characters
/// around it belong to an attribute that can disappear.
pub(super) enum Landing {
	Content,
	Attribute { name: String, opens_at: usize },
}

/// Inside a tag means inside an attribute value: scanning back, a `<` reached before a `>` says
/// the sentinel sits between a tag's angle brackets. Svelte escapes both in text, so neither can
/// appear in content that is not markup.
pub(super) fn landing(html: &str, sentinel: usize, from: usize) -> Result<Landing> {
	let before = &html[from..sentinel];
	let open = before.rfind('<');
	let close = before.rfind('>');
	let inside = match (open, close) {
		(Some(open), Some(close)) => open > close,
		(Some(_), None) => true,
		_ => false,
	};
	if !inside {
		return Ok(Landing::Content);
	}

	let quote = before
		.rfind("=\"")
		.ok_or_else(|| "a sentinel inside a tag is not inside an attribute value".to_owned())?;
	let space = before[..quote]
		.rfind(|c: char| c.is_whitespace())
		.ok_or_else(|| "an attribute with no whitespace before its name".to_owned())?;
	// The node owns the space in front of its name, because it owns whether it is written at
	// all: an absent attribute must take its separator with it.
	Ok(Landing::Attribute { name: before[space + 1..quote].to_owned(), opens_at: from + space })
}
