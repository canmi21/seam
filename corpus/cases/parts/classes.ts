// A class helper of the shape published Svelte libraries actually ship: variadic, and recursive
// over nested lists. The recursion is deliberate. A purity analysis of carried code would have
// rejected this, and bundling does not look. See spec/derivation.md.
function flatten(value: unknown): string {
	if (Array.isArray(value)) return value.map(flatten).filter(Boolean).join(' ');
	return typeof value === 'string' && value !== '' ? value : '';
}

export function cn(...parts: unknown[]): string {
	return flatten(parts);
}
