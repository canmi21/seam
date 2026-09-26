/**
 * Where the render writes what the walk declared: the stamp after a block, a block mirrored into
 * the head stream, the bare block a fragment is wrapped in, a title's stand-in, and the order
 * held declarations and hoisted snippets are put in. See spec/ir.md.
 */
import { type Locals, declaredBy, declaring, reads as readsIn, runeCalled, runeHolds } from 'ast';
import { type AstNode, holdsFor, isNode, namesIn, refuse, span } from './node.ts';
import { carrier, elementCarrier, headCloses, headOpens, headOpensWith } from './sentinel.ts';
import type { Snippet } from './snippets.ts';
import { awaitsAtTop } from './awaits.ts';
import { unknown } from './branches.ts';
import { collect } from './collect.ts';
import { neutralise, takenApart } from './selection.ts';
import { type Walk } from './walk-types.ts';
import { appended } from './written.ts';

/**
 * Whether every `{#snippet}` this component declares holds a body the render can write on its own.
 *
 * A `{@render}` whose callee cannot be followed is left to the render, which then calls whichever
 * snippet the value holds and writes that body's bytes. A body is walked where a render tag names
 * it and nowhere else, so one left to the render is one this pass never rewrote: `{#snippet
 * one()}<b>{data.a}</b>{/snippet}` reached Svelte's own renderer as written and read `.a` of the
 * nothing a render is given.
 *
 * **Which snippet the render will call is the question that could not be answered, so the answer
 * covers all of them.** That is Svelte's own model of a site it cannot resolve:
 * `2-analyze/visitors/RenderTag.js` writes `node.metadata.snippets = analysis.snippets` for one,
 * linking it to every snippet in the component.
 *
 * Every identifier in a body counts, one a parameter or a `{@const}` shadows included. Refusing
 * where the walk could have gone in costs a compile that names a file; the other direction costs
 * bytes nobody asked for.
 */
export function inertBodies(snippets: ReadonlyMap<string, Snippet>, walk: Walk): boolean {
	const names = unknown(walk);
	if (names.size === 0) return true;
	let found = false;
	const seek = (node: unknown): void => {
		if (found) return;
		if (Array.isArray(node)) {
			for (const one of node) seek(one);
			return;
		}
		if (!isNode(node)) return;
		if (node['type'] === 'Identifier' && typeof node['name'] === 'string') {
			if (names.has(node['name'])) found = true;
			return;
		}
		for (const one of Object.values(node)) seek(one);
	};
	for (const one of snippets.values()) {
		if (!one.declared || one.node === undefined) continue;
		seek(one.node['body']);
		if (found) return false;
	}
	return true;
}

/**
 * The stamp that says which block just closed, refused where writing one would change the bytes.
 *
 * Inside a table, text is not writable and the stamp has to be an element -- and an element is a
 * sibling, which Svelte's CSS analysis stops at, so a `+` or `~` in this component's stylesheet
 * would stop matching and the elements it relates would silently lose their scoping class.
 * Measured: two `<tr>`s related by `+`, with a block between them, both lost it. No carrier avoids
 * it there, so the combination is named rather than compiled wrong. See `carrier()`.
 */
/**
 * Where a block's stamp goes: in front of the text that follows it, or right after the block.
 *
 * A stamp is text, and prefixing the author's text node changes what Svelte does with that node's
 * leading whitespace -- `clean_nodes` collapses whitespace between a block and a text node to one
 * space, and keeps whitespace *inside* a text node as written, so a stamp at the block turned
 * ` tail` into `\n\ttail`. Written in front of the first character the author wrote, the leading
 * whitespace is still leading and the node is the one Svelte would have had.
 *
 * Nothing to stand in front of -- what follows is an element, a block, one of the other tags, or
 * the end -- and the stamp goes at the block, where it is the whole of a node of its own. Measured
 * against Svelte for text, an element, a block and the end of a fragment, in both namespaces.
 *
 * **An `{expression}` counts as text here, and it was the one shape not measured.** `clean_nodes`
 * asks `next?.type !== 'ExpressionTag'` before collapsing a text node's *trailing* whitespace, so
 * an expression tag holds the whitespace in front of it as written where a block or an element
 * collapses it to one space. A stamp written at the block turned that node from whitespace into
 * `stamp` plus whitespace: no longer leading, so nothing collapsed, and `{/each}\n\n{value}` kept
 * both newlines where Svelte writes one space. In front of the tag the whitespace is leading
 * again, and it collapses the way it would have.
 */
