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
import { type ComponentIR, type Node, type Scope } from 'injector';

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
 * One `{@html}` in the IR, together with the each blocks it sits inside.
 *
 * A path only means anything in the scope it was written in, and there are two kinds. `data.h`
 * addresses the payload; `r.html` addresses the binding an each block makes. Returned as one type
 * they were indistinguishable, and the only way a consumer found out was that the second kind
 * failed to resolve -- which reads exactly like a value the payload does not carry. So every raw
 * value inside an each was silently never normalised. The frames put the difference in the type.
 */
export interface RawPath {
	/** The each blocks enclosing the slot, outermost first. */
	frames: readonly Frame[];
	/** The path, read in the scope the innermost frame binds. */
	path: string;
}

interface Frame {
	/** Where the items come from, read in the scope of the frame before it. */
	source: string;
	/** The name each item is bound to. */
	item: string;
}

/**
 * Every `{@html}` the IR writes, which is where the IR already says so.
 *
 * A raw slot on a derivation is not among them, and neither is one whose each block iterates a
 * derivation. That is the same rule rather than two: a derived value is computed per request and
 * never serialised, so the client recomputes it from the data and would disagree with anything
 * done to it here.
 */
export function rawPaths(ir: ComponentIR): RawPath[] {
	const found: RawPath[] = [];
	const seen = new Set<string>();

	const add = (one: RawPath): void => {
		if (one.path.startsWith('__d') || one.frames.some((frame) => frame.source.startsWith('__d'))) {
			return;
		}
		const key = JSON.stringify(one);
		if (seen.has(key)) return;
		seen.add(key);
		found.push(one);
	};

	const walk = (nodes: readonly Node[], frames: readonly Frame[]): void => {
		for (const node of nodes) {
			if (node.t === 'slot' && node.escape === false) add({ frames, path: node.path });
			else if (node.t === 'if') for (const branch of node.branches) walk(branch.body, frames);
			else if (node.t === 'each') {
				walk(node.body, [...frames, { source: node.source, item: node.item }]);
			} else if (node.t === 'attr') walk(node.parts, frames);
		}
	};

	walk(ir.body, []);
	walk(ir.head, []);
	walk(ir.title, []);
	return found;
}

/** An object a value can be written back into. An array qualifies: its indices are string keys. */
type Holder = Record<string, unknown>;

/** Where one value sits, which is what a rewrite needs and what reading it cannot give back. */
interface Binding {
	holder: Holder;
	key: string;
}

/**
 * The data with every raw field replaced by what a parser makes of it.
 *
 * A copy rather than a rewrite: the payload is frozen before the stage that reads it, and a stage
 * that modifies its input is the thing this protocol says a derivation may not be.
 */
export function normalized(data: Scope, paths: readonly RawPath[]): Scope {
	if (paths.length === 0) return data;
	const out: Scope = structuredClone(data);
	// One entry per top-level name, all of them held by `out` itself, so a rewrite at the root is
	// the same operation as a rewrite inside an each item.
	const root = new Map<string, Binding>(Object.keys(out).map((key) => [key, { holder: out, key }]));
	for (const one of paths) apply([root], one.frames, 0, one.path);
	return out;
}

function apply(
	scopes: Map<string, Binding>[],
	frames: readonly Frame[],
	at: number,
	path: string,
): void {
	const frame = frames[at];

	if (frame === undefined) {
		const target = find(scopes, path);
		if (target === undefined) return;
		const value = target.holder[target.key];
		if (typeof value !== 'string') return;
		target.holder[target.key] = normalize(value);
		return;
	}

	const source = find(scopes, frame.source);
	if (source === undefined) return;
	const items = source.holder[source.key];
	if (!Array.isArray(items)) return;

	// The item is bound to its slot in the array rather than to its value, so `{@html r}` -- where
	// the item is itself the string -- rewrites the array and not a scope object nobody keeps.
	const holder = items as unknown as Holder;
	for (let index = 0; index < items.length; index += 1) {
		scopes.push(new Map([[frame.item, { holder, key: String(index) }]]));
		apply(scopes, frames, at + 1, path);
		scopes.pop();
	}
}

/**
 * The binding a path names, or nothing when the payload does not carry it.
 *
 * It throws when the path's first name is bound by no scope at all, because that is not a missing
 * value. It is the IR and this walk disagreeing about which scope the slot is in, which is a fault
 * in the compiler, and letting it share an exit with a payload that happens to lack a key is what
 * hid every raw value inside an each from this stage. See spec/refusals.md.
 */
function find(scopes: readonly Map<string, Binding>[], path: string): Binding | undefined {
	const [head, ...rest] = path.split('.');
	if (head === undefined) return undefined;

	let binding: Binding | undefined;
	for (let i = scopes.length - 1; i >= 0; i -= 1) {
		const found = scopes[i]?.get(head);
		if (found !== undefined) {
			binding = found;
			break;
		}
	}
	if (binding === undefined) {
		throw new Error(`the raw path \`${path}\` reads \`${head}\`, which no scope binds`);
	}

	// Own properties at every step. The path comes from the compiler and addresses the author's own
	// data, so a step that is merely inherited is not data being addressed; it is a way into
	// `Object.prototype`, and refusing it costs less than arguing that nothing can reach it.
	for (const step of rest) {
		const value = binding.holder[binding.key];
		if (typeof value !== 'object' || value === null) return undefined;
		const holder = value as Holder;
		if (!Object.hasOwn(holder, step)) return undefined;
		binding = { holder, key: step };
	}
	return binding;
}
