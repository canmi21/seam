/**
 * The expressions a skeleton carries and the helpers a render is given under names nothing can
 * shadow. See spec/derivation.md, "The helpers are carried under a name nothing can shadow".
 */
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Carried } from '@seam-js/ast';
import type { Skeleton } from './shape.ts';

/**
 * Every expression the compiled component will evaluate, with the files it was written across:
 * each hole's, each decision's tests, and each block's source and tests. What they read, in
 * which file, is what has to be carried. See `carriedBy()`.
 */
export function expressionsOf(rendered: Skeleton): { expression: string; files: string[] }[] {
	const found: { expression: string; files: string[] }[] = [];
	for (const hole of rendered.holes) {
		const files = hole.files ?? [];
		found.push({ expression: hole.expression, files });
		for (const test of hole.choice?.tests ?? []) found.push({ expression: test, files });
		for (const [, expression] of hole.call?.binds ?? []) found.push({ expression, files });
	}
	for (const block of rendered.blocks) {
		const files = block.files ?? [];
		for (const expression of [block.expression, ...(block.tests ?? [])]) {
			found.push({ expression, files });
		}
		for (const [, expression] of block.fragment?.binds ?? []) found.push({ expression, files });
	}
	// A held value is a derivation like any other and is written where the declaration was, so what
	// it calls is what that file imports. It is not a hole -- the hole names a reference to it -- so
	// gathering holes alone left the bundle without it: `const attrs = writable(...)` handed to a
	// child came out as a derivation calling a name the bundle had not got. See `Skeleton.held`.
	//
	// **Only the ones something reaches**, to a fixed point, since a held value may name another.
	// The list is appended to while the walk expands, and a branch the walk then folds away leaves
	// its entries behind: an `{#await}`'s `then` pattern is walked and the block is dropped, and the
	// pattern's initialiser stayed in the list with nothing naming it.
	const reached = new Set<number>();
	for (let changed = true; changed;) {
		changed = false;
		const text = [
			...found.map((one) => one.expression),
			...[...reached].map((at) => rendered.held[at]?.expression ?? ''),
		].join('\n');
		for (const [at] of rendered.held.entries()) {
			if (reached.has(at) || !text.includes(`$$hold(${String(at)})`)) continue;
			reached.add(at);
			changed = true;
		}
	}
	for (const at of [...reached].toSorted((a, b) => a - b)) {
		const one = rendered.held[at];
		if (one !== undefined) found.push({ expression: one.expression, files: one.files });
	}
	// A default on one of the entry's props is a derivation like any other and may call anything
	// the entry's file has in scope -- `export let foo = get()`, a store read. It is not a hole, so
	// it would be gathered from nowhere, and the bundle would come out without what it calls: the
	// artifact compiled and the derivation threw at request time. See `Skeleton.defaults`.
	for (const one of [...rendered.defaults, ...rendered.eager]) {
		found.push({ expression: one.expression, files: one.files });
	}
	return found;
}

/**
 * Svelte's own functions a component's expressions call, which the author did not import.
 *
 * `attributes` writes the whole of an element's attributes from an object, which is what a `{...}`
 * needs and what cannot be enumerated at compile time; `attr_class` writes the whole of a class
 * attribute beside a `class:` directive; `clsx` is what the analysis wraps a class value in when it
 * may be an array or an object. Each goes in the carried bundle beside the author's own imports, so
 * both backends run **Svelte's implementation** rather than agreeing about a rule: nothing here
 * reproduces the merging, the escaping, the boolean names, the `defaultValue` mapping on an input
 * or the case rules for a namespaced element. `attributes` measured at 17 kB bundled, with its only
 * host references optionally chained off `globalThis`, so an evaluator with no host reads them as
 * undefined rather than failing. See spec/refusals.md.
 *
 * Here rather than in the compiler so that the check gathers with the function the build gathers
 * with, over the same holes.
 */
/**
 * The source with each span replaced, keeping every offset outside it where it was.
 *
 * A `0` and then spaces rather than spaces alone: a span may be a test as well as a fragment, and
 * `{:else if      }` does not parse where `{:else if 0     }` does. In markup the `0` is a text
 * node reading no names, which is what this is asked about.
 */
export function blanked(source: string, spans: readonly [number, number][]): string {
	if (spans.length === 0) return source;
	let held = source;
	for (const [from, to] of spans) {
		if (to <= from) continue;
		held = held.slice(0, from) + `0${' '.repeat(to - from - 1)}` + held.slice(to);
	}
	return held;
}