function stamping(source: string, end: number): number {
	let at = end;
	while (at < source.length && /\s/.test(source[at] ?? '')) at += 1;
	const next = source[at];
	if (next === undefined || next === '<') return end;
	// `{` opens a tag or a block, and only `{expression}` is the one `clean_nodes` treats as text:
	// `#` and `:` and `/` are a block, `@` is `{@html}`, `{@render}` or `{@const}`, and none of
	// those is an `ExpressionTag`.
	if (next === '{') return '#:/@'.includes(source[at + 1] ?? '') ? end : at;
	return at;
}

/**
 * The stamp for a block, written where `stamping` puts it, refused where writing one would change
 * the bytes.
 */
export function stamped(
	walk: Walk,
	index: number,
	source: string,
	end: number,
	close = '',
): [number, number, string] {
	const at = stamping(source, end);
	// In front of the author's text the stamp is part of a node that is not whitespace-only, so
	// the parent's whitespace rule never applies to it and text carries it wherever text is legal.
	const mark = stamps(walk, index, close, at > end);
	return [end, at, `${source.slice(end, at)}${mark}`];
}

export function stamps(walk: Walk, index: number, close = '', beside = false): string {
	const tight = walk.tight && !beside;
	if (walk.siblings && elementCarrier(walk.parent, tight)) {
		refuse(
			`this block sits directly inside \`<${String(walk.parent)}>\`, where the marker saying which ` +
				'block closed has to be an element because text is not writable there -- and this ' +
				"component's stylesheet relates siblings with `+` or `~`, which that element would stand " +
				'between, so the elements it relates would lose their scoping class. Wrapping the block in ' +
				'a cell of its own, or relating those two elements without a sibling combinator, avoids it',
		);
	}
	return carrier(index, walk.parent, close, tight, tight && walk.svg);
}

/**
 * Stands a body block in the head stream as well, where a `<svelte:head>` was walked inside it.
 *
 * `$.head` runs where the component does -- once per branch taken, once per item -- so the head
 * holds one head block for every time the body ran the child, and an each that repeats the
 * child's body repeats its head block. The bytes hold no anchor for that: the head is a flat run
 * of head blocks, each a hash anchor, its content and an empty comment, and Svelte writes nothing
 * around the ones a block produced. So the render writes something. A `{@const}` at the start of
 * each branch opens the block in the head, and an expression tag beside the stamp closes it; see
 * `headOpens()` and `headCloses()` for why neither touches the body's bytes. Measured against
 * Svelte for a text-first each, an if holding one component alone, whitespace on both sides, an
 * `{:else if}` chain, an each with a fallback, and the carriers a table and a select need.
 *
 * The head half is a block of its own, bare -- the anchors are ours and go from the bytes -- and
 * it borrows the body half's alternates: both are the one if or each, and the render made with a
 * branch of one taken is the render made with that branch of the other. The assembler then reads
 * it as it reads any block in the head, and the head IR carries the if or the each the body does.
 */
export function mirrored(
	walk: Walk,
	block: number,
	closer: number,
	opens: (number | null)[],
	/** The edits of the file the block sits in, which is the walk's own unless a child's. */
	edits = walk.edits,
): number {
	const { blocks } = walk;
	const body = blocks[block];
	const closing = edits[closer];
	if (body === undefined || closing === undefined) return -1;
	const index = blocks.length;
	blocks.push({
		...body,
		index,
		stream: 'head',
		within: [...(body.within ?? [])],
		bare: true,
		mirrors: block,
		// A fragment's head half is a fragment of its own, named after the body's, with the same
		// parameters and the same first binds; a call inside it is a call of the head half. It
		// opens with no text, so nothing is written back ahead of it.
		...(body.fragment === undefined
			? {}
			: {
					fragment: {
						name: `${body.fragment.name}h`,
						params: body.fragment.params,
						binds: body.fragment.binds,
					},
				}),
	});
	// A branch that holds nothing gets no open: the close writes the empty pair on its own. An if
	// without an `{:else}` has no branch to hold one at all, and is the same case.
	for (const at of opens) {
		if (at !== null) edits.push([at, at, headOpens(index)]);
	}
	// Whatever the edit carried ahead of the stamp stays: a fragment's closes its bare block first.
	const ahead = closing[2].slice(0, closing[2].length - stamps(walk, block).length);
	edits[closer] = [closing[0], closing[1], `${ahead}${stamps(walk, block, headCloses(index))}`];
	return index;
}

