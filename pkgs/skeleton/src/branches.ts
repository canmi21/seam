/**
 * The choices a render decides: which branch of a block is written, how a test is settled
 * against what the build decided, what an each item stands for, and what has to hold for the
 * markup at a point to render at all. See spec/pipeline.md.
 */
import { basename, relative } from 'node:path';
import { apply, type Edit, literalOf, mentions, parsed, settle, unfolded } from 'ast';
import { type AstNode, isNode, refuse, span } from './node.ts';
import { waitsOn } from './awaits.ts';
import { componentImport, unimported, unwrapped } from './components.ts';
import { type Choice, type Copy, type Rewritten, Undecided, type Walk } from './walk-types.ts';

/**
 * The one edit a branch choice decides, written for this render and recorded for the others.
 *
 * Every consultation of `taken` goes through here, which is what makes the list of choices the
 * complete difference between one render's rewrite and another's. See `Choice`.
 */
export function chose(
	walk: Walk,
	edits: Edit[],
	from: number,
	to: number,
	block: number,
	branch: number,
	taken: string,
	untaken: string,
): Choice {
	const at = edits.length;
	edits.push([from, to, walk.taken(block, branch) ? taken : untaken]);
	const one: Choice = { edits, at, block, branch, taken, untaken };
	walk.site.choices.push(one);
	return one;
}

/**
 * A choice with both of its texts wrapped, for a caller that learns what wraps them afterwards.
 *
 * An `{#await}` whose body writes a head is the one of these: whether the block stands in the head
 * stream is known once its body has been walked, and what opens it goes around the expression the
 * choice already wrote. Wrapping both texts rather than the written one keeps the choice a choice.
 */
export function rewrapped(walk: Walk, one: Choice, wrap: (text: string) => string): void {
	one.taken = wrap(one.taken);
	one.untaken = wrap(one.untaken);
	const edit = one.edits[one.at];
	if (edit !== undefined) edit[2] = walk.taken(one.block, one.branch) ? one.taken : one.untaken;
}

/**
 * A choice whose taken text is replaced, for a `this` that turned out to name a copy.
 *
 * `descend()` points a tag it entered at the copy it took, which for a dynamic component is an
 * edit over the `this` expression -- the same characters a choice already owns. So the copy's name
 * goes into the choice rather than beside it, and the branch that renders nothing keeps its own
 * text. See `rename()` in compose.ts.
 */
export function rechose(walk: Walk, one: Choice, taken: string): void {
	one.taken = taken;
	const edit = one.edits[one.at];
	if (edit !== undefined) edit[2] = walk.taken(one.block, one.branch) ? one.taken : one.untaken;
}

/**
 * The same walk, re-materialised for a render that takes different branches.
 *
 * A walk is a list of edits against a source, and `taken` decides the text of a handful of them
 * and nothing else -- not which components are entered, not where a hole goes, not what a block is
 * numbered. So an alternate render needs the choices set the other way and the edits applied
 * again, which is a string splice per file rather than a walk of the route. On one route of press
 * that is 137 walks of a hundred components down to three. See `Choice`, and spec/build.md.
 */
export function rechosen(
	made: Rewritten,
	taken: (block: number, branch: number) => boolean,
): Rewritten {
	for (const one of made.choices) {
		const edit = one.edits[one.at];
		if (edit !== undefined) edit[2] = taken(one.block, one.branch) ? one.taken : one.untaken;
	}
	return {
		...made,
		rewritten: unimported(apply(made.source, made.edits)),
		// A copy of each copy rather than the copy: the walk this came from keeps its own bytes,
		// and the alternates are made from it one after another.
		copies: made.copies.map((copy) =>
			copy.inner.length === 0 ? copy : { ...copy, source: unimported(apply(copy.raw, copy.inner)) },
		),
	};
}

