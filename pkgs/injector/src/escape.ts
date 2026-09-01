import type { EscapeMode } from './ir.ts';

// Svelte's own sets, from svelte/src/escaping.js. `>` is escaped by neither, and `"` only
// inside an attribute. Copied rather than reasoned about because the output has to match
// Svelte's byte for byte or its client refuses to hydrate against it.
const CONTENT = /[&<]/g;
const ATTR = /[&"<]/g;

const REPLACEMENT: Record<string, string> = {
	'&': '&amp;',
	'"': '&quot;',
	'<': '&lt;',
};

export function escape(value: unknown, mode: EscapeMode | false): string {
	const text = value === undefined || value === null ? '' : String(value);
	if (mode === false) return text;
	return text.replace(mode === 'attr' ? ATTR : CONTENT, (c) => REPLACEMENT[c] ?? c);
}
