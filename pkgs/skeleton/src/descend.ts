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
	type Carried,
	constant,
	importsOf as importedBy,
	locals,
	readsOf,
	objectEntries,
	parsedComponent,
	projectAsync,
	reads as readsIn,
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
import { branchTest, keyed, sentFor } from './branches.ts';
import { collect } from './collect.ts';
import {
	componentFile,
	contains,
	IDENTIFIER,
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
import { closing, filled, reads } from './selection.ts';
import { closes, headedFragment, headFoundLate, stamped, wrapped } from './stamps.ts';
import { type Copy, Undecided, type Walk } from './walk-types.ts';
import {
	asWritten,
	exportedBy,
	exportedValues,
	getterOf,
	handed,
	holding,
	kept,
	keptUnder,
	NOTHING_SENT,
	restated,
	stands,
	templated,
	withAsks,
	withFresh,
} from './written.ts';

/** The key `merged()` binds a child's rest under, which no attribute can be named. */
const REST = '...';

/**
 * What a call site's spreads leave for each prop the child declares, where a spread's keys are
 * the request's and cannot be listed.
 *
 * `spread_props` in `internal/server/index.js` merges the attributes and the spreads in order,
 * each own enumerable key of a later object overriding an earlier one's -- with `undefined` as
 * much as with a value, since it is the key's presence that decides -- and skips an object that
 * is null. The child reads the props its `$props()` names, so each of those is the fold of the
 * parts in order: an attribute naming it is its value from there on, and a spread is its own
 * value where it has the key and the value so far where it does not. A prop nothing names stays
 * unbound, so the child's default answers. The rest, where the child gathers one, is every key
 * the merge holds that the pattern does not name, which is the merge itself with those taken out.
 * Everything here is an expression over the request, evaluated per request as any derivation is.
 */
export function merged(
	order: readonly ({ name: string } | { spread: string })[],
	declares: readonly { local: string; prop: string; fallback: string; rest?: true }[],
	bindings: Map<string, string>,
): void {
	const named = declares.filter((one) => one.rest !== true).map((one) => one.prop);
	for (const prop of named) {
		const key = JSON.stringify(prop);
		let value = 'undefined';
		let touched = false;
		for (const part of order) {
			if ('name' in part) {
				if (part.name === prop) value = bindings.get(prop) ?? 'undefined';
				continue;
			}
			touched = true;
			value =
				`(${part.spread} != null && Object.prototype.hasOwnProperty.call(${part.spread}, ${key}) ` +
				`? ${part.spread}[${key}] : ${value})`;
		}
		if (touched) bindings.set(prop, value);
	}
	if (!declares.some((one) => one.rest === true)) return;
	const sources = order.map((part) =>
		'spread' in part
			? part.spread
			: `({ ${JSON.stringify(part.name)}: ${bindings.get(part.name) ?? 'undefined'} })`,
	);
	const taken = named.map((prop, at) => `[${JSON.stringify(prop)}]: __seam_named_${String(at)}`);
	bindings.set(
		REST,
		`((({ ${[...taken, '...__seam_rest'].join(', ')} }) => __seam_rest)(Object.assign({}, ${sources.join(', ')})))`,
	);
}

/**
 * Walks into the component a tag names, with its props bound to what the call site passes.
 *
 * **This is the one thing that makes a component more than a value written out.** A component
 * compiles to `Child($$renderer, { ...props })` with no anchor around what it writes, so from
 * outside it there is nothing to read: a value handed over and not written back is an absence, and
 * an absence is the same shape whether the child computed with it, used it twice, or never looked
 * at it. Measured across every shape a child can take -- see spec/refusals.md -- and the only way
 * to tell them apart is to be inside.
 *
 * From inside, none of them is a special case. The child's own expressions become the markers, and
 * each expands through the props to the caller's expression, so a prop used twice is two markers, a
 * prop never used is none, and a prop computed with is the computation. Nothing here knows which
 * of those it is doing.
 *
 * **A failure to descend is not a failure.** Anything this cannot follow is left to Svelte to
 * render exactly as before, which is what keeps this from refusing what already worked: the walk
 * is attempted, and everything it touched is rolled back if it stops. Returns whether it took the
 * component over.
 */
/**
 * The literal the render is handed for a prop whose value this walk models.
 *
 * `null` for nearly all of them: the value is never written into the bytes, so it only has to
 * survive being evaluated. Where the child reads the name as the object of a member expression it
 * does not survive -- `<slot width={box.width}>` on a `null` threw, and the value it would have
 * computed is one the walk had already read for itself. An empty object survives the read and
 * answers `undefined`, which is what a marker would have stood for anyway.
 */
function standsIn(ast: AstNode, local: string | undefined): string {
	if (local === undefined) return 'null';
	let member = false;
	const step = (one: unknown): void => {
		if (member) return;
		if (Array.isArray(one)) {
			for (const each of one) step(each);
			return;
		}
		if (!isNode(one)) return;
		if (one['type'] === 'MemberExpression') {
			const object = one['object'];
			if (isNode(object) && object['type'] === 'Identifier' && object['name'] === local) {
				member = true;
				return;
			}
		}
		for (const value of Object.values(one)) step(value);
	};
	step(ast['fragment']);
	return member ? '{}' : 'null';
}

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
	// A `{#snippet}` inside the tag arrives under its own name and is a group of the caller's like
	// any other -- `hands()` reads it that way, and the component renders it with arguments of its
	// own, which its parameters name. This used to turn the whole tag away.

	// `let:` puts the markup in `$$slots` instead, on a different path through the visitor.

	// What the call site passes, as expressions in the caller's own terms. A handler is bound to
	// null: it is never called while the bytes are written, and leaving it unbound would make the
	// child read a name nothing binds.
	const bindings = new Map<string, string>();
	/**
	 * The props the caller wrote as a bare name, which is what a hold is asked about.
	 *
	 * A name is a read of something the caller already has; an expression written at the tag makes
	 * its value there and hands the child that one. Only the first crosses the boundary as a read,
	 * and only a read of something that **makes** is held. See `held()` below and
	 * spec/derivation.md.
	 */
	const byName = new Set<string>();
	/**
	 * The props whose expression awaits, by name.
	 *
	 * Read before the render's answer replaces the expression: the answer is the value, and the
	 * value is not a promise. What decides whether Svelte wraps this tag in a `child_block` is the
	 * expression the source held. See `waitsOn()`.
	 */
	const awaits = new Set<string>();
	/** The props the call site binds, whose value the child may send back. See below. */
	const boundProps = new Set<string>();
	/** A binding's getter, kept until every attribute and spread has been placed. See below. */
	const delayed: [string, string][] = [];
	/** Each binding's getter expanded with nothing settled, by prop. See `unsettled` below. */
	const unsettled = new Map<string, string>();
	/** The name each binding's getter is written as, which is what its setter assigns to. */
	const boundTo = new Map<string, string>();
	// The props whose caller expression varies with nothing the request decides. The render is
	// handed these as written, so the child's script gets what Svelte's own render would give it:
	// a query client to set as context, a store, a function -- values that are not data and could
	// not be told as JSON, and that a child's markup never writes but its script may need whole.
	const inertProps = new Set<string>();
	// The call site's attributes and spreads in the order `$.spread_props` merges them, kept where
	// a spread's keys cannot be listed: a name for an attribute or a listed key, an expression for
	// a spread whose keys are the request's. See `merged()`.
	const order: ({ name: string } | { spread: string; at: [number, number] | null })[] = [];
	/** A spread whose keys were listed into props, and the object it was written as. */
	const listed: {
		at: [number, number] | null;
		grown: string;
		entries: [key: string, value: string][];
	}[] = [];
	for (const one of attributes) {
		// An attachment is in the props and nothing on the server calls it.
		if (isNode(one) && one['type'] === 'AttachTag') continue;
		// `{...props}` is `$.spread_props`, the props merged in order, and a call site knows the
		// keys exactly when the object is written out -- which a rest gathered from a caller's own
		// attributes is, once expanded. Then it is so many props. An object the request hands over
		// whole has keys nobody can list, but the child's declaration lists which it reads, and each
		// of those is the value the merge leaves for it; the rest is the merge without them. Both
		// are decided once the child is read, below.
		if (isNode(one) && one['type'] === 'SpreadAttribute') {
			const grown = walk.expand(one['expression']);
			const entries = objectEntries(grown);
			if (entries === null) {
				// Evaluated once, as `$.spread_props` evaluates it: merged below, the object is read once
				// per prop the child declares, and a call in it -- one that changes the script, above
				// all -- would run as many times. Held where it is the request's and calls something.
				const whole = `(${grown})`;
				const once =
					/[\w$)\]]\s*\(/.test(grown) && varies(whole, walk)
						? `$$hold(${String(kept(whole, walk))})`
						: whole;
				order.push({ spread: once, at: span(one) });
				continue;
			}
			// Its keys are so many props now, and the object is dead at the call site like any other
			// value handed to a child this walk enters. See below, where the call site is cleared.
			listed.push({ at: span(one), grown, entries });
			for (const [key, value] of entries) {
				bindings.set(key, key.startsWith('on') && key.length > 2 ? 'null' : `(${value})`);
				order.push({ name: key });
			}
			continue;
		}
		// A `bind:` on a component, left as written by `unbind.ts` because it is a getter and a
		// setter rather than an attribute. The getter is what the child is given, and is read the
		// way the attribute would have been; the setter is what `bound` is collected for, checked
		// against the child's own declaration once that is in hand below.
		// Not a prop: `let:` names what the component supplies to a slot, which `hands()` read off
		// the tag when it grouped the caller's markup. `build_inline_component` puts it in the slot
		// function's parameter and passes nothing for it.
		if (isNode(one) && one['type'] === 'LetDirective') continue;
		// An event listener on a component is not a prop either, and the server does nothing with
		// it: `build_inline_component`'s loop has an arm for a `let:`, a spread, an attribute, a
		// `bind:` and an attachment, and nothing else -- an `OnDirective` falls past all of them
		// and contributes no property. Leaving the walk out of the child over one was silent, and
		// it is the ordinary way a legacy component is listened to: `<Todo {todo} on:click={...} />`
		// handed the child a marker where its prop was.
		if (isNode(one) && one['type'] === 'OnDirective') continue;
		if (isNode(one) && one['type'] === 'BindDirective') {
			const name = typeof one['name'] === 'string' ? one['name'] : '';
			boundProps.add(name);
			// Held back rather than placed here. `shared/component.js` pushes a binding's getter and
			// setter with `push_prop(..., true)`, whose comment says why: "Delay prop pushes so
			// bindings come at the end, to avoid spreads overwriting them." So a spread written
			// after a binding does not win, and both the merge order and the map have to say so.
			delayed.push([name, `(${handed(one, walk.expand)})`]);
			// And the getter with nothing settled, which is what the loop's first pass hands the
			// child: the props of the run a bound prop the child's script changes is held under.
			// See spec/derivation.md, "A hold may name the child's chain, and that is how a value
			// crosses back up".
			unsettled.set(
				name,
				`(${handed(one, (node, extra) => walk.expand(node, extra, NOTHING_SENT))})`,
			);
			// The name as written, which is what the setter assigns to. The expansion beside it is
			// the value it holds now; the two are different things and `settles` needs both.
			const where = span(getterOf(one));
			if (where !== null) boundTo.set(name, walk.source.slice(where[0], where[1]));
			continue;
		}
		if (!isNode(one) || one['type'] !== 'Attribute') return false;
		const name = typeof one['name'] === 'string' ? one['name'] : '';
		order.push({ name });
		const value = one['value'];
		if (name.startsWith('on') && name.length > 2) {
			bindings.set(name, 'null');
			continue;
		}
		if (value === true) {
			bindings.set(name, 'true');
			continue;
		}
		const parts = Array.isArray(value) ? value : [value];
		if (parts.every((part) => isNode(part) && part['type'] === 'Text')) {
			bindings.set(name, JSON.stringify(parts.map((part) => String(part['data'] ?? '')).join('')));
			continue;
		}
		const [only] = parts;
		// Text and an expression together, which `build_attribute_value` writes as a template: the
		// text goes in raw -- for a component it is not escaped -- and each expression that is not
		// statically known goes in through `$.stringify`, which is `typeof v === 'string' ? v : v ==
		// null ? '' : v + ''`. A value the analysis proves a defined string skips the call, which
		// makes no difference to what comes out, so every one of them goes through it here.
		//
		// The whole component used to be left to the render over one of these, and that is what
		// `component-data-dynamic` was: `qux='this is a {compound} string'` beside
		// `baz='{40 + x}'`, and the second is a *number* -- `value.length === 1` returns the
		// expression itself, quotes or no quotes -- so the child got a string and printed one.
		if (
			parts.length > 1 &&
			parts.every(
				(part) => isNode(part) && (part['type'] === 'Text' || part['type'] === 'ExpressionTag'),
			)
		) {
			const pieces = parts.map((part) =>
				(part as AstNode)['type'] === 'Text'
					? templated(String((part as AstNode)['data'] ?? ''))
					: `\${$$stringify(${walk.expand((part as AstNode)['expression'])})}`,
			);
			const grown = `\`${pieces.join('')}\``;
			if (walk.site.payload !== null && !varies(grown, walk)) inertProps.add(name);
			bindings.set(name, grown);
			continue;
		}
		if (parts.length !== 1 || !isNode(only) || only['type'] !== 'ExpressionTag') return false;
		if (isNode(only['expression']) && only['expression']['type'] === 'Identifier') byName.add(name);
		const grown = walk.expand(only['expression']);
		const written = `(${grown})`;
		if (walk.site.payload !== null && !varies(grown, walk)) inertProps.add(name);
		// A prop the request does not decide is bound to what the render computes for it rather
		// than to its expansion, where the render can say: the caller's script runs whole in the
		// render, so `const u = new URL(x); u.searchParams.set('q', y)` holds the query there and
		// the expansion of `u` does not. The render is asked, as it is asked for an each's source,
		// and answers with JSON where the value is data; anything else stays the expansion.
		// A literal is its own value and is not asked for; one no render could answer is not asked
		// again.
		if (
			walk.site.payload !== null &&
			walk.asking !== true &&
			!constant(grown) &&
			!walk.site.mute.has(keyed(walk, written)) &&
			!varies(grown, walk)
		) {
			const held = walk.site.told.get(keyed(walk, written));
			if (held !== undefined) {
				if (awaiting(grown)) awaits.add(name);
				bindings.set(name, held);
				continue;
			}
			if (!walk.site.wants.some(([key]) => key === keyed(walk, written))) {
				walk.site.wants.push([
					keyed(walk, written),
					`(${asWritten(only['expression'], grown, walk)})`,
				]);
			}
		}
		bindings.set(name, written);
	}

	// Last, which is where Svelte pushes them.
	for (const [name, value] of delayed) {
		order.push({ name });
		bindings.set(name, value);
	}

	// The caller's imports its expressions read, which the child's copy has to import too. A
	// prop's expression is expanded in the caller's scope and substituted into the child's, so
	// the child's rendered source and its derivations both read names the caller bound:
	// `href={URLS.site}` handed down is `URLS` inside the child, and the child never imported it.
	// A copy resolves its relative imports from where its original sits, so the caller's
	// specifier is resolved against the caller and written relative to the child. A name the
	// child binds itself to the same module is its own; to another is a collision that
	// JavaScript would not have had, and is said.
	const brought: Carried[] = [];
	const read = readsOf([
		...bindings.values(),
		...order.flatMap((part) => ('spread' in part ? [part.spread] : [])),
	]);
	for (const [local, one] of importedBy(walk.source)) {
		if (!read.has(local)) continue;
		if (!one.from.startsWith('.')) {
			brought.push(one);
			continue;
		}
		const target = resolvePath(dirname(walk.site.file), one.from);
		const moved = relative(dirname(file), target);
		brought.push({ ...one, from: moved.startsWith('.') ? moved : `./${moved}` });
	}

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

		// What the child sends back up, which is the half of a binding that is not an attribute.
		// `bind_props` in `internal/server` assigns a prop back to the caller where the caller
		// passed `undefined` and its props object has a setter for the key, and the caller then
		// renders again -- so a child's default becomes the caller's value. Only a default can do
		// it: a prop the child assigns after declaring is refused where it is declared, and one
		// with nothing to send stays `undefined`, which `bind_props` skips.
		//
		// Whether it fires is `initial_value === undefined`, which is the request's answer wherever
		// the bound expression is the request's: `<Foo bind:x/>` in a component whose own `x` is a
		// prop writes the child's default for a request that sent nothing and the request's value
		// for one that did.
		//
		// **Leaving it to the render does not give the settled bytes, which was measured.** Svelte's
		// own `do { ... } while (!$$settled)` runs there and `subsume` keeps the last pass, but the
		// caller's name is substituted from this pass's model rather than read back out of those
		// bytes: `let bar; <Widget bind:bar/> {bar}` wrote nothing where Svelte wrote the child's
		// `42`. Two samples, both silent.
		//
		// **What settles it is a value rather than a structure.** After the iteration the caller's
		// name holds `expr === undefined ? <what the child sends> : expr`, which is one ternary per
		// bound prop and no second render at all. What it waits on is where the rebinding goes:
		// Svelte renders the **whole** parent template again, so it holds for reads written above
		// the tag as well, and the walk meets the tag half way through. See spec/roadmap.md.
		// A readonly export travels too. `transform-server.js` passes `analysis.exports` to
		// `$.bind_props` beside the bindable props, so `export const x = 42` in the child reaches a
		// caller that binds `x` exactly as a prop's default would -- and it is not in `propsOf`,
		// which reads `$props()` and the two legacy spellings of a prop, and not these.
		// `{children}` rather than `{@render children()}`: the prop holds the function Svelte compiled
		// the caller's markup into, and an expression tag writes its value, so what lands in the
		// bytes is that function's own source -- `($$renderer) => { $$renderer.push(...) }`, escaped.
		// That is Svelte's compiled output written out as text, which nothing here can stand for:
		// the marker would have to be the source of a function this compiler never produces.
		if (
			nodes.length > 0 &&
			declares.some((one) => one.prop === 'children') &&
			reads(ahead, 'children')
		) {
			refuse(
				`<${tag} /> reads \`children\` as a value rather than rendering it, and Svelte writes ` +
					"the function it compiled the caller's markup into -- its own source, escaped, into " +
					'the bytes. Write `{@render children()}`. See spec/refusals.md',
			);
		}
		/**
		 * Whether the caller's markup can read a name while the bytes are written.
		 *
		 * `transform-server.js` wraps only `template.body` in `do { ... } while (!$$settled)`, so
		 * what a binding sends up changes the bytes only through a read in that template. A name it
		 * does not read is a second render writing what the first wrote -- `onMount(() => { snapshot
		 * = foo() })` beside `<Two bind:foo />` is that, the only mention being in a callback the
		 * server never runs.
		 *
		 * Conservative on the script: any declaration naming it counts, function bodies included,
		 * because a markup read of that declaration writes its initialiser out and the name goes
		 * with it. The `bind:` being settled is skipped by its own span.
		 */
		const readsIt = (local: string): boolean => {
			const ast = parsedComponent(walk.source);
			const skip = (Array.isArray(node['attributes']) ? node['attributes'] : [])
				.filter((one) => isNode(one) && one['type'] === 'BindDirective')
				.map((one) => span(one as AstNode))
				.filter((one) => one !== null);
			let found = false;
			readsIn(ast['fragment'], new Set(), (at) => {
				if (at['name'] !== local) return;
				const from = at['start'];
				if (typeof from === 'number' && skip.some(([a, b]) => from >= a && from < b)) return;
				found = true;
			});
			const instance = ast['instance'];
			const content = isNode(instance) ? instance['content'] : undefined;
			for (const statement of isNode(content) && Array.isArray(content['body'])
				? content['body']
				: []) {
				if (!isNode(statement) || statement['type'] !== 'VariableDeclaration') continue;
				readsIn(statement, new Set(), (at) => {
					if (at['name'] === local) found = true;
				});
			}
			return found;
		};

		/**
		 * Records what a binding settles the caller's name to, or returns false where it cannot.
		 *
		 * The value is the child's, so it has to be one the caller can hold without the child's
		 * scope: a literal. Anything else -- a call, a name the child declares -- is the child's to
		 * evaluate and there is nothing here to write. The caller's side has to be a plain name,
		 * because that is what the setter assigns to.
		 */
		const settles = (prop: string, value: string): boolean => {
			const held = delayed.find(([bound]) => bound === prop)?.[1];
			// A constant reads the same in the caller's scope as in the child's, and so does a hold,
			// which is resolved by its index rather than by any name. See `keptUnder`.
			if (held === undefined || !(constant(value) || value.startsWith('($$hold('))) return false;
			const local = boundTo.get(prop) ?? '';
			if (!IDENTIFIER.test(local)) return false;
			// Written inside a block, which child sends back is the block's answer, so the block's
			// own test goes inside the ternary. An each is not a branch and has no such test.
			const when = branchTest(walk);
			if (when === null) return false;

			// Svelte assigns up only where the caller's value is `undefined`, and the assignment is
			// monotone -- `undefined` becomes a value and never goes back -- so the settled read is
			// this and the loop is not something the artifact repeats. Among the bindings of one
			// name the first whose branch renders is the one that reaches it, which is what the
			// chain nests in source order.
			const key = keyed(walk, local);
			const chain = [...(walk.site.sending.get(key) ?? []), [when, value] as const];
			walk.site.sending.set(
				key,
				chain.map(([a, b]) => [a, b]),
			);
			const nested = chain.reduceRight(
				(rest, [test, held]) =>
					test === 'true' ? `(${held})` : `((${test}) ? (${held}) : ${rest})`,
				'undefined',
			);
			walk.site.sends.set(key, `(${held} === undefined ? ${nested} : ${held})`);
			return true;
		};
		/**
		 * Whether the child's default can travel at all, which `bind_props` decides on the caller's
		 * value and which the render is the one to hold.
		 *
		 * `bind_props` assigns up only where the caller's value is `undefined`, so a caller binding
		 * something that is not is a binding that sends nothing and leaves nothing to settle.
		 * Whether it is `undefined` is the request's answer wherever the caller binds one of its own
		 * props, and the render's wherever it does not: `<Input bind:value={$value.value} />` over a
		 * store this file makes is `''`, and the loop settles on its first pass with nothing moved.
		 *
		 * Asked as the author wrote it, because the expansion of a store read names helpers the
		 * render has not got. Told nothing yet it answers no, so that the pass which collects the
		 * ask reaches the render that answers it -- the skeleton of that pass is thrown away, and
		 * the walk runs again told, the way it already does for a block's test.
		 */
		const travels = (prop: string): boolean => {
			const local = boundTo.get(prop);
			if (local === undefined || walk.site.payload === null) return true;
			const test = `(${local}) === undefined`;
			const key = keyed(walk, test);
			if (varies(test, walk, true) || walk.site.mute.has(key)) return true;
			const answer = walk.site.decided.get(key);
			if (answer !== undefined) return answer;
			if (!walk.site.asks.some(([one]) => one === key)) walk.site.asks.push([key, test]);
			return false;
		};

		for (const [name, value] of exportedValues(ahead, raw)) {
			if (!boundProps.has(name)) continue;
			// Already settled on an earlier pass, so the caller's reads hold the ternary and the
			// child can be entered like any other. By the name rather than by the pass: a binding
			// inside a block another binding opens is reached only once that one has settled, and a
			// whole-pass guard skipped it for ever.
			if (walk.sent.has(boundTo.get(name) ?? name)) continue;
			if (settles(name, value)) continue;
			// Nothing the child sends back reaches the bytes where the caller's template does not
			// read the name: the settling loop renders that template again and writes what it wrote.
			if (!readsIt(boundTo.get(name) ?? name)) continue;
			// And nothing travels where the caller's value is not `undefined`, which is the same
			// question the bindable half below asks and this half was not asking.
			// `runtime-runes/bindable-prop-and-export` is a child declaring `open` as a `$bindable()`
			// and exporting a function of that name, so `bind_props` is handed `{ open: is_open,
			// open }` and the duplicate key leaves the function -- and none of it moves, because the
			// caller binds a `$state(true)` of its own. See `travels`.
			if (!travels(name)) continue;
			refuse(
				`\`bind:${name}\` on <${tag}> is a binding the child sends back: \`${name}\` is a ` +
					'readonly export, which `bind_props` assigns up to the caller where the caller ' +
					'passed nothing, and the caller then renders again with it. See spec/refusals.md',
			);
		}
		for (const one of declares) {
			if (!boundProps.has(one.prop) || one.fallback === 'undefined') continue;
			// `bind_props` reads the child's `bindable_prop` bindings and its readonly exports, and
			// nothing else. In legacy mode every `export let` is one; in runes mode only a
			// `$bindable()` is, and Svelte's own comment beside the call says the rest have "no
			// effect in runes mode other than throwing an error". So a `bind:` on a runes prop with
			// a plain default sends nothing back and there is nothing here to refuse -- measured on
			// a child declaring `let { x = 42 } = $props()`, whose caller wrote nothing either side
			// of the tag where a bindable one writes 42.
			if (one.bindable !== true) continue;
			if (walk.sent.has(boundTo.get(one.prop) ?? one.prop)) continue;
			if (settles(one.prop, one.fallback)) continue;
			// Nothing travels where the caller's value is not `undefined`, and where the caller binds
			// something of its own the render is what knows. See `travels`.
			if (!travels(one.prop)) continue;
			refuse(
				`\`bind:${one.prop}\` on <${tag}> is a binding the child sends back: it declares ` +
					`\`${one.prop}\` with a default, and Svelte's server assigns that default up to the ` +
					'caller where the caller passed nothing, then renders the caller again with it. ' +
					'Whether that happens is decided by the value the request brings, which is a ' +
					'structure rather than a value. See spec/refusals.md',
			);
		}

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