/**
 * The component an expression chooses, settled. A `?:` in it chooses which component, the way one
 * handed to a package chooses what is handed, and is enumerated the same way: the walk stops and
 * asks, and the build renders once per branch. A lookup in a table of components, and what is read
 * off either, is the same choice with its domain in the source -- unfolded by `settled`, which
 * every expression goes through. What the taken branch leaves has to be inert; one that still
 * reaches the request is a component chosen per request, which is not enumerable and is refused.
 */
/**
 * A component tag whose root an `{#each}` binds, written as the one component every item is.
 *
 * The body of an each is written once and every item renders those bytes, so a tag naming the item
 * is only expressible where the item is the same component throughout. The block's source is read
 * for that: a list the source writes out, whose elements all name one thing. Then the root is
 * written as that thing and the tag is Svelte's to render, which is where a member tag already goes
 * -- `2-analyze/visitors/Component.js` marks a tag with a `.` in it dynamic and the server writes
 * the anchors for it.
 *
 * True where it wrote the name, false where the caller should refuse. A list whose elements differ
 * is the false case and stays refused: the body would have to be written once per element, which is
 * the block unrolled and not the block.
 */
export function perItem(
	node: AstNode,
	tag: string,
	walk: Walk,
	edits: [number, number, string][],
): boolean {
	const [head] = tag.split('.');
	if (head === undefined) return false;
	const over = walk.items.get(head);
	if (over === undefined) return false;
	const listed = elements(over);
	if (listed === null || listed.length === 0) return false;
	const [only] = listed;
	if (only === undefined || !listed.every((one) => one === only)) return false;
	// A tag's name is a path of names and not an expression, so what goes in its place has to be one
	// too. `member_id` splits on `.` and builds the chain, which is the only shape it can build.
	const named = unwrapped(only);
	if (!PATH.test(named)) return false;
	// The block's source is a derivation like any other, and `carriedBy` carries no component: the
	// default export of a `.svelte` file is composed at compile time and is never a value an
	// expression calls. So a list of components written that way cannot be evaluated at all, and the
	// tag is not this pass's to answer. A named export of a component's module script is an ordinary
	// import and is carried, which is what `component-namespace` writes.
	const [root] = named.split('.');
	if (root === undefined || componentImport(root, walk)) return false;
	const at = span(node);
	const name = typeof node['name'] === 'string' ? node['name'] : '';
	if (at === null || name === '' || !walk.source.startsWith(`<${name}`, at[0])) return false;
	edits.push([at[0] + 1, at[0] + 1 + head.length, named]);
	const closing = `</${name}>`;
	if (walk.source.endsWith(closing, at[1])) {
		const from = at[1] - closing.length + 2;
		edits.push([from, from + head.length, named]);
	}
	return true;
}

/** A tag's name: `member_id` splits it on `.` and builds the chain, so it is a path of names. */
const PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

