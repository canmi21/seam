//! The rendered head taken apart: the `hydratable` script in front, the blocks, the title, and the
//! injected stylesheets after. See spec/ir.md.

use super::scan::EMPTY;
use super::skeleton::Result;

/// Splits the rendered head into the head blocks and the title, at the title's own element.
///
/// `#close_render` appends `get_title()` after every head block, and `TitleElement.js` writes it
/// as `<title>`, the content escaped, `</title>`, so a head ending in the closing tag holds its
/// title from the last `<title>` on and nothing else there can open one. It used to split at the
/// last empty comment, which is what closes a head block; a block the walk stands in the head
/// stream closes with `<!--]-->` and its stamp instead, and a render made with such an if not
/// taken holds those and no head block at all. What is left is checked to end the way a head
/// block or a stamp does, so a release appending something else is a failure rather than a silent
/// misreading.
pub(super) fn split_off_title(head: &str) -> Result<(&str, &str)> {
	let (_, blocks, title, _) = split_head(head)?;
	Ok((blocks, title))
}

/// The script `hydratable` values are written into, peeled off the front.
///
/// `#render_async` prepends what `#hydratable_block` returns to the head -- `content.head =
/// hydratables + content.head` -- and that is `\n\t\t<script>` (with a `nonce` where the render is
/// given one), the values, and `</script>`. So it is a prefix of constant bytes where the values are
/// the build's, ahead of every head block, the way the stylesheets are a suffix after the title.
/// A value `devalue.uneval` writes escapes `<`, so the first `</script>` is the one that closes it.
pub(super) fn split_off_hydratables(head: &str) -> (&str, &str) {
	const OPENS: &str = "\n\t\t<script";
	const CLOSES: &str = "</script>";
	if !head.starts_with(OPENS) {
		return ("", head);
	}
	match head.find(CLOSES) {
		Some(at) => head.split_at(at + CLOSES.len()),
		None => ("", head),
	}
}

/// The stylesheet `css: 'injected'` puts in the head, peeled off the end.
///
/// `#close_render` builds the head as `content.head + get_title()` and **then** appends
/// `<style id="${hash}">${code}</style>` for every stylesheet in `renderer.global.css`. So the
/// styles are a suffix of constant bytes sitting after the title, which is why they are their own
/// stream rather than part of either: the head blocks come first, the title after them, and these
/// after that.
///
/// Matched on `<style id="svelte-`, which is the id Svelte writes, rather than on `<style` alone:
/// an author may write a `<style>` inside a `<svelte:head>` of their own, and where there is no
/// title the two would otherwise be indistinguishable.
pub(super) fn split_off_styles(head: &str) -> (&str, &str) {
	const OPENS: &str = "<style id=\"svelte-";
	let mut at = head.len();
	loop {
		let rest = &head[..at];
		if !rest.ends_with("</style>") {
			break;
		}
		let Some(open) = rest.rfind(OPENS) else { break };
		at = open;
	}
	head.split_at(at)
}

/// The rendered head as its four parts: the `hydratable` script, the blocks, the title, and the
/// injected stylesheets.
pub(super) fn split_head(head: &str) -> Result<(&str, &str, &str, &str)> {
	let (script, head) = split_off_hydratables(head);
	let (head, styles) = split_off_styles(head);
	if head.is_empty() {
		return Ok((script, "", "", styles));
	}
	let (blocks, title) = if head.ends_with("</title>") {
		let at = head
			.rfind("<title>")
			.ok_or_else(|| "a rendered head closing a title it never opened".to_owned())?;
		head.split_at(at)
	} else {
		(head, "")
	};
	if !(blocks.is_empty() || blocks.ends_with(EMPTY) || blocks.ends_with("%%")) {
		let tail = &blocks[blocks.len().saturating_sub(40)..];
		return Err(format!("the head ends with `{tail}`, which is neither a head block nor a stamp"));
	}
	Ok((script, blocks, title, styles))
}
