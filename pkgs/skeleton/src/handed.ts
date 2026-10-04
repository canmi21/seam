/**
 * What a call site hands a child, and how a pattern takes it apart: the props filled, the ones
 * neutralised for the render, and the closing of an attribute's value. See spec/derivation.md.
 */
import type { Locals } from '@seam-js/ast';
import { identity } from './compose.ts';
import { type AstNode, extent, isNode, refuse, span } from './node.ts';
import { assigned } from './dynamic.ts';
import type { Given, Group, Walk } from './walk-types.ts';
import { asWritten, slotOf } from './written.ts';

/**
 * Markup that reaches the server and writes nothing, so the walk steps over it.
 *
 * Each of these is measured rather than assumed: `corpus/cases/inert.svelte` holds them all
 * and its expected bytes are Svelte's own.
 */
export const INERT = new Set([
	'Comment',
	'SvelteWindow',
	'SvelteBody',
	'SvelteDocument',
	'SvelteOptions',
	'OnDirective',
	'UseDirective',
	'TransitionDirective',
	'AnimateDirective',
	// No server visitor emits one: `shared/component.js` puts it into a component's props, where
	// nothing on the server calls it, and an element's is not visited at all.
	'AttachTag',
	'DebugTag',
	// Read where the caller's markup is grouped, not where it is written: a `let:` names what the
	// component supplies to the slot it belongs to, and `hands()` collects it. `build_inline_component`
	// puts it in the slot function's parameter and writes nothing for it here. See `Given.handed`.
	'LetDirective',
]);

/**
 * Markup this pass has not been taught, and what to tell the author about it.
 *
 * Every message names one of the three situations `spec/refusals.md` sets out: the shape is
 * understood and unwritten, the protocol has no answer yet, or there is another way to write it.
 * A refusal that says only that something is wrong has failed.
 */
export const REFUSED: Record<string, string> = {
	BindDirective:
		'this `bind:` is one the server writes, and the value has nowhere to be planted: `bind:` ' +
		'takes a name rather than an expression, so a marker cannot stand where the value goes. The ' +
		'bindings that write nothing are handled',
};

/**
 * Whether a group holds anything Svelte writes a slot function for.
 *
 * `build_inline_component` visits the group and drops it where the block comes out empty --
 * `if (block.body.length === 0) continue` -- and whitespace around a named slot's element is what
 * `clean_nodes` takes out. `<Child a="b"><div slot="foo" /></Child>` has a default group of two
 * whitespace text nodes and no default slot at all, and giving the props object a `children` for it
 * put a key in `Object.keys($props())` that Svelte does not have.
 */
export function filled(group: Given | undefined): boolean {
	if (group === undefined) return false;
	return group.nodes.some(
		(one) => !isNode(one) || one['type'] !== 'Text' || String(one['data'] ?? '').trim() !== '',
	);
}

/**
 * What a component is handed, by the name each part of it arrives under.
 *
 * Read out of `visitors/shared/component.js`. The markup inside a component's tag is not one
 * thing. Every `{#snippet}` directly inside it is hoisted and pushed as a prop of its own under
 * its own name; a child carrying `slot="x"` joins the group of that name; everything left over
 * becomes one function passed as `children`. So a component may write one group and not another,
 * and asking about the tag as a whole cannot tell that from a fault -- which is what
 * `<DropdownMenu.Trigger>` was: markup measured as one group, part of it written, and the
 * arithmetic reporting a contradiction that was never there.
 *
 * Keyed by the child so the walk stays in document order, which is the order the ordinals count in.
 */
export function handedTo(
	file: string,
	tag: string,
	nodes: readonly unknown[],
): ReadonlyMap<unknown, Group> {
	const found = new Map<unknown, Group>();
	const groups = new Map<string, Group>();
	const under = (name: string, at: number): Group => {
		const held = groups.get(name);
		if (held !== undefined) return held;
		const one: Group = {
			at,
			probe: `%%h${identity(file, at)}%%`,
			what: name === 'children' ? `\`<${tag}>\`` : `\`<${tag}>\` as \`${name}\``,
		};
		groups.set(name, one);
		return one;
	};

	for (const child of nodes) {
		if (!isNode(child)) continue;
		if (child['type'] === 'SnippetBlock') {
			const id = child['expression'];
			const name = isNode(id) && typeof id['name'] === 'string' ? id['name'] : '';
			// The body, so the declaration keeps its name and the component still receives the prop.
			// An empty one holds nothing to measure and nothing to relax.
			const at = extent(child['body'])?.[0];
			if (name === '' || at === undefined) continue;
			found.set(child, under(name, at));
			continue;
		}
		// Whitespace and comments are not content: Svelte's analysis lets them sit beside an
		// explicit `{#snippet children}` and refuses anything else with `snippet_conflict`. So they
		// open no group, or the literal planted at the group's head would be the content that
		// conflicts, and every probe of a tag written across lines would fail before it measured.
		if (child['type'] === 'Comment') continue;
		if (child['type'] === 'Text' && String(child['data'] ?? '').trim() === '') continue;
		const at = span(child)?.[0];
		if (at === undefined) continue;
		found.set(child, under(slotOf(child) ?? 'children', at));
	}
	return found;
}

