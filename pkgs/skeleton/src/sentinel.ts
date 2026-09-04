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
 * What the stamp is written inside, which depends on what the element around it allows.
 *
 * Bare text cannot go everywhere. Svelte refuses `<#text>` inside a table's parts, and a text or
 * element child of a `<select>` or an `<optgroup>` makes it *rich*, which is a real change in the
 * bytes: `is_customizable_select_element` in `phases/nodes.js` decides it, and a rich select
 * closes with `<!>` before its tag. So the marker is carried by something the element already
 * allows and already ignores.
 *
 * Three carriers, each measured against every parent in `sentinel.test.ts` rather than reasoned
 * about from the specification:
 *
 * - `<template>`, which every element that rejects text accepts, and which nothing reads.
 * - `<option>` inside a `<select>` or an `<optgroup>`, where a template would make it rich. Its
 *   value is the marker, so it can never be the one the select has selected.
 * - bare text inside an `<option>`, which holds neither of the other two and is not made rich by
 *   text.
 */
export function carrier(index: number, parent: string | null): string {
	const mark = stamp(index);
	if (parent === 'select' || parent === 'optgroup') return `<option value="${mark}"></option>`;
	if (parent === 'option') return mark;
	return `<template>${mark}</template>`;
}
