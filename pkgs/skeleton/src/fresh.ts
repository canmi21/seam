import { ID_PREFIX, sentinel } from './sentinel.ts';
import type { Hole, Rendered } from './shape.ts';

/**
 * The ids Svelte wrote for components the walk did not enter, turned into holes.
 *
 * A component declaring `$props.id()` has Svelte write `<!--$id-->` at the start of its output, the
 * id coming from a counter the renderer keeps, and the client reads it back from that anchor when
 * it hydrates. The value therefore has to be made when the bytes are written -- an each body
 * repeats per item and two branches rendered separately would collide -- so the runtime counts
 * instead, and every place the id was written becomes a hole. See spec/refusals.md.
 *
 * A component the walk entered has its anchor planted by `render.ts`, which puts the marker of the
 * hole the walk allocated where Svelte's helper would have put the id. This is for the rest: a
 * package's component declares an id as well -- a menu trigger names the menu it opens by it --
 * and its output is Svelte's. The render is given a prefix, so every such id is a token nothing
 * else produces, numbered by Svelte in the order it made them. The first place a token appears is
 * the anchor and becomes the hole that binds the id; every other place it appears is a read of it.
 *
 * The name is the number Svelte gave it, which is one per render rather than per component. That
 * is enough: a component's reads follow its own anchor and end before a sibling's begins, and one
 * nested inside it is instantiated after it in every render that holds both, so a rebind never
 * reaches a read that meant the outer one.
 */
export function anchored(rendered: Rendered, holes: Hole[]): Rendered {
	const token = new RegExp(`${ID_PREFIX}-s(\\d+)`, 'g');
	const named = new Map<string, string>();
	const replace = (text: string): string =>
		text.replace(token, (_whole, n: string) => {
			const name = `__p${n}`;
			const index = holes.length;
			if (named.has(name)) {
				holes.push({ index, expression: name, raw: false });
			} else {
				named.set(name, name);
				holes.push({ index, expression: name, raw: false, fresh: true });
			}
			return sentinel(index);
		});
	// Body before head, which is the order Svelte's renderer numbers in: a component starts in the
	// stream its tag sits in, and a `<svelte:head>` inside it is written after its anchor.
	const body = replace(rendered.body);
	const head = replace(rendered.head);
	return { body, head };
}
