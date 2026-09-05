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

export function carrier(index: number, parent: string | null, close = ''): string {
	const mark = stamp(index);
	// A text or element child makes a select *rich*, which closes the tag with `<!>` -- a real
	// change in the bytes. An `<option>` is what it already expects, and its value is the marker,
	// so it can never be the one the select has selected.
	// The close of a block standing in the head stream rides inside the carrier, where it is text
	// the carrier already allows: as the option's content, or ahead of the stamp in the template.
	// Written in the open it would be text where text is refused. See `headCloses()`.
	if (parent === 'select' || parent === 'optgroup')
		return `<option value="${mark}">${close}</option>`;
	if (parent !== null && REFUSES_TEXT.has(parent)) return `<template>${close}${mark}</template>`;
	return `${close}${mark}`;
}

/**
 * The calls the walk writes into markup for the render to run against the renderer, which
 * `renderRewritten` gives them: two around a body block that has to stand in the head stream as
 * well, see `mirrored()` in walk.ts, and one that writes a marker into the body from inside a
 * stand-in, see `marks()`.
 */
export const HEAD_OPEN = '__seam_open';
export const HEAD_CLOSE = '__seam_close';
export const MARK = '__seam_mark';
export const MARK_HEAD = '__seam_mark_head';

/**
 * A marker written by a stand-in from its own script or init rather than as text beside it.
 *
 * A call of a fragment stands in the render as an empty snippet rendered or an empty copy called,
 * and the hole's marker has to land where it renders. Text beside it changes the bytes: a marker
 * first in an each body is what `is_text_first` writes `<!---->` ahead of, and a marker beside a
 * component or a render tag alone in its block is what stops `is_standalone`, after which the
 * call writes `<!---->` after itself. Measured both. Pushed by the stand-in itself, the marker
 * lands at the same position and the markup around the call is what it was.
 */
export function marks(index: number): string {
	return `${MARK}(${JSON.stringify(sentinel(index))})`;
}

/**
 * The same marker written into the head stream, for a call of a fragment that writes a head: the
 * body's call is met where the stand-in renders, and the head's where its head blocks would have
 * gone, which is where a head renderer pushed at that moment lands. See `mirrored()` in walk.ts.
 */
export function marksHead(index: number): string {
	return `${MARK_HEAD}(${JSON.stringify(sentinel(index))})`;
}

/**
 * What opens a block in the head: a `{@const}` at the start of a branch. `clean_nodes` hoists a
 * const tag out of its fragment before it reads what the fragment starts with or whether it holds
 * one component alone, and the server transform runs it in the branch's init, so it opens the
 * block in the head before anything in the branch writes there and changes nothing in the body.
 */
export function headOpens(index: number): string {
	return `{@const __seam_o${String(index)} = ${HEAD_OPEN}(${String(index)})}`;
}

/**
 * What opens a block whose branches cannot hold a `{@const}`: the block's own expression, passed
 * through the open and returned by it. `{#await}` is the case -- its pending branch is the one
 * place Svelte does not allow a const tag -- and the expression is evaluated once, before either
 * branch runs, which is exactly when the open has to happen. Both branches are then opened by
 * the one call, so the close never has to write the empty pair for either.
 */
export function headOpensWith(index: number, value: string): string {
	return `${HEAD_OPEN}(${String(index)}, ${value})`;
}

/**
 * What closes it: an expression tag beside the block's stamp, evaluated when the bytes after the
 * block are pushed, which is after everything in the block has run. The call returns the empty
 * string, so it writes nothing to the body, and the stamp's text keeps the whitespace after it
 * what it was: a text node after an expression tag keeps its leading whitespace as written, and
 * the stamp has none.
 */
export function headCloses(index: number): string {
	return `{${HEAD_CLOSE}(${String(index)})}`;
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
