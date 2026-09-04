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

pub(super) fn sentinel_at(html: &str, from: usize, until: usize) -> Option<(usize, usize, usize)> {
	let start = from + html.get(from..until)?.find("%%s")?;
	let rest = html.get(start + 3..until)?;
	let digits = rest.find("%%")?;
	let index: usize = rest.get(..digits)?.parse().ok()?;
	Some((start, start + 3 + digits + 2, index))
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
