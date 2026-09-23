import { escape } from './escape.ts';
import type { ComponentIR, Node } from './ir.ts';
import { drive, thenable, waited } from './drive.ts';
import { type Csp, HYDRATABLES, type Hydratables, script } from './hydratable.ts';
import { resolve, type Scope, settle } from './resolve.ts';

/** Svelte's `replacements`, which has this one entry. */
const TRANSLATE: ReadonlyMap<unknown, string> = new Map<unknown, string>([
	[true, 'yes'],
	[false, 'no'],
]);

export type { Branch, ComponentIR, EscapeMode, Node, Presence } from './ir.ts';
export { drive, thenable, waited, waiting, WAITS } from './drive.ts';
export { type Csp, HYDRATABLES, type Hydratables, hydratables } from './hydratable.ts';
export { resolve, SCOPED, type Scope, settle } from './resolve.ts';

/**
 * The ids one response counts out, for every `$props.id()` it meets.
 *
 * Svelte's server keeps one counter per render and spells the id `s1`, `s2`, ... in the order the
 * components are instantiated, which is the order their anchors are written; the client reads each
 * back from its anchor. Counting here in output order is the same sequence, so the bytes are the
 * ones Svelte would have written.
 */
interface Fresh {
	next: number;
	/** How many head blocks holding a title have started, which is what a title candidate ranks by. */
	block: number;
	/** The title winning so far under `set_title`'s rule. See the `title` node. */
	title?: { block: number; top: boolean; text: string };
	/** The component's fragments, which a `call` node walks. */
	fragments: Readonly<Record<string, Node[]>>;
}

function* walk(
	nodes: readonly Node[],
	scopes: readonly Scope[],
	fresh: Fresh,
): Generator<unknown, string, unknown> {
	let out = '';
	for (const node of nodes) {
		switch (node.t) {
			case 'static':
				out += node.s;
				break;
			case 'slot':
				if (node.fresh === true) {
					// Bound in the innermost scope, which is the item's inside an each, so every
					// item gets its own and the reads inside the body see it.
					const id = `s${String(fresh.next)}`;
					fresh.next += 1;
					const innermost = scopes[scopes.length - 1];
					if (innermost !== undefined) innermost[node.path] = id;
					out += escape(id, node.escape);
					break;
				}
				out += escape(yield* value(resolve(scopes, node.path), scopes), node.escape);
				break;
			case 'title': {
				// `set_title` keeps the title whose render path compares later, and a head block is
				// hoisted ahead of the fragment it sits in, so a later head block always compares
				// later and, within one block, every title shares the block's path and the first
				// one set is kept -- a top-level title runs at the block's init, before any block
				// inside it. So a later head block wins, and inside a block a top-level title beats
				// a nested one and an earlier one beats a later one of the same kind.
				if (node.role === 'open') {
					fresh.block += 1;
					break;
				}
				const text = yield* walk(node.body, scopes, fresh);
				const top = node.role === 'top';
				const held = fresh.title;
				if (
					held === undefined ||
					fresh.block > held.block ||
					(fresh.block === held.block && top && !held.top)
				) {
					fresh.title = { block: fresh.block, top, text };
				}
				break;
			}
			case 'call': {
				// The fragment's body in a scope of its own, each parameter bound to the value at its
				// path where the call sits, the way an each binds its item per iteration. The depth
				// is the data's: a call inside the body is met again with the next value.
				const body = fresh.fragments[node.fragment];
				if (body === undefined)
					throw new Error(`a call of a fragment the IR does not hold: ${node.fragment}`);
				// A shared node is held once and named from every branch that holds it; it binds
				// nothing and takes no frame, so what it writes into the innermost scope -- an id it
				// counted, for the reads of it further along -- lands where it would have.
				if (node.shared === true) {
					out += yield* walk(body, scopes, fresh);
					break;
				}
				const bound: Scope = {};
				for (const [name, path] of node.binds) {
					bound[name] = yield* value(resolve(scopes, path), scopes);
				}
				out += yield* walk(body, [...scopes, bound], fresh);
				break;
			}
			case 'if':
				for (const branch of node.branches) {
					if (branch.test === null || (yield* value(resolve(scopes, branch.test), scopes))) {
						out += yield* walk(branch.body, scopes, fresh);
						break;
					}
				}
				break;
			case 'attr': {
				// The one expression case keeps the value rather than its text, because both rules
				// below read the value: null and undefined take the attribute with them, and a
				// boolean one asks whether the value is falsy rather than what it prints as.
				const [only] = node.parts;
				const single = node.parts.length === 1 && only?.t === 'slot';
				const held = single
					? yield* value(resolve(scopes, only.path), scopes)
					: yield* walk(node.parts, scopes, fresh);
				if (held === undefined || held === null) break;

				// `hidden` is boolean for every value but this one, which is Svelte's exception and
				// stays here because it is decided by the value rather than by the name.
				const bare =
					node.presence === 'boolean' && !(node.name === 'hidden' && held === 'until-found');
				if (bare) {
					// An empty string is a present boolean attribute, as it is in markup.
					if (!held && held !== '') break;
					out += ` ${node.name}=""`;
					break;
				}
				// The one entry in Svelte's replacement table, `internal/shared/attributes.js`: the
				// value `true` is written `"yes"` and `false` `"no"`, because `translate="false"` would
				// mean yes. The name is the whole of the rule, so it is carried here as the boolean
				// list is, rather than read off a render that cannot show it.
				const shown = node.name === 'translate' && single ? (TRANSLATE.get(held) ?? held) : held;
				const text = single ? escape(shown, 'attr') : String(held);
				// `class` and `style` come out of helpers that write nothing for an empty result,
				// so an element whose computed class is empty carries no class attribute at all.
				if (node.presence === 'nonempty' && text === '') break;
				out += ` ${node.name}="${text}"`;
				break;
			}
			case 'each': {
				// What `ensure_array_like` decides: nothing for a source that is nothing, the
				// source itself where it has a length, and `Array.from` of anything else -- a `Map`,
				// a `Set`, an iterator -- which the payload can carry, since devalue does.
				const source = arrayLike(yield* value(resolve(scopes, node.source), scopes));
				if (source === null) break;
				// The counter is bound beside the item rather than reached through it, which is what
				// Svelte's server does: it is the `for` loop's own variable.
				for (const [at, item] of source.entries()) {
					const bound: Scope = { [node.item]: item };
					if (node.index != null) bound[node.index] = at;
					out += yield* walk(node.body, [...scopes, bound], fresh);
				}
				break;
			}
		}
	}
	return out;
}