/**
 * The nodes of a fragment's root that the bare block wraps: what is written, whitespace at either
 * end aside, and none of what `clean_nodes` hoists out of the fragment -- a `<svelte:head>` and the
 * other meta elements, which cannot sit inside a block and render the same wherever they sit. One
 * written between the rest would have to be moved, and the edits inside it moved with it, so it
 * is asked to be first or last instead.
 */
/**
 * Closes the bare block a recursive fragment's body is wrapped in, after everything the walk
 * already wrote at that point.
 *
 * `apply` writes back to front, so among edits that begin at one offset the one pushed **first**
 * ends up rightmost. The wrapper's close is written after the body is walked, so it was pushed
 * last and landed to the left of the stamp of a block that ends where the body does: for
 * `{#if depth > 0}<svelte:self/>{/if}` as the whole of a component, the two stamps came out as
 * `%%b0%%%%b1%%` and only the first was read. Merged into that edit instead, which is the one
 * place that says what order the two belong in.
 *
 * @returns the index of the edit that closes the block, for `headedFragment`.
 */
export function closes(edits: [number, number, string][], at: [number, number, string]): number {
	const found = edits.findIndex(([start]) => start === at[0]);
	if (found < 0) {
		edits.push(at);
		return edits.length - 1;
	}
	const one = edits[found] as [number, number, string];
	edits[found] = [one[0], one[1], `${one[2]}${at[2]}`];
	return found;
}

export function wrapped(
	nodes: readonly unknown[],
	what: () => string,
): [first: [number, number], last: [number, number]] | null {
	const hoisted = new Set([
		'SvelteHead',
		'SvelteWindow',
		'SvelteBody',
		'SvelteDocument',
		'SvelteOptions',
	]);
	const written = nodes.filter(
		(one) =>
			isNode(one) &&
			!hoisted.has(String(one['type'])) &&
			!(one['type'] === 'Text' && /^\s*$/.test(String(one['data'] ?? ''))),
	);
	const first = span(written[0]);
	const last = span(written[written.length - 1]);
	if (first === null || last === null) return null;
	for (const one of nodes) {
		if (!isNode(one) || !hoisted.has(String(one['type']))) continue;
		const at = span(one);
		if (at !== null && at[0] > first[0] && at[0] < last[1]) {
			refuse(
				`${what()} renders itself and writes its \`<${String(one['name'] ?? one['type'])}>\` between ` +
					'the markup, which the block around the body cannot hold: writing it first or last ' +
					'in the file is the same component, since Svelte hoists it either way',
			);
		}
	}
	return [first, last];
}

/**
 * Stands a fragment in the head stream as well, where its component writes a `<svelte:head>`.
 *
 * The fragment is called per level of data, so its head block repeats per level the way its body
 * does, and the head IR has to carry the call: the body's block is mirrored as any block is, its
 * head half named after it, and every call of it writes a second marker into the head, read as a
 * call of the head half -- `callsHead()`, which is why the fragment has to be known headed before
 * its body is walked, where the calls are met. The open goes in two places and writes once: a
 * `{@const}` inside the bare `{#if true}` around the body, and a statement at the end of the
 * script, because `clean_nodes` hoists the head ahead of the body and the block has to be open
 * before it runs. Measured against Svelte's own recursion with a head per level and a title, the
 * deepest last level's winning as the last head block executed.
 *
 * A head that reaches the fragment from a component inside its body is refused: it is found only
 * once the body is walked, after the calls inside it were written without a head marker.
 */
export function headedFragment(
	walk: Walk,
	block: number,
	edits: [number, number, string][],
	opener: number,
	closer: number,
	ast: AstNode,
): number {
	const opened = edits[opener];
	if (opened === undefined) return -1;
	const mirror = mirrored(walk, block, closer, [], edits);
	edits[opener] = [opened[0], opened[1], `${opened[2]}${headOpens(mirror)}`];
	appended(ast, [`;${headOpensWith(mirror, 'undefined')};`], edits);
	return mirror;
}

/** The refusal for a head found inside a fragment's body once the calls in it were written. */
export function headFoundLate(what: string): never {
	return refuse(
		`${what} renders itself and a component inside it writes a \`<svelte:head>\`, which is not ` +
			'handled yet: the fragment would have to stand in the head stream, and that is known only ' +
			'once its body is walked, after the calls inside it were written',
	);
}

/**
 * The run of titles and whitespace one title sits in, from the whitespace before its first title
 * to the whitespace after its last, and whether any whitespace is in it outside the titles. What
 * `clean_nodes` hoists is every title in the fragment, so what a run leaves is decided by the run.
 */