/** The elements of an array literal, as source, or null where the expression is not one. */
export function elements(expression: string): string[] | null {
	let ast: Node;
	try {
		ast = parsed(expression) as unknown as Node;
	} catch {
		return null;
	}
	const fragment = (ast as unknown as AstNode)['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const [tag] = nodes;
	if (nodes.length !== 1 || !isNode(tag) || tag['type'] !== 'ExpressionTag') return null;
	// `parsed` wraps the expression in a component -- `{<expression>}` in its markup -- so an offset
	// in the tree is an offset in that wrapper. Just past the tag's own `{` is the expression's
	// offset zero, which the expression node is not: a parenthesised one may or may not survive as a
	// node of its own, and its start is then past the paren.
	const base = (span(tag)?.[0] ?? -1) + 1;
	if (base === 0) return null;
	let held: unknown = tag['expression'];
	while (isNode(held) && held['type'] === 'ParenthesizedExpression') held = held['expression'];
	if (!isNode(held) || held['type'] !== 'ArrayExpression') return null;
	const found: string[] = [];
	for (const one of Array.isArray(held['elements']) ? held['elements'] : []) {
		const where = span(one);
		if (where === null) return null;
		found.push(`(${expression.slice(where[0] - base, where[1] - base)})`);
	}
	return found;
}

/**
 * Whether a test is decided by the source itself, before anything is rendered or asked.
 *
 * A test the request does not decide is answered by the render: the walk asks, and the pass after
 * it is told. One the substitution has already turned into a constant is not a question at all.
 * `{#if show}` over `let show = $state(false)` is `{#if false}` by the time the walk reads it, and
 * the branch is bytes nobody writes.
 *
 * **Asking the render instead put the walk inside that branch.** Svelte compiles a dead branch and
 * never runs it; this walk goes into every branch whatever `taken` says, which is what makes a
 * block re-materialisable per render -- so the render made to answer the question evaluated what
 * the source never evaluates. `<NonExistent />` under `{#if false}` and `object.boolean` under
 * `{#if object}` over a `$state()` holding nothing both threw there, and the sample was reported
 * as a crash in this compiler. See spec/derivation.md.
 */
export function constantly(test: string): boolean | undefined {
	const held = literalOf(test);
	if (held !== undefined) return Boolean(JSON.parse(held) as unknown);
	// `undefined` is an identifier and not a literal, and it is what a rune with no argument holds:
	// `3-transform/server/visitors/VariableDeclaration.js` writes `args[0] ?? void 0` for every
	// rune but the three that fall through to the CallExpression visitor.
	return unwrapped(test) === 'undefined' ? false : undefined;
}

/**
 * Which branch of a chain the answers decide, or null where they do not decide one yet.
 *
 * A chain is tests Svelte evaluates in order until one is true, so it is decided as soon as every
 * test up to and including the first that is not false has an answer: the rest are never reached
 * and their answers cannot change the branch. Requiring all of them was what kept
 * `{#if $foo}blah{:else if bar()}` waiting on a test its own first branch makes unreachable.
 *
 * `-1` for the else, which is the branch number Svelte writes into the marker that opens it.
 */
export function reached(answers: readonly (boolean | undefined)[]): number | null {
	const at = answers.findIndex((one) => one !== false);
	if (at === -1) return -1;
	return answers[at] === true ? at : null;
}

/**
 * A block whose branch is known: the tests written out as constants, and only that branch walked.
 *
 * The block stays in the source, so Svelte writes the anchors it would have written either way --
 * what is decided here is which branch is inside them, not whether there is a block.
 */
export function oneBranch(
	walk: Walk,
	chain: readonly AstNode[],
	/** Each test as the walk settled it, which is where an `await` shows. See `waitsOn()`. */
	tests: readonly string[],
	chosen: number,
	otherwise: unknown,
	edits: Edit[],
	step: (child: unknown) => void,
): void {
	for (const [branch, one] of chain.entries()) {
		const at = span(one['test']);
		const held = tests[branch] ?? '';
		if (at !== null) {
			edits.push([
				at[0],
				at[1],
				waitsOn(one['test'], held, branch === chosen ? 'true' : 'false', walk),
			]);
		}
		if (branch !== chosen) buried(walk, one['consequent']);
		// A test after the one that answered is never evaluated: the chain stops at the first true.
		// One before it was evaluated and its names have to resolve, so only the later ones go --
		// `{#if $foo}blah{:else if bar()}` over a store holding `true` is that, and `bar` is a name
		// upstream's own sample never binds.
		if (chosen >= 0 && branch > chosen && at !== null) dies(walk, at);
	}
	if (chosen >= 0) step(chain[chosen]?.['consequent']);
	else if (isNode(otherwise)) step(otherwise);
	if (chosen >= 0) buried(walk, otherwise);
}

/** What a fragment's own nodes cover, a fragment carrying no span of its own. */
export function spanOfFragment(fragment: unknown): [number, number] | null {
	if (!isNode(fragment) || !Array.isArray(fragment['nodes'])) return null;
	const spans = fragment['nodes'].map((one) => span(one)).filter((one) => one !== null);
	const [first] = spans;
	const last = spans[spans.length - 1];
	return first === undefined || last === undefined ? null : [first[0], last[1]];
}

/** A fragment nothing renders, recorded by the span its own nodes cover. */
export function buried(walk: Walk, fragment: unknown): void {
	if (!isNode(fragment)) return;
	const nodes = Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const spans = nodes.map((one) => span(one)).filter((one) => one !== null);
	const [first] = spans;
	const last = spans[spans.length - 1];
	if (first === undefined || last === undefined) return;
	dies(walk, [first[0], last[1]]);
}

/** One span of this file's source that no request reaches. See `Walk.dead`. */
function dies(walk: Walk, at: [number, number]): void {
	const key = relative(walk.site.root, walk.site.file);
	const held = walk.dead.get(key);
	if (held === undefined) walk.dead.set(key, [at]);
	else held.push(at);
}

export function settled(expression: string, walk: Walk): string {
	// Unfolded first, because a choice the source holds the domain of is not written as a `?:` at
	// the top of the expression: a table lookup is a member access, and a read off a ternary is
	// one too. `settle` looks for a ternary and would find neither, so the domain that was in the
	// source goes unseen -- and what is left reaches components in a derivation, which is a value
	// asked for per request and has nowhere to get them. See `unfolded`.
	const held = settle(
		unfolded(expression) ?? expression,
		walk.site.decided,
		walk.dynamic,
		new Set(walk.fresh),
	);
	if (held.undecided === null) return held.text;
	// A name a block binds is decided per item, and a decision over it cannot be enumerated for
	// the page: the derivation the branch would test has no item to read.
	// A name the request decides that is neither the payload's nor a fresh one is a block's --
	// unless the script's run answers it: `$: component = ...` over a prop is moved by the
	// request and is one value for the page, not one per item. See `runChosen`.
	const scoped = new Set(
		[...walk.dynamic].filter(
			(one) =>
				walk.site.payload?.has(one) !== true &&
				!walk.fresh.includes(one) &&
				!walk.site.moved.has(one),
		),
	);
	if (mentions(held.undecided, scoped)) {
		refuse(
			`\`${held.undecided}\` chooses between things a marker cannot stand for and reads a name ` +
				'an each block binds, so the choice is made per item and cannot be enumerated for the ' +
				'page. Write it as an `{#if}` around the markup, which is a block and is taken per item',
		);
	}
	throw new Undecided(held.undecided);
}

/** The node an expression reduces to: a taken branch, a read off an object literal, or itself. */
export function folded(node: unknown): unknown {
	if (!isNode(node)) return null;
	const type = node['type'];
	if (type === 'ConditionalExpression') {
		const test = node['test'];
		if (!isNode(test) || test['type'] !== 'Literal') return null;
		return folded(node[test['value'] === true || test['value'] ? 'consequent' : 'alternate']);
	}
	if (type !== 'MemberExpression') return node;
	const object = folded(node['object']);
	if (!isNode(object) || object['type'] !== 'ObjectExpression') return null;
	const property = node['property'];
	const wanted = !isNode(property)
		? null
		: node['computed'] === true
			? property['type'] === 'Literal'
				? String(property['value'])
				: null
			: typeof property['name'] === 'string'
				? property['name']
				: null;
	if (wanted === null) return null;
	for (const each of Array.isArray(object['properties']) ? object['properties'] : []) {
		if (!isNode(each) || each['type'] !== 'Property' || each['computed'] === true) continue;
		const key = each['key'];
		if (!isNode(key)) continue;
		const named =
			key['type'] === 'Literal'
				? String(key['value'])
				: typeof key['name'] === 'string'
					? key['name']
					: null;
		if (named === wanted) return folded(each['value']);
	}
	return null;
}

/** The runes, which exist at compile time and nowhere else. */
export const RUNE = /(?:^|[^\w$.])\$(?:state|derived|props|effect|bindable|inspect|host)\b/;

/**
 * The names an expression may read whose value this walk does not hold: what the request
 * decides, and what a component supplies to a snippet it was passed, which is decided by the
 * component. Neither can be written out for the render to evaluate.
 */
export function unknown(walk: Walk): ReadonlySet<string> {
	// `$x` reads the store `x`, so a subscription to one the request brings is one of these: what
	// `store_get` is handed decides the value, and this walk does not hold it. Without the pair the
	// read looked like a name of its own that nothing decided, so it was written out for the render
	// -- which has no store there and wrote nothing. See `stands`, which refuses it.
	const subscribed = [...walk.dynamic].map((one) => `$${one}`);
	if (walk.handed === undefined || walk.handed.size === 0) {
		return new Set([...walk.dynamic, ...subscribed]);
	}
	return new Set([...walk.dynamic, ...subscribed, ...walk.handed]);
}

/**
 * What has to hold for the markup at this point in the walk to render at all, as one expression.
 *
 * `IfBlock.js` emits one `if`/`else if`/`else` over `metadata.flattened`, so a branch renders
 * exactly where its own test is true and every test before it was false, and the else where all of
 * them were false. Nested blocks are the conjunction of their branches.
 *
 * **An `{#each}` is not one of these and returns nothing.** What it encloses renders once per item,
 * so what a binding inside it settles is a per-item answer, and the name it settles is read once
 * for the page.
 *
 * **Only the blocks of this file.** A copy inherits the blocks its tag sits in, and a block
 * enclosing the whole copy encloses the name the binding settles as well: the file renders once
 * per item with its name and its binding together, so nothing about it is a per-item answer to a
 * page-level read. `runtime-legacy/binding-backflow` is six `<Parent>`s in an each, each binding
 * a child inside itself.
 */
export function branchTest(walk: Walk): string | null {
	const parts: string[] = [];
	const enclosing = walk.site.copy?.within?.length ?? 0;
	for (const [index, branch] of walk.within.slice(enclosing)) {
		const block = walk.blocks[index];
		if (block === undefined || block.kind !== 'if') return null;
		const tests = walk.site.tested.get(index) ?? block.tests ?? [];
		for (const one of branch === -1 ? tests : tests.slice(0, Math.max(branch, 0))) {
			parts.push(`!(${one})`);
		}
		if (branch >= 0) {
			const own = tests[branch];
			if (own === undefined) return null;
			parts.push(`(${own})`);
		}
	}
	return parts.length === 0 ? 'true' : parts.join(' && ');
}

/**
 * The key an ask or a want is filed under, which has to name the copy as well as the expression.
 *
 * A copy per call site means two copies of one component write the same expansion: `{#if
 * $selectedPanel === panel}` in two `<TabPanel>`s expands to one string in both, and the second's
 * answer overwrote the first's in the object the render fills. Measured on
 * `runtime-legacy/context-api`, with the `class:` refusal that hides it taken off: one panel took
 * its branch and two took neither, where Svelte takes the first. The entry has no copy of its own
 * and keeps the bare expression, so nothing about it moves.
 */
export function keyed(walk: Walk, expression: string): string {
	const copy = walk.site.copy;
	return copy === undefined || copy === null ? expression : `${basename(copy.at)}#${expression}`;
}

/**
 * One file's view of the settled names: the entries `keyed()` filed under this copy, by the bare
 * local, and none of the others'. A caller's `value` and its child's `value` are two names, and
 * the one the caller's binding settles must not be read inside the child, where it shadowed the
 * child's own prop. See `Site.sends`.
 */
export function sentFor(
	all: ReadonlyMap<string, string>,
	copy: Copy | null | undefined,
): ReadonlyMap<string, string> {
	const prefix = copy === undefined || copy === null ? '' : `${basename(copy.at)}#`;
	const own = new Map<string, string>();
	for (const [key, value] of all) {
		if (prefix === '') {
			if (!key.includes('#')) own.set(key, value);
		} else if (key.startsWith(prefix)) {
			own.set(key.slice(prefix.length), value);
		}
	}
	return own;
}
