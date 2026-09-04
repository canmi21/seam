import { ID_PREFIX } from './sentinel.ts';
import type { Rendered } from './shape.ts';

/**
 * The ids Svelte wrote for components the walk did not enter, written as markers.
 *
 * A component declaring `$props.id()` has Svelte write `<!--$id-->` at the start of its output and
 * the client reads the id back off that anchor while hydrating, so the value is made when the
 * bytes are written. A component the walk entered has its anchor planted by `render.ts`, against a
 * hole the walk allocated. This is the rest: a package declares an id too -- a menu trigger names
 * the menu it opens by one -- and its output is Svelte's, so the ids can only be read back out.
 *
 * **They are markers rather than holes, and that is the whole point.** Svelte numbers ids per
 * render, in instantiation order, so the same component is `s5` in one render and `s6` in another
 * that took a different branch. A hole is a position in one global list shared by every render, and
 * numbering that shifts cannot be held in one: allocating per render left holes no region ever read
 * -- which is what `__p1 is written but never comes back` was -- and sharing them across renders
 * would give one hole to two different components. A marker carries the number instead, so each
 * render says what it means and lowering reads it where it stands, in content or in an attribute,
 * through the same scan that reads every other marker.
 *
 * The name is the number Svelte gave, which is one per render rather than one per component, and
 * that is enough: a component's reads follow its own anchor and end before a sibling's begins, and
 * one nested inside it is instantiated after it in every render that holds both, so a rebinding
 * never reaches a read that meant the outer one. See spec/refusals.md.
 */
export function anchored(rendered: Rendered): Rendered {
	// The anchor first, because its own text is a read of the same token. What replaces it is only
	// the id inside the comment: `<!--$` and `-->` are Svelte's bytes and stay static.
	const anchor = new RegExp(`<!--\\$${ID_PREFIX}-s(\\d+)-->`, 'g');
	const read = new RegExp(`${ID_PREFIX}-s(\\d+)`, 'g');
	const replace = (text: string): string =>
		text.replaceAll(anchor, '<!--$$%%q$1%%-->').replaceAll(read, '%%p$1%%');
	return { body: replace(rendered.body), head: replace(rendered.head) };
}