export function titleRun(
	source: string,
	from: number,
	to: number,
): { from: number; to: number; spaced: boolean } {
	let start = from;
	for (;;) {
		if (!source.endsWith('</title>', start)) break;
		// From inside the closing tag, or the search finds the title this run started from.
		const open = source.lastIndexOf('<title', start - '</title>'.length);
		if (open < 0) break;
		start = open;
		while (start > 0 && /\s/.test(source[start - 1] ?? '')) start -= 1;
	}
	let end = to;
	for (;;) {
		if (!source.startsWith('<title', end)) break;
		const close = source.indexOf('</title>', end);
		if (close < 0) break;
		end = close + '</title>'.length;
		while (end < source.length && /\s/.test(source[end] ?? '')) end += 1;
	}
	const outside = source.slice(start, end).replace(/<title[\s\S]*?<\/title>/g, '');
	return { from: start, to: end, spaced: /\s/.test(outside) };
}

/** Just past the `}` that closes a block's opening tag, given the span of what it ends with. */
export function afterTag(source: string, ends: [number, number] | null): number | null {
	if (ends === null) return null;
	const close = source.indexOf('}', ends[1]);
	return close < 0 ? null : close + 1;
}

/**
 * Just past an `{:else}`, found from the first node it holds, or null where it holds nothing. The
 * search runs back from that node rather than forward from the block's start, because the branch
 * before it may hold an if with an else of its own.
 */
export function afterElse(source: string, fragment: AstNode): number | null {
	const nodes = Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const first = span(nodes[0]);
	if (first === null) return null;
	const at = source.lastIndexOf('{:else', first[0]);
	return afterTag(source, at < 0 ? null : [at, at]);
}

/**
 * What a `{@const}` or a `{const}`/`{let}` binds, with a node it cannot read named rather than
 * skipped. `declaredBy` is the reading; this is the refusal that belongs to this pass.
 */
export function declarators(node: AstNode): [unknown, unknown][] {
	const found = declaredBy(node);
	if (found.length === 0) refuse('a `{@const}` this compiler cannot read');
	return found;
}

/**
 * What a declaration in markup holds, as source, with a rune's call read through.
 *
 * `DeclarationTag.js` pushes the declaration into `init` unchanged, so its initialiser reaches the
 * same `CallExpression` visitor a script's does and the rune is compiled away the same way: the
 * value is the rune's first argument, `$derived.by`'s is that argument called, and a rune given
 * nothing holds `undefined`. See `runeHolds`.
 */
function heldValue(
	init: unknown,
	expand: Locals['rewrite'],
	bound: ReadonlyMap<string, string>,
): string {
	if (!isNode(init)) return 'undefined';
	if (init['type'] === 'CallExpression') {
		const rune = runeCalled(init['callee']);
		const reach = rune === null ? undefined : runeHolds(rune);
		if (reach !== undefined) {
			const argument = Array.isArray(init['arguments']) ? init['arguments'][0] : undefined;
			if (!isNode(argument)) return 'undefined';
			return `(${expand(argument, bound)})${reach}`;
		}
	}
	return `(${expand(init, bound)})`;
}

/**
 * The declarations a fragment hoists, in the order Svelte binds them.
 *
 * `sort_const_tags` in `3-transform/utils.js` puts a fragment's `{@const}`s in topological order and
 * ahead of everything else, so `{@const a = b}` written above `{@const b = 1}` reads the 1 and a
 * `{@const}` written below the markup that reads it still binds for it. It runs under
 * `!state.analysis.runes`, so it is legacy mode's rule alone: in runes mode the order is the source
 * order, and reading a later one is JavaScript's own temporal dead zone.
 *
 * A `{const}`/`{let}` is never sorted -- `sort_const_tags` names `ConstTag` and nothing else, and
 * `DeclarationTag.js` refuses legacy mode outright, so the two cannot meet in one file.
 *
 * A cycle is `const_tag_cycle`, Svelte's own error. This stops rather than looping, and the render
 * compiles the same source, so Svelte is the one that names it.
 */
