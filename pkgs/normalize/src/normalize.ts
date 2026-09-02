/**
 * What `{@html}` writes, put through the parser before anybody sees it.
 *
 * A raw value is written into the response without escaping, which is what it is for. Written as
 * it arrived, it does not stay where it was put: an unclosed tag swallows the anchor that closes
 * the block and the elements after it, and a stray closing tag ends the container early and takes
 * the rest of the page with it. Both were measured, and both break hydration, because Svelte's
 * client finds the end of a raw block by walking siblings and there is no longer a sibling to
 * find.
 *
 * Parsing and serialising fixes it, and fixes nothing else. It is not sanitisation: a `<script>`
 * goes through. What it buys is that **the fragment cannot change the structure around it**,
 * because a parser closes what it opens.
 *
 * It is applied to the payload rather than to the bytes, which is the only place it works. The
 * server writes the bytes and serialises the payload, and the client re-renders a raw block from
 * the payload when the value changes; transforming one and not the other is how the first frame
 * comes to disagree with every frame after it. Transforming the payload transforms both.
 *
 * See spec/refusals.md.
 */
import { parseFragment, serialize } from 'parse5';
import { type ComponentIR, type Node, resolve, type Scope } from 'injector';

/** A parse5 node, of which only the shape walked here matters. */
interface Parsed {
	nodeName: string;
	childNodes?: Parsed[];
}

/**
 * Drops comments, which is the whole of what this removes.
 *
 * It is safe to prove rather than to argue: a comment is not an element, so it renders nothing
 * and no selector can reach it. Every other saving anybody would want -- the whitespace between
 * elements -- turns out to depend on CSS the markup cannot see. The same two `<span>`s with the
 * same whitespace between them render `x y` under `display: inline` and `x` above `y` under
 * `display: block`, so no rule over tag names can decide it.
 *
 * The newline after `<pre>` needs no code: the parser drops it, as the specification says to.
 */
function comments(node: Parsed): Parsed {
	if (node.childNodes === undefined) return node;
	node.childNodes = node.childNodes.filter((child) => child.nodeName !== '#comment');
	for (const child of node.childNodes) comments(child);
	return node;
}

/** One fragment of HTML, as the browser would have understood it. */
export function normalize(html: string): string {
	return serialize(comments(parseFragment(html) as Parsed) as never);
}

/**
 * Every path an `{@html}` writes, which is where the IR already says so.
 *
 * A raw slot on a derivation is not among them, and that is the same rule rather than a gap in
 * it: a derived value is computed per request and never serialised, so the client recomputes it
 * from the data and would disagree with anything done to it here.
 */
export function rawPaths(ir: ComponentIR): string[] {
	const found = new Set<string>();
	const walk = (nodes: readonly Node[]): void => {
		for (const node of nodes) {
			if (node.t === 'slot' && node.escape === false) found.add(node.path);
			else if (node.t === 'if') for (const branch of node.branches) walk(branch.body);
			else if (node.t === 'each') walk(node.body);
			else if (node.t === 'attr') walk(node.parts);
		}
	};
	walk(ir.body);
	walk(ir.head);
	walk(ir.title);
	return [...found].filter((path) => !path.startsWith('__d'));
}

/**
 * The data with every raw field replaced by what a parser makes of it.
 *
 * A copy rather than a rewrite: the payload is frozen before the stage that reads it, and a stage
 * that modifies its input is the thing this protocol says a derivation may not be.
 */
export function normalized(data: Scope, paths: readonly string[]): Scope {
	if (paths.length === 0) return data;
	const out: Scope = structuredClone(data);
	for (const path of paths) {
		const value = resolve([out], path);
		if (typeof value !== 'string') continue;
		place(out, path, normalize(value));
	}
	return out;
}

function place(root: Scope, path: string, value: string): void {
	const steps = path.split('.');
	const last = steps.pop();
	if (last === undefined) return;
	let at: unknown = root;
	for (const step of steps) {
		if (typeof at !== 'object' || at === null) return;
		at = (at as Record<string, unknown>)[step];
	}
	if (typeof at === 'object' && at !== null) (at as Record<string, unknown>)[last] = value;
}
