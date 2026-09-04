// Indexed rather than carrying the expression, so nothing about the expression can collide with
// the marker or need escaping inside it. The delimiters are ordinary characters that survive
// both of Svelte's escape modes untouched: none of & < " appears.
const OPEN = '%%s';
const CLOSE = '%%';

export function sentinel(index: number): string {
	return `${OPEN}${index}${CLOSE}`;
}

export const PATTERN = /%%s(\d+)%%/g;

/**
 * What the render writes just after a block this pass declared, so the assembler knows which.
 *
 * A component the walk does not enter writes its own anchors -- an `{#if}` or an `{#each}` in a
 * package's markup opens and closes the same way ours does -- and the assembler, matching by
 * order, counted every one of them as one of ours. There is nothing in the bytes that tells them
 * apart, so this puts something there.
 *
 * **After the block rather than before it.** Svelte writes a leading `<!---->` when a component's,
 * a snippet's or an each block's fragment begins with text, so a marker at the head of one adds a
 * comment to the output; `is_text_first` in `phases/3-transform/utils.js` is that rule, and it
 * looks at the first node only. Measured both ways: leading changes the bytes, trailing does not.
 *
 * What carries it is `carrier()`, because bare text is not writable everywhere.
 */
export function stamp(index: number): string {
	return `%%b${String(index)}%%`;
}

/**
 * The elements whose content model refuses text, which is the only reason a stamp is ever an
 * element. Measured against Svelte's own placement check rather than taken from the HTML spec.
 *
 * `elementCarrier` is the same question asked before the stamp is written, because a block here
 * carries one in a component whose stylesheet relates siblings, and that combination is refused.
 */
const REFUSES_TEXT = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup']);

/**
 * What the stamp is written inside, which depends on what the element around it allows.
 *
 * **The carrier has to be invisible to Svelte, not merely ignored by a browser**, and those are
 * different things. An element carrier is a sibling, and Svelte's CSS analysis walks siblings:
 * `get_possible_element_siblings` stops at the first `RegularElement` it meets, so a `<template>`
 * standing between two of the author's elements makes `.a + .b` no longer match and **both of them
 * lose their scoping class**. That is the stamp changing the bytes it exists to be absent from.
 * Text is not an element and the walk steps over it, which is what makes it the default here.
 *
 * Measured, every carrier in every parent, against the same markup carrying none:
 *
 * | parent | text | `<template>` | `<option>` |
 * | --- | --- | --- | --- |
 * | anything ordinary, the root, `<pre>`, `<option>` | same | **differs** under `+` or `~` | refused |
 * | `<table>` and its parts | refused | same | refused |
 * | `<select>`, `<optgroup>` | makes it rich | makes it rich | same |
 *
 * So text wherever text is allowed, and an element only where it is the one thing that works. A
 * `<template>` in a table part keeps the sibling problem, which no carrier there avoids: text and
 * an `<option>` are both refused outright. A `+` between two cells with a block between them is
 * the shape that would meet it, and it is recorded rather than solved.
 *
 * The stamp never reaches a reader either way -- the assembler reads it and steps over it, so it
 * is in the compile-time render and in no artifact. What matters is only that its presence changes
 * nothing else in that render. See spec/refusals.md.
 */
export function elementCarrier(parent: string | null): boolean {
	return parent !== null && REFUSES_TEXT.has(parent);
}

export function carrier(index: number, parent: string | null): string {
	const mark = stamp(index);
	// A text or element child makes a select *rich*, which closes the tag with `<!>` -- a real
	// change in the bytes. An `<option>` is what it already expects, and its value is the marker,
	// so it can never be the one the select has selected.
	if (parent === 'select' || parent === 'optgroup') return `<option value="${mark}"></option>`;
	if (parent !== null && REFUSES_TEXT.has(parent)) return `<template>${mark}</template>`;
	return mark;
}

/**
 * The `idPrefix` every compile-time render is given, so that the id Svelte's `props_id` writes
 * into its anchor is a token nothing else can produce.
 *
 * Svelte spells the id `${prefix}-s${n}`, `n` counting up from one per render in the order the
 * components declaring an id are instantiated. The prefix makes the anchors findable after the
 * render, and `n` says which instance each one is; both are read back by `fresh.ts`. A prefix may
 * not contain `--`, since it sits inside a comment.
 */
export const ID_PREFIX = '%%id';

/** The id Svelte writes for the `n`th instance of a render made with `ID_PREFIX`. */
export function freshId(n: number): string {
	return `${ID_PREFIX}-s${String(n)}`;
}