/**
 * Svelte's `ensure_array_like`, read out of `internal/server/index.js`: a falsy source is an
 * empty list, one with a `length` is itself, and anything else goes through `Array.from`. Null is
 * returned for nothing to iterate, which is what the caller writes nothing for.
 */
function arrayLike(source: unknown): readonly unknown[] | null {
	if (!source) return null;
	// `.length !== undefined` on the value itself, not on an object -- a **string** has one, and
	// the loop that follows is `array[i]` for `i < array.length`, so a string iterates its
	// characters. Asking `typeof source === 'object'` first missed that and wrote nothing.
	const length = (source as { length?: unknown }).length;
	if (length !== undefined) {
		if (Array.isArray(source)) return source;
		// Read by index rather than through `Array.from`, because the loop is an index loop: a
		// string holding an astral character has a `length` of two and `s[0]` is half of it, where
		// `Array.from` would give one whole character and one fewer iteration.
		const held: unknown[] = [];
		for (let at = 0; at < (length as number); at += 1) {
			held.push((source as Record<number, unknown>)[at]);
		}
		return held;
	}
	if (typeof source === 'object' && Symbol.iterator in source) {
		return Array.from(source as Iterable<unknown>);
	}
	return null;
}

/**
 * The title, which reads as markup and behaves as a channel: a value that is either set or not,
 * appended after the head where Svelte appends its own. One decided by Svelte's render -- written
 * by a component the walk did not enter -- is the winner, as it was over everything the render
 * held; otherwise the one the `title` nodes decided while the head was walked.
 */
function* title(
	nodes: readonly Node[],
	scopes: readonly Scope[],
	fresh: Fresh,
): Generator<unknown, string, unknown> {
	const decided = yield* walk(nodes, scopes, fresh);
	if (decided !== '') return decided;
	return fresh.title === undefined ? '' : `<title>${fresh.title.text}</title>`;
}

/** What Svelte's `render()` returns, produced without any of Svelte running. */
export interface Injected {
	body: string;
	head: string;
	/** What a `hash` policy has to allow, which is the script `hydratable` values went into. */
	hashes?: { script: string[] };
}

/**
 * The bytes for one request, synchronously where nothing waits and as a promise where something
 * does: a derivation that awaits, which only a project in Svelte's async mode has, or the script
 * `hydratable` values go into, which is written once every one of them has settled. `data` may be
 * the promise `derive` returns for one. See `drive`.
 */
export function inject(
	ir: ComponentIR,
	data: Scope | PromiseLike<Scope>,
	options: { csp?: Csp } = {},
): Injected | Promise<Injected> {
	return drive(
		(function* (): Generator<unknown, Injected, unknown> {
			const scope = (thenable(data) ? yield data : data) as Scope;
			const scopes = [scope];
			const fresh: Fresh = { next: 1, block: 0, fragments: ir.fragments ?? {} };
			const body = yield* walk(ir.body, scopes, fresh);
			let head =
				(yield* walk(ir.head, scopes, fresh)) +
				(yield* title(ir.title, scopes, fresh)) +
				(yield* walk(ir.styles ?? [], scopes, fresh));
			// Ahead of the head, as `#render_async` puts it: `content.head = hydratables +
			// content.head`, after every value the page recorded has settled.
			const record = scope[HYDRATABLES] as Hydratables | undefined;
			if (record === undefined || record.size === 0) return { body, head };
			const made = (yield script(record, options.csp)) as Awaited<ReturnType<typeof script>>;
			if (made === null) return { body, head };
			head = made.script + head;
			return made.hash === undefined
				? { body, head }
				: { body, head, hashes: { script: [made.hash] } };
		})(),
	);
}

/** A resolved value, with a scoped derivation called and anything it awaits waited on. */
function* value(held: unknown, scopes: readonly Scope[]): Generator<unknown, unknown, unknown> {
	const settled = settle(held, scopes);
	return waited(settled) ? yield settled : settled;
}