export function helpers(rendered: Skeleton): Carried[] {
	const found: Carried[] = [];
	const from = 'svelte/internal/server';
	// Under a `$$` name, which nothing the author writes can shadow: Svelte reserves the prefix, so
	// `$$props`, `$$slots` and these are the only names that carry it. Svelte's own output calls
	// them through `$.`, and ours had them bare -- so a component with `export let attributes`, which
	// is an ordinary thing to call a prop, put an object where the helper's name was and the
	// derivation called it. Measured on `class-with-spread`.
	if (rendered.holes.some((one) => one.spread === true)) {
		found.push({ local: '$$attributes', from, kind: 'named', exported: 'attributes' });
	}
	if (rendered.holes.some((one) => one.whole === true)) {
		found.push({ local: '$$attr_class', from, kind: 'named', exported: 'attr_class' });
	}
	// Over every expression rather than the holes alone: a name a pattern binds is reached inside a
	// block's own expression and inside a fragment call's bindings as readily as inside a hole.
	const written = expressionsOf(rendered).map((one) => one.expression);
	// `attr_style` is the same answer for a `style` attribute beside a `style:` directive: one call
	// whose result is the whole attribute. Keyed off the expression rather than off `whole`, which
	// the class hole also sets. Measured at 1855 bytes bundled, its only host references optionally
	// chained off `globalThis`, which is the same terms `attributes` is carried on.
	if (written.some((one) => one.includes('$$attr_style('))) {
		found.push({ local: '$$attr_style', from, kind: 'named', exported: 'attr_style' });
	}
	if (written.some((one) => one.includes('$$clsx('))) {
		found.push({ local: '$$clsx', from, kind: 'named', exported: 'clsx' });
	}
	// What `build_attribute_value` puts around every expression in a template: `stringify` is
	// Svelte's, not a rule reproduced here, so nullish comes out empty rather than as "undefined".
	if (written.some((one) => one.includes('$$stringify('))) {
		found.push({ local: '$$stringify', from, kind: 'named', exported: 'stringify' });
	}
	// The two ways in a destructuring has that are not a member: what a rest gathers out of an
	// object, and the array a rest slices. Svelte's own, so the symbol keys and the iterable
	// handling are upstream's. See `takenApart()` in `selection.ts`.
	if (written.some((one) => one.includes('$$exclude_from_object('))) {
		found.push({
			local: '$$exclude_from_object',
			from,
			kind: 'named',
			exported: 'exclude_from_object',
		});
	}
	if (written.some((one) => one.includes('$$to_array('))) {
		found.push({ local: '$$to_array', from, kind: 'named', exported: 'to_array' });
	}
	// `$foo` is a subscription to the store `foo`. `get` subscribes, takes the value and
	// unsubscribes, which is the one-shot read a derivation needs: Svelte's own `store_get` holds
	// the subscription until the render tears down, and there is no teardown here.
	if (written.some((one) => one.includes('$$get_store('))) {
		found.push({ local: '$$get_store', from: 'svelte/store', kind: 'named', exported: 'get' });
	}
	// What `transform-server.js` builds `$$restProps` and `$$slots` from, over the payload itself.
	for (const name of ['rest_props', 'sanitize_props', 'sanitize_slots']) {
		if (written.some((one) => one.includes(`$$${name}(`))) {
			found.push({ local: `$$${name}`, from, kind: 'named', exported: name });
		}
	}
	// A boundary's children run in one catch, and each of their values is guarded against the throw.
	// This compiler's own, since Svelte's renderer keeps the equivalent private. See `caught.ts`.
	const caughtAt = fileURLToPath(new URL(`./caught${extname(import.meta.url)}`, import.meta.url));
	if (written.some((one) => one.includes('$$caught('))) {
		found.push({ local: '$$caught', from: caughtAt, kind: 'named', exported: 'caught' });
	}
	if (written.some((one) => one.includes('$$tried('))) {
		found.push({ local: '$$tried', from: caughtAt, kind: 'named', exported: 'tried' });
	}
	if (written.some((one) => one.includes('$$kept('))) {
		found.push({ local: '$$kept', from: caughtAt, kind: 'named', exported: 'kept' });
	}
	if (written.some((one) => one.includes('$$unnamed('))) {
		found.push({ local: '$$unnamed', from: caughtAt, kind: 'named', exported: 'unnamed' });
	}
	return found;
}
