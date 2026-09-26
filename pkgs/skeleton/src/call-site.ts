/**
 * A call site, read before its child is entered: what the tag passes, which of the caller's
 * imports go with it, and what a binding on it sends back up. The parts `descend()` in descend.ts
 * is composed of. See spec/derivation.md.
 */
import { dirname, relative, resolve as resolvePath } from 'node:path';
import {
	type Carried,
	constant,
	importsOf as importedBy,
	readsOf,
	objectEntries,
	parsedComponent,
	reads as readsIn,
} from 'ast';
import { propsOf } from './compose.ts';
import { type AstNode, isNode, refuse, span } from './node.ts';
import { awaiting } from './awaits.ts';
import { branchTest, keyed } from './branches.ts';
import { IDENTIFIER } from './components.ts';
import { varies } from './dynamic.ts';
import { reads } from './selection.ts';
import type { Walk } from './walk-types.ts';
import {
	asWritten,
	exportedValues,
	getterOf,
	handed,
	kept,
	NOTHING_SENT,
	templated,
} from './written.ts';

/** The key `merged()` binds a child's rest under, which no attribute can be named. */
export const REST = '...';

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
export function standsIn(ast: AstNode, local: string | undefined): string {
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

/** What a call site passes its child, read off the tag's attributes and spreads. See `callSite`. */
export interface CallSite {
	/** What the call site passes, as expressions in the caller's own terms. */
	bindings: Map<string, string>;
	/** The props the caller wrote as a bare name, which is what a hold is asked about. */
	byName: Set<string>;
	/** The props whose expression awaits, by name. */
	awaits: Set<string>;
	/** The props the call site binds, whose value the child may send back. */
	boundProps: Set<string>;
	/** A binding's getter, kept until every attribute and spread has been placed. */
	delayed: [string, string][];
	/** Each binding's getter expanded with nothing settled, by prop. */
	unsettled: Map<string, string>;
	/** The name each binding's getter is written as, which is what its setter assigns to. */
	boundTo: Map<string, string>;
	/** The props whose caller expression varies with nothing the request decides. */
	inertProps: Set<string>;
	/** The attributes and spreads in the order `$.spread_props` merges them. */
	order: ({ name: string } | { spread: string; at: [number, number] | null })[];
	/** A spread whose keys were listed into props, and the object it was written as. */
	listed: { at: [number, number] | null; grown: string; entries: [key: string, value: string][] }[];
}

/**
 * What a tag passes the child it names, read once per call site: every attribute, spread and
 * binding in the order Svelte merges them, or null where an attribute is a shape this walk does
 * not read. Was the first third of `descend()`. See spec/derivation.md.
 */
export function callSite(node: AstNode, walk: Walk): CallSite | null {
	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
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
		if (!isNode(one) || one['type'] !== 'Attribute') return null;
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
		if (parts.length !== 1 || !isNode(only) || only['type'] !== 'ExpressionTag') return null;
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
	return {
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
	};
}

/**
 * The caller's imports the call site's expressions read, which the child's copy has to import too,
 * each written relative to the child. See `descend()`.
 */
export function carriedAcross(
	bindings: ReadonlyMap<string, string>,
	order: CallSite['order'],
	walk: Walk,
	file: string,
): Carried[] {
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
	return brought;
}

/**
 * What a binding on the tag sends back up, settled where it can be and refused where it cannot:
 * the caller's name becomes `expr === undefined ? <what the child sends> : expr`, one ternary
 * per bound prop. Was the middle of `descend()`. See spec/roadmap.md, "A component binding sends a
 * value back, and which value is a branch".
 */
export function settleBindings(given: {
	walk: Walk;
	node: AstNode;
	tag: string;
	nodes: readonly unknown[];
	ahead: AstNode;
	raw: string;
	declares: ReturnType<typeof propsOf> & object;
	delayed: readonly [string, string][];
	boundTo: ReadonlyMap<string, string>;
	boundProps: ReadonlySet<string>;
}): { settles: (prop: string, value: string) => boolean } {
	const { walk, node, tag, nodes, ahead, raw, declares, delayed, boundTo, boundProps } = given;
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
			(rest, [test, held]) => (test === 'true' ? `(${held})` : `((${test}) ? (${held}) : ${rest})`),
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
	return { settles };
}
