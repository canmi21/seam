/** Inside an element, or inside an attribute's quotes. */
type EscapeMode = 'content' | 'attr';

// Svelte's own sets, and its own loop, from svelte/src/escaping.js. `>` is escaped by neither,
// and `"` only inside an attribute. Copied rather than reasoned about because the output has to
// match Svelte's byte for byte or its client refuses to hydrate against it; the loop because a
// page writes tens of thousands of values, and a `replace` calling back per match cost twice it.
const CONTENT = /[&<]/g;
const ATTR = /[&"<]/g;

export function escape(value: unknown, mode: EscapeMode | false): string {
	const text = value === undefined || value === null ? '' : String(value);
	if (mode === false) return text;
	const pattern = mode === 'attr' ? ATTR : CONTENT;
	pattern.lastIndex = 0;
	let escaped = '';
	let last = 0;
	while (pattern.test(text)) {
		const at = pattern.lastIndex - 1;
		const one = text[at];
		escaped += text.substring(last, at) + (one === '&' ? '&amp;' : one === '"' ? '&quot;' : '&lt;');
		last = at + 1;
	}
	return escaped + text.substring(last);
}