/**
 * What a parameter binds, each name as the expression that reaches it from the argument.
 *
 * The way in, read forward out of Svelte's own `_extract_paths` in `compiler/utils/ast.js`, which
 * is the client transform's answer to the same question. There is a way in to every name a pattern
 * binds, and it is not always a member: a key written `[expr]` or as a literal is an index, a
 * nesting is one way in written after another, and a rest is a call --
 * `exclude_from_object(value, keys)` for an object, `to_array(value).slice(n)` for an array. Both
 * are Svelte's own, carried the way `attributes` is, so the emptying rule and the symbol handling
 * are upstream's rather than reproduced here.
 *
 * A default is written the way JavaScript reads one: taken when the value is `undefined` and only
 * then. A computed key is expanded against what the pattern has bound so far, because JavaScript
 * binds a pattern left to right and `{ length, [length - 1]: last }` reads the one from the other.
 */
export function takenApart(
	pattern: AstNode,
	argument: string,
	expand: Locals['rewrite'],
	what: () => string,
	/**
	 * Where a computed key changes something as it is evaluated -- `[`p${num++}`]` -- what it is
	 * held as, so that the member read and the keys a rest leaves out are the one evaluation
	 * JavaScript makes. Absent, a key is written at each place it is read.
	 */
	hold?: (text: string, at: number) => string,
): Map<string, string> {
	const bound = new Map<string, string>();
	// Bound so far, so a computed key reaches a name written before it in the same pattern.
	const write = (node: unknown): string => expand(node, bound);
	const withDefault = (reached: string, fallback: unknown): string =>
		`(${reached} === undefined ? (${write(fallback)}) : ${reached})`;
	const one = (target: unknown, reached: string): void => {
		if (!isNode(target)) return;
		const type = target['type'];
		if (type === 'Identifier' && typeof target['name'] === 'string') {
			bound.set(target['name'], reached);
			return;
		}
		if (type === 'AssignmentPattern') {
			one(target['left'], withDefault(reached, target['right']));
			return;
		}
		// `let:x={{ a, b }}` parses as an expression and is really a pattern -- Svelte says so in as
		// many words, `shared/component.js` rebuilding it with `b.object_pattern(expression.properties)`
		// and an `@ts-expect-error` beside it. Only the outermost one is rebuilt there, because the
		// printer turns the rest back into source JavaScript reads as a pattern; here the node is
		// walked, so both spellings are read at every depth.
		if (type === 'ObjectPattern' || type === 'ObjectExpression') {
			// The keys a rest leaves out are every key the pattern names, in the order Svelte writes
			// them: a plain name as itself, a literal as its value read as a string, and a computed
			// key as `String(...)` of the expression, which evaluates it a second time.
			const taken: string[] = [];
			for (const property of Array.isArray(target['properties']) ? target['properties'] : []) {
				if (!isNode(property)) continue;
				if (property['type'] === 'RestElement' || property['type'] === 'SpreadElement') {
					one(property['argument'], `$$exclude_from_object(${reached}, [${taken.join(', ')}])`);
					continue;
				}
				if (property['type'] !== 'Property') continue;
				const key = property['key'];
				if (!isNode(key)) refuse(`${what()} has a key this compiler cannot read`);
				const computed = property['computed'] === true;
				const literal = key['type'] === 'Literal';
				if (!computed && key['type'] === 'Identifier' && typeof key['name'] === 'string') {
					taken.push(JSON.stringify(key['name']));
					one(property['value'], `${reached}.${key['name']}`);
					continue;
				}
				const text = write(key);
				const place = span(key)?.[0] ?? 0;
				const once =
					!literal && hold !== undefined && assigned(text).length > 0 ? hold(text, place) : text;
				taken.push(literal ? JSON.stringify(String(key['value'])) : `String(${once})`);
				one(property['value'], `${reached}[${once}]`);
			}
			return;
		}
		if (type === 'ArrayPattern' || type === 'ArrayExpression') {
			// Through `to_array` and not by index. An array pattern destructures by the iterator
			// protocol -- Svelte's server writes `let [a, b] = each_array[i]` and lets the engine do
			// it -- and reading `value[0]` instead is the same answer for an array and no answer at
			// all for anything else: measured, `{#each rows as [a, b]}` over a list of sets wrote
			// `-` where Svelte wrote `x-y`.
			//
			// **Without the count `_extract_paths` passes.** That is the client transform's answer to
			// this question and it is one step away from the server's: `to_array(value, n)` caps an
			// unbounded iterator at `n`, and it reaches that branch through `Symbol.iterator in
			// value`, which throws on a primitive. `{@const [first] = 'ab'}` destructures on the
			// server and threw here. So the call is made the way the branch below it behaves --
			// arrays unchanged, everything else through `Array.from` -- which is the engine's answer
			// for every source but an endless one, and an endless one is not a thing a render ends
			// on either way.
			const elements = Array.isArray(target['elements']) ? target['elements'] : [];
			const listed = `$$to_array(${reached})`;
			for (const [at, element] of elements.entries()) {
				if (!isNode(element)) continue;
				if (element['type'] === 'RestElement') {
					one(element['argument'], `${listed}.slice(${String(at)})`);
					continue;
				}
				one(element, `${listed}[${String(at)}]`);
			}
			return;
		}
		refuse(`${what()} destructures in a way this compiler cannot read: a ${String(type)}`);
	};
	one(pattern, argument);
	return bound;
}

