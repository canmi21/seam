//! The escape table, which is JSON's plus three of devalue's own.
//!
//! `<` becomes `<` so that a payload holding `</script>` cannot close the element it is
//! embedded in. ` ` and ` ` are escaped because they are line terminators to a
//! JavaScript parser and not to a JSON one, so a string containing them is valid JSON that is not
//! valid JavaScript. Neither is optional: they are why the serialized form is safe to put in a
//! document, which is the whole reason it exists.

/// Quotes and escapes a string the way devalue does.
pub(crate) fn string(text: &str) -> String {
	let mut out = String::with_capacity(text.len() + 2);
	out.push('"');
	for c in text.chars() {
		match c {
			'"' => out.push_str("\\\""),
			'<' => out.push_str("\\u003C"),
			'\\' => out.push_str("\\\\"),
			'\n' => out.push_str("\\n"),
			'\r' => out.push_str("\\r"),
			'\t' => out.push_str("\\t"),
			'\u{8}' => out.push_str("\\b"),
			'\u{c}' => out.push_str("\\f"),
			'\u{2028}' => out.push_str("\\u2028"),
			'\u{2029}' => out.push_str("\\u2029"),
			c if c < ' ' => out.push_str(&format!("\\u{:04x}", c as u32)),
			c => out.push(c),
		}
	}
	out.push('"');
	out
}
