/**
 * Entering a child component at a call site: what the tag passes, what the child's script
 * declares and changes, what a binding sends back, and the copy the child is walked as. See
 * spec/derivation.md.
 */
import { readFileSync } from 'node:fs';
import { basename, relative } from 'node:path';
import { parse } from 'svelte/compiler';
import { apply } from '@seam-js/ast';
import { hands, importsOf, propsOf, rename, rolled, withPrelude } from './compose.ts';
import { type AstNode, identified, isNode, refuse } from './node.ts';
import { collides } from './sentinel.ts';
import { inlined } from './snippets.ts';
import { unbound } from './unbind.ts';
import { awaitless, hydratableCalls } from './awaits.ts';
import { callSite, carriedAcross, merged, settleBindings } from './call-site.ts';
import { bindDeclared, declaredFor, scriptRun } from './bound.ts';
import { collect } from './collect.ts';
import { childOf, rewrittenCallSite } from './copied.ts';
import { leftToSvelte } from './left.ts';
import {
	componentFile,
	importsItself,
	moduleExports,
	shared,
	unimported,
} from './component-files.ts';
import { contains, opensWithText, propBinds, reachesItself, selfCall } from './component-shape.ts';
import { contextual, runesOf, varies } from './dynamic.ts';
import { filled } from './handed.ts';
import { closes, headedFragment, headFoundLate, stamped, wrapped } from './stamps.ts';
import { type Walk } from './walk-types.ts';
import { restated, withAsks, withFresh } from './written.ts';
import { plantThrow, throwsAtTop } from './thrown.ts';