/**
 * Writes over everything in a pattern the render would evaluate, leaving one that binds the same
 * names from a placeholder without reaching for anything.
 *
 * The render takes the pattern apart from `{}` or `[]` and every read of what it binds is a marker
 * already, so nothing the pattern computes is wanted -- and each of these throws or reaches for
 * data the render is not given. A default's value and a computed key become `undefined`; a nested
 * pattern becomes a name, because `{ a: { b } }` over `{}` destructures `undefined` and throws,
 * which is Svelte's own output failing on a placeholder nobody wrote. The name carries `$$`, which
 * Svelte reserves and no author can collide with, and the position it stands at, which no two
 * nestings in one file share.
 */
export function neutralise(pattern: unknown, edits: [number, number, string][], top = true): void {
	if (!isNode(pattern)) return;
	const type = pattern['type'];
	const at = span(pattern);
	if (!top && (type === 'ObjectPattern' || type === 'ArrayPattern')) {
		if (at !== null) edits.push([at[0], at[1], `$$p${String(at[0])}`]);
		return;
	}
	if (type === 'AssignmentPattern') {
		const where = span(pattern['right']);
		if (where !== null) edits.push([where[0], where[1], 'undefined']);
		neutralise(pattern['left'], edits, top);
		return;
	}
	if (type === 'RestElement') {
		neutralise(pattern['argument'], edits, false);
		return;
	}
	if (type === 'ObjectPattern') {
		for (const property of Array.isArray(pattern['properties']) ? pattern['properties'] : []) {
			if (!isNode(property)) continue;
			if (property['type'] === 'RestElement') {
				neutralise(property, edits, false);
				continue;
			}
			if (property['computed'] === true) {
				const where = span(property['key']);
				if (where !== null) edits.push([where[0], where[1], 'undefined']);
			}
			neutralise(property['value'], edits, false);
		}
		return;
	}
	if (type === 'ArrayPattern') {
		for (const element of Array.isArray(pattern['elements']) ? pattern['elements'] : []) {
			neutralise(element, edits, false);
		}
	}
}

/** Writes each expression of an attribute back out in its expanded form, for Svelte to evaluate. */
export function expanded(
	attr: AstNode,
	source: string,
	walk: Walk,
	edits: [number, number, string][],
): void {
	const name = typeof attr['name'] === 'string' ? attr['name'] : '';
	const value = attr['value'];
	if (value === true) return;
	const at = span(attr);
	// The shorthand holds a bare name and nothing else, so the name is written out first.
	if (at !== null && source[at[0]] === '{') edits.push([at[0], at[0], `${name}=`]);
	for (const part of Array.isArray(value) ? value : [value]) {
		if (!isNode(part) || part['type'] !== 'ExpressionTag') continue;
		const where = span(part['expression']);
		if (where === null) continue;
		// The author's own text where the walk bound nothing in it, so that the render runs the
		// author's script whole. See `asWritten`.
		const written = walk.expand(part['expression']);
		edits.push([where[0], where[1], asWritten(part['expression'], written, walk)]);
	}
}

/** Where an element's opening tag closes: the index of its `>`. */
export function closing(source: string, node: AstNode): number {
	const at = span(node);
	let last = at === null ? 0 : at[0];
	for (const one of Array.isArray(node['attributes']) ? node['attributes'] : []) {
		const where = span(one);
		if (where !== null) last = Math.max(last, where[1]);
	}
	const close = source.indexOf('>', last);
	if (close < 0) refuse('an element this compiler cannot read the tag of');
	return close;
}