function sorted(nodes: readonly AstNode[], walk: Walk): readonly AstNode[] {
	if (!walk.legacy || nodes.length < 2) return nodes;
	const by = new Map<string, AstNode>();
	for (const one of nodes) {
		if (one['type'] !== 'ConstTag') continue;
		const bound = new Set<string>();
		for (const [id] of declarators(one)) namesIn(id, bound);
		for (const name of bound) by.set(name, one);
	}
	if (by.size === 0) return nodes;

	const needs = new Map<AstNode, Set<string>>();
	for (const one of nodes) {
		if (one['type'] !== 'ConstTag') continue;
		const found = new Set<string>();
		for (const [, init] of declarators(one)) {
			readsIn(init, new Set<string>(), (at) => {
				const name = at['name'];
				if (typeof name === 'string' && by.has(name)) found.add(name);
			});
		}
		needs.set(one, found);
	}

	const out: AstNode[] = [];
	const seen = new Set<AstNode>();
	const add = (one: AstNode): void => {
		if (seen.has(one)) return;
		seen.add(one);
		for (const name of needs.get(one) ?? []) {
			const to = by.get(name);
			if (to !== undefined && to !== one) add(to);
		}
		out.push(one);
	};
	for (const one of nodes) if (one['type'] === 'ConstTag') add(one);
	return [...out, ...nodes.filter((one) => one['type'] !== 'ConstTag')];
}

/**
 * A fragment's children, with the declarations it hoists bound for every one of them first.
 *
 * `clean_nodes` in `3-transform/utils.js` lifts a `{@const}` and a `{const}`/`{let}` out of the
 * fragment's nodes into `hoisted`, and `ConstTag.js` and `DeclarationTag.js` push what they declare
 * into the block's `init`, which is written ahead of the template. So a declaration binds for the
 * whole fragment however late in it it was written, and it writes no bytes of its own.
 *
 * Called for a `<slot>`'s group as well as for a fragment node, because a group is a fragment of
 * the caller's that Svelte cleans the same way -- its nodes used to be walked one by one from here,
 * which sent every `{@const}` in a slot to the arm that refuses what the walk has not been taught.
 */
export function held(nodes: readonly unknown[], walk: Walk, alone: unknown): void {
	const inner = hoisting(nodes, walk);
	for (const child of nodes) {
		if (inner !== null && declaring(child)) continue;
		collect(child, {
			...walk,
			...(inner === null ? {} : { expand: inner }),
			alone,
			standalone: true,
		});
	}
}

/**
 * The declarations a fragment hoists, written out, and the substitution its children then read.
 *
 * Null where it hoists none, which is most fragments. Split from `held` because the markup handed
 * to a component the walk could not enter is a fragment too -- Svelte cleans the component's
 * children the same way -- and that loop walks its nodes one at a time to keep each group's holes
 * and blocks apart, so it cannot call `held` and needs what `held` built.
 */
export function hoisting(nodes: readonly unknown[], walk: Walk): Locals['rewrite'] | null {
	const { edits, expand } = walk;
	const hoisted = sorted(nodes.filter(declaring) as AstNode[], walk);
	if (hoisted.length === 0) return null;

	const bound = new Map<string, string>();
	for (const one of hoisted) {
		for (const [id, init] of declarators(one)) {
			// Expanded against what the earlier ones bound, so `{@const b = a + 1}` reaches `a`.
			const value = heldValue(init, expand, bound);
			const at = span(init);
			// The value is unused once every read of it is a marker, and evaluating it would
			// reach for data the render is not given. What stands in has to come apart the way
			// the name does.
			// Still awaiting where the author's did: a `{@const}` that awaits gives what reads it a
			// blocker, and `{@debug}` over one is wrapped for it. See `DebugTag.js`.
			if (at !== null) {
				edits.push([at[0], at[1], awaitsAtTop(init) ? `await ${holdsFor(id)}` : holdsFor(id)]);
			}
			// The pattern stays for the render, taking the placeholder apart, so nothing in it may
			// evaluate: `{@const { [`${a}-x`]: { b } } = f()}` reads `a` and destructures a member
			// of `{}`, and both are gone before the render sees it.
			neutralise(id, edits);

			if (isNode(id) && id['type'] === 'Identifier' && typeof id['name'] === 'string') {
				bound.set(id['name'], value);
				continue;
			}
			// Taken apart the way a snippet's parameter is: a member or an index per name, a
			// default as the choice JavaScript makes, and a rest or a nesting refused by name. A
			// default may read an earlier const, so it is expanded against what those bound.
			const amid: Locals['rewrite'] = (child, more) =>
				expand(child, more === undefined ? bound : new Map([...bound, ...more]));
			for (const [name, reached] of takenApart(id as AstNode, value, amid, () => 'a `{@const}`')) {
				bound.set(name, reached);
			}
		}
	}

	return (child, more) => expand(child, more === undefined ? bound : new Map([...bound, ...more]));
}