export function descend(
	node: AstNode,
	walk: Walk,
	/** A dynamic component settled to one import: the import's name, and the `this` span. */
	dynamic?: {
		name: string;
		expression: [number, number] | null;
		rewritten?: (fresh: string) => void;
	},
): boolean {
	const tag = dynamic?.name ?? (typeof node['name'] === 'string' ? node['name'] : '');
	const file = componentFile(tag, walk);
	// Nothing this walk can find a file for -- a name bound some other way, a package whose chain
	// of re-exports ends in something that is not a component -- is Svelte's to render, as before.
	if (file === null) return false;
	if (walk.site.stack.includes(file)) {
		// A component rendering itself, entered as the fragment it is: this call is a call of that
		// fragment, standing in for a render that would otherwise not end. Its own file, or one up
		// the stack that renders this one -- every component on a cycle was entered as a fragment,
		// because `reachesItself` read the cycle before the walk went in. See spec/ir.md.
		const fragment = walk.site.callable.get(file);
		if (fragment !== undefined) {
			const source = file === walk.site.file ? walk.source : readFileSync(file, 'utf8');
			selfCall(node, walk, tag, fragment, source, dynamic);
			return true;
		}
		refuse(
			`<${tag} /> is part of a cycle -- ${[...walk.site.stack, file]
				.map((one) => basename(one))
				.join(' -> ')} -- and a compile-time render of one does not end`,
		);
	}

	// A component that throws at the top of its script throws whatever it is handed, so it is not
	// entered: it stands as a hole that throws the same thing per request. See `./thrown.ts`.
	const throws = throwsAtTop(file);
	if (throws !== null) {
		plantThrow(node, walk, throws.argument);
		return true;
	}

	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	const fragment = node['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const site = callSite(node, walk);
	if (site === null) return false;
	const { bindings, byName, boundProps, delayed, boundTo, inertProps, order } = site;

	const brought = carriedAcross(bindings, order, walk, file);

	// Where to roll back to. Everything below appends to lists the caller owns.
	const mark = {
		holes: walk.holes.length,
		blocks: walk.blocks.length,
		keeping: walk.keeping.length,
		edits: walk.edits.length,
		pending: walk.pending.length,
		copies: walk.site.copies.length,
		handed: walk.site.handed.length,
		spreads: walk.site.spreads.length,
		prelude: walk.site.prelude.length,
	};

	/**
	 * Whether Svelte's render of this call site would hand the child a marker for `prop`: where the
	 * value written for it varies with the request, where a spread whose keys nobody can list does,
	 * or where it is bound. A prop the call site does not pass is the child's own default.
	 */
	const handsMarker = (prop: string | undefined): boolean => {
		if (prop === undefined || boundProps.has(prop)) return true;
		if (walk.site.payload === null) return false;
		const value = bindings.get(prop);
		if (value !== undefined) return varies(value, walk);
		return order.some((one) => 'spread' in one && varies(one.spread, walk));
	};

	// Whether the child writes a head, which decides what a failure to enter it means below.
	let headed = false;
	try {
		const raw = inlined(unbound(readFileSync(file, 'utf8')));
		const clash = collides(raw, basename(file));
		if (clash !== null) refuse(clash);
		const ahead = parse(raw, { modern: true }) as unknown as AstNode;
		headed = contains(ahead['fragment'], 'SvelteHead');
		awaitless(ahead, `<${tag} />`);
		// Its number now, not when the tag is renamed: the walk below takes copies of its own, so
		// counting then gave a nested pair of the same component one name twice.
		const ordinal = walk.site.copies.length;
		// A `$props.id()` is a binding the runtime makes when it writes the anchor, named for this
		// copy so that two components declaring one in a page do not share it. The name is not one
		// the request decides: the render is handed the hole's marker as the id, so everything a
		// component computes from its id -- a package's state object, a derived attribute set -- is
		// inert and Svelte's to evaluate, and the marker lands in the bytes wherever the id went. A
		// derivation that reads the id all the same has the binding. See `fresh.ts`.
		const fresh = identified(ahead) ? `__i${String(ordinal + 1)}` : null;
		// The paths this render is fixed at, said in the child's own names. A prop bound to the
		// whole of one is that path inside the child; a prop bound to a prefix of one carries the
		// rest of it along. Without this a child would read `data.locale.code` as its own `data`,
		// which is a different value with the same spelling.
		// Every prop the child declares, bound to what the call site passes or to its own default.
		// A default only fires on `undefined`, which is what a prop the caller left out is.
		const declares = propsOf(ahead, raw);
		if (declares === null) return rolled(walk, mark);
		if (order.some((part) => 'spread' in part)) merged(order, declares, bindings);

		const { settles } = settleBindings({
			walk,
			node,
			tag,
			nodes,
			ahead,
			raw,
			declares,
			delayed,
			boundTo,
			boundProps,
		});

		// A component that renders itself -- through `<svelte:self>` or an import of its own file --
		// is a fragment the runtime calls, and is walked as one: its props are names bound per
		// call, as an each's item is per iteration, rather than substituted, its body is wrapped as
		// a bare block for the assembler to find, and the call inside it is a call of the fragment.
		// Its head could not be wrapped in a block and a rest gathers per call, so neither is taken.
		const recursion =
			contains(ahead['fragment'], 'SvelteSelf') ||
			importsItself(raw, file) ||
			reachesItself(file, raw)
				? `__f${String(walk.blocks.length)}`
				: null;
		if (recursion !== null) walk.site.callable.set(file, recursion);
		// Whether the fragment writes a head is read here, before its body -- and the calls inside
		// it -- are walked. See `headedFragment()`.
		const headedSelf = recursion !== null && contains(ahead['fragment'], 'SvelteHead');
		if (headedSelf && recursion !== null) walk.site.headedFragments.add(recursion);
		// The object the call site passed, which is what `$$props` is inside the child: every
		// attribute and every spread in the order `spread_props` merges them, with the bindings
		// last for the reason `push_prop(..., true)` gives. `sanitize_props` drops `children` and
		// `$$slots`, neither of which this carries, so it is left off; which slots the caller filled
		// is known by name here and is written out rather than read back off the object.
		const groups = hands(walk, nodes, node);
		// `$props()` bound to a name, or gathered into a rest, is the caller's object **with**
		// `children` in it: `VariableDeclaration.js` writes `let { $$slots, $$events, ...rest } =
		// $$props`, which takes out those two and keeps the slot function. `$$props` itself is
		// `sanitize_props($$props)`, which takes out `children` instead -- two objects, not one.
		// The walk composes slot content rather than passing a function for it, so the key has to be
		// put back: `Object.getOwnPropertyNames($props())` listed two names where Svelte lists three.
		//
		// **A function, not `true`.** `build_inline_component` writes the default slot as
		// `children: slot_fn`, and `attributes()` skips a value whose type is `function` -- so a
		// component spreading its whole props into an element writes no `children` attribute, and
		// anything else would. What the function does is nothing: every `{@render}` of it is markup
		// the walk composes where the call stands.
		if (filled(groups.get('children')) && !bindings.has('children')) {
			bindings.set('children', '(() => {})');
			order.push({ name: 'children' });
		}
		const passing = {
			object: `{ ${[
				...order.map((part) =>
					'spread' in part
						? `...(${part.spread})`
						: `${JSON.stringify(part.name)}: ${bindings.get(part.name) ?? 'undefined'}`,
				),
				...delayed.map(([name, value]) => `${JSON.stringify(name)}: ${value}`),
			].join(', ')} }`,
			slots: [...groups.keys()].map((one) => (one === 'children' ? 'default' : one)),
		};
		// A group the caller filled is a prop of the child's, and its value is a function -- the slot
		// or snippet Svelte passes. The scope a child's expressions read is data, so it stands for
		// the one thing a derivation can ask of a function: that it exists. Without it `{#if inner}`
		// over a `{#snippet inner}` written at the call site read `undefined` and the child rendered
		// the else, which is bytes rather than a refusal. See `standsFor()`.
		for (const named of groups.keys()) {
			if (bindings.has(named)) continue;
			if (!declares.some((one) => one.prop === named)) continue;
			bindings.set(named, 'true');
		}
		const props = bindDeclared(walk, ahead, declares, bindings, byName, passing, recursion);
		const { held, bound, params } = props;

		const { declared, inside } = declaredFor(
			walk,
			file,
			ahead,
			raw,
			declares,
			passing,
			fresh,
			recursion,
			props,
		);
		const ranBy = scriptRun(walk, file, raw, declares, declared, site, settles);
		if (recursion !== null) {
			walk.blocks.push({
				index: walk.blocks.length,
				kind: 'if',
				stream: walk.stream,
				expression: 'true',
				tests: ['true'],
				item: null,
				counter: null,
				alternate: false,
				within: [...walk.within],
				bare: true,
				fragment: {
					name: recursion,
					params,
					binds: propBinds(declares, bindings),
					...(opensWithText(ahead['fragment']) ? { textFirst: true as const } : {}),
				},
			});
		}
		const inner: [number, number, string][] = [];
		for (const [[from, to], empty] of declared.reading) inner.push([from, to, empty]);
		if (process.env['SEAM_TRACE'] !== undefined) {
			for (const [[from, to], empty] of declared.reading) {
				console.error(
					`[seam] ${basename(file)}: \`${raw.slice(from, to).replace(/\s+/g, ' ').slice(0, 70)}\` -> ` +
						`${empty.replace(/\s+/g, ' ').slice(0, 90)}`,
				);
			}
		}

		const ast = ahead;
		const prelude: string[] = [];
		// The child's own: a test asked inside it is answered by a statement in its script, not in
		// whichever copy happened to finish next.
		const asks: [string, string][] = [];
		const wants: [string, string][] = [];
		const own = importsOf(raw);
		for (const name of runesOf(own, file)) walk.site.runes.add(name);
		// A name the module block binds is the module block's, and `shared()` will import it there.
		// Restating it in the instance prelude is the same binding declared twice, which
		// `transform-server.js` puts in one module and Svelte answers with
		// `declaration_duplicate`.
		const exported = moduleExports(ahead).names;
		for (const one of brought) {
			if (exported.has(one.local)) continue;
			const already = own[one.local];
			if (already === one.from) continue;
			if (already !== undefined) {
				refuse(
					`\`${one.local}\` is imported by both ${basename(walk.site.file)} and ${basename(file)} ` +
						'from different modules, and a value handed from the first is read by the second ' +
						'under that name, which cannot mean both; rename one of them',
				);
			}
			prelude.push(restated(one));
		}
		const { copy, child, fragmentAt } = childOf(walk, file, raw, ahead, inner, declares, declared, {
			held,
			bound,
			ranBy,
			inside,
			inertProps,
			fresh,
			recursion,
			groups,
			prelude,
			asks,
			wants,
		});
		contextual(ast, child);
		ownCalls(walk, child, file, ast, ranBy);
		// Onto the one stack rather than a copy of it, so whoever reads the stack as the walk goes
		// sees the fragment's block around what the body records. See `boundary()`.
		if (recursion !== null) walk.within.push([fragmentAt, 0]);
		try {
			collect(ast['fragment'], child);
		} finally {
			if (recursion !== null) walk.within.pop();
		}
		// The body as the fragment: everything the root fragment writes, wrapped as the bare block
		// the fragment's block is, with the stamp that names it where the render puts it.
		if (recursion !== null) {
			const root = ast['fragment'];
			const ends = wrapped(
				isNode(root) && Array.isArray(root['nodes']) ? root['nodes'] : [],
				() => `<${tag} />`,
			);
			if (ends !== null) {
				const [first, last] = ends;
				const index = walk.blocks.findIndex((one) => one.fragment?.name === recursion);
				const opener = inner.length;
				inner.push([first[0], first[0], '{#if true}']);
				const [from, to, text] = stamped(walk, index, raw, last[1]);
				const closer = closes(inner, [from, to, `{/if}${text}`]);
				// The component's own head has the fragment stand in the head stream too; one a
				// child inside wrote is found too late. See `headedFragment()`.
				if (headedSelf) headedFragment(walk, index, inner, opener, closer, ast);
				else if (walk.site.headed.has(index)) headFoundLate(`<${tag} />`);
			}
		}
		withPrelude(raw, ast, prelude, inner);
		withAsks(ast, asks, wants, inner);
		withFresh(ast, fresh, declared.ids, inner);
		shared(ast, file, inner);
		copy.asks = asks;
		copy.wants = wants;
		copy.source = unimported(apply(raw, inner));
		if (process.env['SEAM_TRACE_SOURCE'] !== undefined) {
			console.error(`[seam] copy ${basename(copy.at)} of ${basename(file)}:\n${copy.source}\n`);
		}

		rewrittenCallSite(walk, node, ahead, attributes, declares, held, site);

		// The parent imports this call site's copy rather than the file, which is two edits: the
		// tag's name where it opens and where it closes, and one import beside the others.
		rename(walk, node, tag, copy.at, ordinal, dynamic);

		// Every hole and block this child planted and no deeper child has claimed is written
		// across this file and its callers, innermost first. The deeper ones finished first, so
		// what is unclaimed here is this component's own.
		const chain = [file, ...walk.site.stack.toReversed()].map((one) =>
			relative(walk.site.root, one),
		);
		for (const hole of walk.holes.slice(mark.holes)) hole.files ??= chain;
		for (const block of walk.blocks.slice(mark.blocks)) block.files ??= chain;
		for (const one of walk.keeping.slice(mark.keeping)) one.files ??= chain;
		return true;
	} catch (error) {
		return leftToSvelte(error, walk, mark, tag, file, headed, handsMarker);
	}
}

/**
 * A child's own `hydratable` calls, made as its script initializes: after its caller's script and
 * before its own markup, once per render, which is where Svelte's render makes them. Taken where
 * the child is rendered once whatever the request -- every block around it a branch the build
 * fixed, or a boundary's own body -- and its script is substituted rather than run, since a run is
 * written at each read and a call per read is not Svelte's one per render; anything else is left to
 * `unhydrated()`, which refuses a key no derivation makes. Kit renders every page as a child of its
 * root, so a page's `hydratable` is one of these. See spec/derivation.md.
 */
function ownCalls(
	walk: Walk,
	child: Walk,
	file: string,
	ast: AstNode,
	ranBy: ReadonlyMap<string, string>,
): void {
	if (ranBy.size > 0) return;
	const once = walk.within.every(([index, branch]) => {
		const block = walk.blocks[index];
		if (block === undefined) return false;
		if (block.kind === 'boundary') return branch === 0;
		if (block.kind !== 'if') return false;
		const tests = block.tests ?? [block.expression];
		const before = tests.slice(0, branch).every((one) => one === 'false');
		return before && (branch >= tests.length || tests[branch] === 'true');
	});
	if (!once) return;
	for (const call of hydratableCalls(ast)) {
		walk.site.eager.push({
			expression: child.expand(call),
			files: [relative(walk.site.root, file)],
		});
	}
}
