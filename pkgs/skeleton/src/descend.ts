/**
 * Entering a child component at a call site: what the tag passes, what the child's script
 * declares and changes, what a binding sends back, and the copy the child is walked as. See
 * spec/derivation.md.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, relative, resolve as resolvePath } from 'node:path';
import { parse } from 'svelte/compiler';
import {
	apply,
	importsOf as importedBy,
	locals,
	projectAsync,
	RUN_NAME,
	STATE_ON_SERVER,
	stateImports,
} from 'ast';
import {
	hands,
	importsOf,
	legacyMode,
	partial,
	propsOf,
	rebased,
	rename,
	rolled,
	withPrelude,
} from './compose.ts';
import { type AstNode, identified, isNode, refuse, relatesSiblings, span } from './node.ts';
import { collides } from './sentinel.ts';
import { inlined, type Snippet, snippetsIn } from './snippets.ts';
import { unbound } from './unbind.ts';
import { awaiting, awaitless, blockedBy, blocking, movedBy } from './awaits.ts';
import { sentFor } from './branches.ts';
import { callSite, carriedAcross, merged, REST, settleBindings, standsIn } from './call-site.ts';
import { collect } from './collect.ts';
import {
	componentFile,
	contains,
	importsItself,
	moduleExports,
	opensWithText,
	propBinds,
	reachesItself,
	selfCall,
	shared,
	unimported,
} from './components.ts';
import {
	contextual,
	hostedIn,
	HYDRATABLE,
	HYDRATABLE_RUN,
	placed,
	runesOf,
	varies,
} from './dynamic.ts';
import { closing, filled } from './selection.ts';
import { closes, headedFragment, headFoundLate, stamped, wrapped } from './stamps.ts';
import { type Copy, Undecided, type Walk } from './walk-types.ts';
import {
	exportedBy,
	holding,
	keptUnder,
	restated,
	stands,
	withAsks,
	withFresh,
} from './written.ts';

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

	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	const fragment = node['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const site = callSite(node, walk);
	if (site === null) return false;
	const {
		bindings,
		byName,
		awaits,
		boundProps,
		delayed,
		unsettled,
		boundTo,
		inertProps,
		order,
		listed,
	} = site;

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
		const held =
			recursion === null ? rebased(walk.site.fixed, declares, bindings) : new Map<string, string>();
		const params = declares.map((one) => one.local);
		const bound = new Map<string, string>();
		const named = new Set(
			declares.filter((one) => one.rest !== true && one.whole !== true).map((one) => one.prop),
		);
		/**
		 * What each held prop is bound to when the hold is given up, and where the list stood first.
		 *
		 * A hold is a reference this compiler resolves, and the child's **script** is handed to
		 * Svelte to evaluate. Where a declaration in that script reaches one, the reference would be
		 * written into source Svelte parses -- "`$$hold` is an illegal variable name" -- so the props
		 * are bound to their values instead and the identity this would have kept is given up. Only
		 * the script: a markup read is a hole, and a hole is an expression this compiler evaluates.
		 */
		const plain = new Map<string, string>();
		const before = walk.keeping.length;
		for (const one of declares) {
			if (recursion !== null) {
				bound.set(one.local, one.local);
				continue;
			}
			// `let props = $props()` binds the object itself, which is the one `$$props` is bound to.
			if (one.whole === true) {
				bound.set(one.local, `(${passing.object})`);
				continue;
			}
			if (one.rest === true) {
				// What `$props()` leaves in a rest: every attribute the caller wrote that the pattern
				// did not name, as an object of the caller's own expressions. Where a spread's keys
				// are the request's, `merged()` bound the rest already.
				const whole = bindings.get(REST);
				if (whole !== undefined) {
					bound.set(one.local, whole);
					continue;
				}
				const others = [...bindings]
					.filter(([prop]) => !named.has(prop))
					.map(([prop, value]) => `${JSON.stringify(prop)}: ${value}`);
				bound.set(one.local, `({ ${others.join(', ')} })`);
				continue;
			}
			// A default is JavaScript's, taken when the value is `undefined` and only then -- a prop
			// the caller passes as `undefined` takes it as much as one the caller leaves out.
			const given = bindings.get(one.prop);
			const value =
				given === undefined
					? one.fallback
					: one.fallback === 'undefined'
						? given
						: `(${given} === undefined ? (${one.fallback}) : ${given})`;
			// A value that **makes** something is held at the call site, which is where its identity
			// belongs: the caller evaluates it once and hands the child that one value, so two reads
			// inside the child must not build two. Recorded under the caller's own chain rather than
			// this child's, which is what makes the caller's reads of the same text and the child's
			// land on one derivation. See spec/derivation.md.
			const kept = holding(one.prop, given, byName, walk);
			if (kept !== null) plain.set(one.local, value);
			bound.set(one.local, kept ?? value);
		}
		// What the child imports from Kit's `$app/state`, bound the way its server module reads it:
		// `page` is the request's one object, which the root takes as its prop of that name, so the
		// child's `page` is the root's whichever level this is; the other two hold what a server
		// holds while it writes. Nothing is carried from the module. See spec/framework.md.
		for (const [local, exported] of stateImports(ahead['instance'])) {
			bound.set(local, exported === 'page' ? 'page' : (STATE_ON_SERVER[exported] ?? local));
		}

		// The child's declarations, with what each prop is bound to, so that one reading a prop the
		// caller gave a constant is left for the render to evaluate rather than neutralised.
		const inside = recursion === null ? walk.dynamic : new Set([...walk.dynamic, ...params]);
		let declared = locals(
			raw,
			held,
			fresh,
			bound,
			inside,
			// Not the sixth: that names props the payload carries, which is the entry's shape. A
			// child's are bound at its call site and arrive as `bound`, and naming them here stopped
			// them being recorded as declarations at all.
			undefined,
			// The list `rest_props` leaves out, in the order `transform-server.js` builds it: the
			// readonly exports first, then the bindable props. `export function b() {}` is one of the
			// first, and leaving it out put `b` in `$$restProps` where Svelte has three keys and we
			// wrote four.
			[
				...exportedBy(ahead),
				...declares.filter((one) => one.rest !== true && one.whole !== true).map((one) => one.prop),
			],
			passing,
			walk.keeping,
			// The copy's script runs as Svelte compiled it where a read cannot be substituted. See
			// `ranBy` below.
			'run',
		);
		for (const [name, why] of declared.changed) walk.site.changing.set(name, why);
		// A hold the child's script reaches is given up, and every hold of this call goes with it:
		// the list is indexed, so dropping one and keeping another would need the indices renumbered
		// for the sake of a distinction nothing here measures.
		if (plain.size > 0 && declared.reading.some(([, empty]) => empty.includes('$$hold('))) {
			for (const [local, value] of plain) bound.set(local, value);
			walk.keeping.length = before;
			declared = locals(
				raw,
				held,
				fresh,
				bound,
				inside,
				undefined,
				[
					...exportedBy(ahead),
					...declares
						.filter((one) => one.rest !== true && one.whole !== true)
						.map((one) => one.prop),
				],
				passing,
				walk.keeping,
				'run',
			);
		}
		// What the copy's own statements change is answered by its script run, per call site: the
		// props are what the call site passes, in the caller's terms, and the reads become fields of
		// the run -- over the prop's own binding, since a prop the script changes
		// holds what the script left. See `ran()` in skeleton.ts, and spec/derivation.md, "Where
		// substitution cannot follow, the script runs as Svelte compiled it".
		const ranBy = new Map<string, string>();
		const running = [...declared.changed]
			.filter(([, why]) => !why.includes('changed by a function this render calls'))
			.map(([name]) => name);
		// What a function the markup calls changes while the bytes are written is not in any run,
		// and a copy's reads are always written out, so it stays refused as it always was.
		const during = [...declared.changed].find(([name]) => !running.includes(name));
		if (during !== undefined) throw new Error(during[1]);
		if (running.length > 0) {
			// One case the run is not the answer for, and it keeps the refusal it had: where nothing
			// the call site passes varies with the request, the child is Svelte's to render -- the
			// render is handed the values themselves, and a caller's local a run would read is in no
			// scope a derivation has. See `handsMarker`. A prop the call site binds is the other
			// half of a run, below.
			const varying =
				walk.site.payload !== null &&
				([...bindings.values()].some((value) => varies(value, walk)) ||
					order.some((one) => 'spread' in one && varies(one.spread, walk)));
			const [first] = running;
			if (!varying)
				throw new Error(declared.changed.get(first ?? '') ?? 'a name the script changes');
			if (HYDRATABLE.test(raw)) refuse(HYDRATABLE_RUN);
			const passed = [
				...order.map((one) =>
					'spread' in one
						? `...${one.spread}`
						: `${JSON.stringify(one.name)}: ${bindings.get(one.name) ?? 'undefined'}`,
				),
				...delayed.map(([name, value]) => `${JSON.stringify(name)}: ${value}`),
			];
			// Written at each read rather than held: the props may read a name a block binds -- a child
			// in an each is run once per item -- and a held value is one per request. The run is a
			// pure function of them, so a second read runs it again to the same answer.
			const call = `${RUN_NAME}({ ${passed.join(', ')} })`;
			const run = projectAsync() ? `(await ${call})` : call;
			for (const name of running) {
				ranBy.set(name, `(${run}.${name})`);
				ranBy.set(`$${name}`, `(${run}.$${name})`);
			}
			// A prop the call site binds that the script changes sends what the script left back up,
			// where the caller passed `undefined`, and the caller's template renders again reading
			// it. What it sends is the run of the loop's first pass -- the getters expanded with
			// nothing settled -- held under this child's chain and read by the caller's ternary as
			// `($$hold(n).name)`; the reads above are the second pass, whose props carry the settled
			// names. See spec/derivation.md, "A hold may name the child's chain, and that is how a
			// value crosses back up".
			const sending = running.filter((name) => {
				const prop = declares.find((one) => one.local === name)?.prop;
				return prop !== undefined && boundProps.has(prop);
			});
			if (sending.length > 0) {
				// The bound prop's getter with nothing settled wherever it is passed -- a binding is
				// also listed in `order` -- since a settled getter reads this very hold.
				const firstPassed = [
					...order.map((one) =>
						'spread' in one
							? `...${one.spread}`
							: `${JSON.stringify(one.name)}: ${unsettled.get(one.name) ?? bindings.get(one.name) ?? 'undefined'}`,
					),
					...delayed.map(
						([name, value]) => `${JSON.stringify(name)}: ${unsettled.get(name) ?? value}`,
					),
				];
				const firstCall = `${RUN_NAME}({ ${firstPassed.join(', ')} })`;
				const first = projectAsync() ? `(await ${firstCall})` : firstCall;
				const at = keptUnder(first, [...walk.site.stack, file], walk);
				for (const name of sending) {
					const prop = declares.find((one) => one.local === name)?.prop ?? name;
					if (walk.sent.has(boundTo.get(prop) ?? prop)) continue;
					if (settles(prop, `($$hold(${String(at)}).${name})`)) continue;
					throw new Error(
						`\`${name}\` is a prop this component changes and the call site binds, so what ` +
							'the script leaves goes back up to the caller, and the block this tag sits in ' +
							'is one the walk cannot put a test to. Compute the value in one expression, ' +
							'or move what changes it out of the render. See spec/derivation.md',
					);
				}
			}
		}
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
		const snippets = new Map<string, Snippet>();
		snippetsIn(ast['fragment'], snippets);

		// A copy per call site, so two of the same component do not write one marker twice.
		const at = resolvePath(
			dirname(walk.site.file),
			`__seam-${basename(file, '.svelte')}-${String(walk.site.copies.length)}.svelte`,
		);
		const copy: Copy = { file, at, source: '', raw, inner, within: [...walk.within] };
		walk.site.copies.push(copy);

		// The anchor's hole comes before every hole the child plants, which is where Svelte writes
		// the anchor: at the start of the component, before anything it renders.
		if (fresh !== null) {
			copy.fresh = walk.holes.length;
			walk.holes.push({ index: copy.fresh, expression: fresh, raw: false, fresh: true });
		}

		// The fragment's block encloses everything the body walks, so a head met inside marks it.
		const fragmentAt = walk.blocks.findIndex((one) => one.fragment?.name === recursion);
		// This copy's own settled names, and none of the caller's. See `sentFor`.
		const ownSent = sentFor(walk.site.sent, copy);
		const child: Walk = {
			...walk,
			source: raw,
			edits: inner,

			within: walk.within,
			expand: (child, extra, given) => {
				const text = placed(
					declared.rewrite(
						child,
						new Map([...bound, ...ranBy, ...(extra ?? new Map())]),
						given ?? ownSent,
					),
					child,
					file,
				);
				return walk.trying === undefined ? text : walk.trying(text);
			},
			plain: (child, extra) => declared.rewrite(child, extra),
			runeOf: declared.rune,
			declares: declared.has,
			handedAsWritten: new Set(
				declares.filter((one) => inertProps.has(one.prop)).map((one) => one.local),
			),
			legacy: legacyMode(ast, file),
			sent: ownSent,
			snippets,
			siblings: relatesSiblings(ast),
			dynamic: inside,
			fresh: fresh === null ? walk.fresh : [...walk.fresh, fresh],
			site: {
				file,
				root: walk.site.root,
				blocked: blockedBy(ast),
				moved: movedBy(ast, inside),
				hosted: hostedIn(raw, file),
				imports: importsOf(raw),
				carried: importedBy(raw),
				defaults: new Map(),
				stood: walk.site.stood,
				changing: walk.site.changing,
				copies: walk.site.copies,
				choices: walk.site.choices,
				stack: [...walk.site.stack, file],
				prelude,
				asks,
				wants,
				told: walk.site.told,
				mute: walk.site.mute,
				sends: walk.site.sends,
				sent: walk.site.sent,
				sending: walk.site.sending,
				tested: walk.site.tested,
				runes: walk.site.runes,
				contexts: walk.site.contexts,
				...(recursion === null ? {} : { fragment: recursion }),
				fragments: new Map(),
				given: groups,
				payload: walk.site.payload,
				missed: walk.site.missed,
				headed: walk.site.headed,
				callable: walk.site.callable,
				headedFragments: walk.site.headedFragments,
				handed: walk.site.handed,
				spreads: walk.site.spreads,
				copy,
				probing: walk.site.probing,
				fixed: held,
				decided: walk.site.decided,
			},
		};
		contextual(ast, child);
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

		// The values stay where they were written and are handed to the render as nothing. The
		// child's markers already carry the expressions, so what the call site passes is dead --
		// and live, it would be evaluated against data the render is not given.
		//
		// Nothing, except for the paths this render is fixed at: those the compiler knows, and
		// markup the child leaves for Svelte to evaluate reads them out of its props like anything
		// else. So the prop is handed exactly them, in the shape they sit in, and nothing more.
		// A spread of the request's goes the same way, whole: every prop it decided is bound
		// inside the child, and evaluated here it would read the payload the render is not given.
		for (const part of order) {
			// A spread whose object awaits leaves an empty one behind rather than nothing: what makes
			// Svelte wrap this tag in a `child_block` is the await, and an empty spread carries no
			// key. See `waitsOn()`.
			if ('spread' in part && part.at !== null) {
				const held = awaiting(part.spread) ? '{...await {}}' : '';
				walk.edits.push([part.at[0], part.at[1], held]);
			}
		}
		// A listed spread keeps what the request does not decide, which the render is handed as
		// written the way any such prop is, and loses what it does -- which the child's markers carry,
		// and which evaluated here would read the payload the render is not given.
		for (const one of listed) {
			if (one.at === null || walk.site.payload === null) continue;
			const kept = one.entries.filter(([, value]) => !varies(value, walk));
			if (kept.length === one.entries.length) continue;
			const text =
				kept.length > 0
					? `{...{ ${kept.map(([key, value]) => `${JSON.stringify(key)}: ${value}`).join(', ')} }}`
					: awaiting(one.grown)
						? '{...await {}}'
						: '';
			walk.edits.push([one.at[0], one.at[1], text]);
		}
		for (const one of attributes) {
			// A `bind:` is written out as the plain attribute it used to be rewritten to. The setter
			// is not needed here: a child that could send something back was refused above, so what
			// is left is a binding whose getter is the whole of it, and the caller's tag has to be
			// something Svelte can evaluate like any other prop.
			if (isNode(one) && one['type'] === 'BindDirective') {
				const name = typeof one['name'] === 'string' ? one['name'] : '';
				const local = declares.find((each) => each.prop === name)?.local;
				const known = local === undefined ? undefined : partial(held, local);
				const whole = span(one);
				if (whole !== null && !(known === undefined && inertProps.has(name))) {
					const placed = blocking(
						one['expression'],
						known === undefined ? standsIn(ahead, local) : JSON.stringify(known),
						walk,
					);
					// Written last, not where it stood. `push_prop(..., true)` delays a binding's
					// pair so it comes after the spreads -- "to avoid spreads overwriting them" --
					// and the fold this walk makes says so, so the render has to say so too.
					// `<Button bind:value {...props} />` with `value` in the spread wrote the
					// spread's where Svelte wrote the binding's.
					walk.edits.push([whole[0], whole[1], '']);
					const shut = closing(walk.source, node);
					// Before the slash of a self-closing tag, which is part of how it closes.
					const close = walk.source[shut - 1] === '/' ? shut - 1 : shut;
					walk.edits.push([close, close, ` ${name}={${placed}} `]);
				}
				continue;
			}
			if (!isNode(one) || one['type'] !== 'Attribute') continue;
			const value = one['value'];
			const parts = value === true ? [] : Array.isArray(value) ? value : [value];
			const whole = span(one);
			// A `--x` is not a prop. `build_inline_component` collects it into `custom_css_props` and
			// `$.css_props` writes `<svelte-css-wrapper style="display: contents; ${styles}">`, where
			// `style_object_to_string` escapes each value the way an attribute is escaped. So the
			// value is written into the bytes and takes a marker, where it was being neutralised to
			// `null` and dropped: measured on `css-vars-escape`, whose whole point is the escaping.
			//
			// What stays open is the presence half: that helper drops a key whose value is null or
			// the empty string, and a marker is neither, so a request that sends nothing gets
			// `--color: ;` where Svelte writes no declaration at all. See spec/roadmap.md.
			if (typeof one['name'] === 'string' && one['name'].startsWith('--')) {
				const [only] = parts;
				if (whole === null || parts.length !== 1 || !isNode(only)) continue;
				if (only['type'] !== 'ExpressionTag') continue;
				const written = stands(walk.expand(only['expression']), walk);
				walk.edits.push([whole[0], whole[1], `${one['name']}={${written}}`]);
				continue;
			}
			// `{p}` is `p={p}`, and the short form's braces hold a bare name and nothing else, so
			// the whole attribute is written out rather than its value replaced. The same thing a
			// marker planted in one costs, met again.
			const name = typeof one['name'] === 'string' ? one['name'] : '';
			const local = declares.find((each) => each.prop === name)?.local;
			const known = local === undefined ? undefined : partial(held, local);
			// Left as written where the value varies with nothing the request decides: Svelte
			// evaluates the caller's expression and hands the child the value itself.
			if (known === undefined && inertProps.has(name)) continue;
			const stood = known === undefined ? standsIn(ahead, local) : JSON.stringify(known);
			// Still reading what the caller's expression read that Svelte's async mode makes wait, so
			// the tag is wrapped where Svelte wraps it. See `blocking()`.
			const blocked = blocking(
				parts.map((part) => (isNode(part) ? part['expression'] : undefined)),
				stood,
				walk,
			);
			const placed = awaits.has(name) ? `await ${blocked}` : blocked;
			if (whole !== null && walk.source[whole[0]] === '{') {
				walk.edits.push([whole[0], whole[1], `${name}={${placed}}`]);
				continue;
			}
			for (const part of parts) {
				if (!isNode(part) || part['type'] !== 'ExpressionTag') continue;
				const where = span(part['expression']);
				if (where !== null) walk.edits.push([where[0], where[1], placed]);
			}
		}

		// The parent imports this call site's copy rather than the file, which is two edits: the
		// tag's name where it opens and where it closes, and one import beside the others.
		rename(walk, node, tag, at, ordinal, dynamic);

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
		// Rolled back, and the component is rendered by Svelte the way it was before this tried.
		// A refusal from inside a child is a refusal about a file the author did not ask to
		// compile, so it is not theirs to see.
		rolled(walk, mark);
		// The walk asking for a second render is not the walk failing, and it is answered above.
		if (error instanceof Undecided) throw error;
		if (String((error as Error).message).includes('is part of a cycle')) throw error;
		// Left to Svelte, a child writing a head inside a block would render one head block where a
		// request renders one per branch or per item, and nothing downstream could tell. So this
		// one is the author's to see, with why the walk could not enter -- and so is a block found
		// deeper that cannot stand in the head stream, which says so itself.
		const reason = String((error as Error).message);
		// Nothing in the pass that asks the render is final: a branch the request never takes is
		// walked in it too, and a refusal inside one is about markup that never renders.
		if (walk.asking !== true && reason.includes('stand in the head stream')) throw error;
		// Left to Svelte, an `await` in markup would not compile at all: it is the author's to see.
		if (walk.asking !== true && reason.includes('async Svelte')) throw error;
		// Left to Svelte, a binding the child sends back writes the caller's markup a second time
		// and this compiler would keep the first pass, which is bytes nobody asked for rather than
		// a component it could not read. So it is the author's to see too.
		//
		// **Past one catch rather than all of them.** The binding is written in the markup of the
		// component this walk is in, not in the child that declares the prop, so that component is
		// the one to leave to Svelte: `bind_props` then runs inside Svelte's own render of it and
		// whatever it settled is there for the caller above to read. Rolling back only the child
		// leaves the binding in a copy this pass rewrote, where the value it fills in is a
		// placeholder's -- `component-binding-blowback-d` wrote `{}` where Svelte wrote
		// `{"value":"0:0"}`. Where there is no catch outside this one the entry holds the binding
		// and there is nothing to leave, so it reaches the author as before.
		if (walk.asking !== true && reason.includes('a binding the child sends back')) {
			const carried = error as { past?: true };
			if (carried.past !== true) {
				carried.past = true;
				throw error;
			}
		}
		// Left to Svelte, a child that changes a value is handed the marker standing for it and
		// computes with that: `export let value; value += 1` over a marker wrote `%%s0%%1`, which is
		// the marker back with a digit on it, so nothing downstream could tell. The author's to see
		// -- but only where a marker is what the child would be handed. A prop whose value here
		// reads nothing the request decides reaches Svelte's render as written, and the render runs
		// the child's script over it as a server would.
		if (
			walk.asking !== true &&
			reason.includes('is a prop this component changes') &&
			handsMarker(/^`([^`]+)`/.exec(reason)?.[1])
		) {
			throw error;
		}

		// Left to Svelte, a context read is evaluated in the render -- where the `setContext` above
		// it was handed the literal standing in for a request value, so the child bakes that. The
		// refusal has to reach the author rather than turn into a component rendered as it was.
		if (walk.asking !== true && reason.includes('a context read where a `setContext`')) {
			throw error;
		}
		// The same: left to Svelte, the read is evaluated against the render's own copy of the
		// module, which is not the one the artifact calls into. See `changedBy()`.
		if (walk.asking !== true && reason.includes('a module binding something in that module')) {
			throw error;
		}
		// Async Svelte outside its async mode is refused by Svelte's own compiler as well as by this
		// walk, so leaving it to the render is not the answer it is for a gap -- the render does not
		// take it either, answering `Cannot use \`await\` in deriveds and template expressions`,
		// which would put the sample in the list under upstream's words. See spec/suite.md.
		if (walk.asking !== true && reason.includes('which is async Svelte')) throw error;
		if (walk.asking !== true && headed && walk.within.length > 0) {
			refuse(
				`<${tag} /> writes a \`<svelte:head>\` inside a block, so the block has to stand in the ` +
					`head stream, and the walk could not enter it: ${reason.replace(/\. See spec\/refusals\.md$/, '')}`,
			);
		}
		if (process.env['SEAM_TRACE'] !== undefined) {
			console.error(
				`[seam] could not enter ${basename(file)}: ${reason.replace(/\s+/g, ' ').slice(0, 240)}`,
			);
		}
		walk.site.missed.push({ file, reason });
		return false;
	}
}
