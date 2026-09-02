// Indexed rather than carrying the expression, so nothing about the expression can collide with
// the marker or need escaping inside it. The delimiters are ordinary characters that survive
// both of Svelte's escape modes untouched: none of & < " appears.
const OPEN = '%%s';
const CLOSE = '%%';

export function sentinel(index: number): string {
	return `${OPEN}${index}${CLOSE}`;
}

export const PATTERN = /%%s(\d+)%%/g;
