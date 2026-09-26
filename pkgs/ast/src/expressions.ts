/**
 * One expression at a time: parsed once and memoised, unfolded where a ternary or a table chose
 * between things, settled against what the build decided, and asked what it mentions, what path
 * it is and whether it is constant. See spec/derivation.md.
 */
import { parse } from 'svelte/compiler';
import { apply } from './edits.ts';
import { INIT, isNode, type Node, reads, WRAPS } from './scope.ts';

/**
 * One expression, parsed as the component it would be the whole of.
 *
 * The empty script is what makes TypeScript readable. An expression in the markup of a
 * `lang="ts"` component may carry an annotation or an `as`, and Svelte chooses its parser from the
 * script tag rather than from the expression -- so without one, `(q: { s: string }) => q.s` is a
 * syntax error. That was not a parse failure anyone saw: `mentions` reads a failure as "assume it
 * reaches the payload", which is the safe answer and the wrong one here, and a value that was the
 * same every request got a marker planted in it and was handed to a package as a string.
 */
export function parsed(expression: string): Node {
	if (process.env['SEAM_NO_MEMO'] !== undefined) {
		return parse(`<script lang="ts"></script>{${expression}}`, { modern: true }) as unknown as Node;
	}
	const held = trees.get(expression);
	if (held !== undefined) {
		if (held instanceof Error) throw held;
		return held;
	}
	try {
		const tree = parse(`<script lang="ts"></script>{${expression}}`, {
			modern: true,
		}) as unknown as Node;
		trees.set(expression, tree);
		return tree;
	} catch (error) {
		// The failure is cached too, because the callers all catch one and an expression that does
		// not parse is asked about as often as one that does.
		trees.set(expression, error as Error);
		throw error;
	}
}

/**
 * Every expression this process has parsed, by its source.
 *
 * Parsing is where a compile spent its time: measured on one real application, the walk was 88% of
 * a 425-second compile, and a walk asks these questions of every expression it meets -- what it
 * reads, whether it mentions the payload, what path it is. The walk runs once per render and a
 * route renders hundreds of times, so one expression was parsed hundreds of times into the same
 * tree. Svelte's parser builds a whole component AST for each one, since an expression is read as
 * the component it would be the whole of.
 *
 * The tree is handed out shared, which is sound because every caller here only reads it -- none
 * writes to a node. The map is bounded by the number of distinct expressions a compile produces,
 * not by the number of walks, which is the whole point. See spec/build.md.
 */
export const trees = new Map<string, Node | Error>();

/**
 * A whole component, parsed, by its source.
 *
 * **Not memoised, and that is the measurement rather than an omission.** Remembering these was
 * tried, on the reading that a walk parses the entry and everything it enters once per render and
 * so parses a route's hundred components fifty thousand times. It bought twelve seconds of a
 * two-hundred-and-thirty-second walk -- five per cent -- and held three hundred and eighty-one
 * whole-component trees, which measured as the larger part of three gigabytes of live heap. A
 * compile that cannot run in CI is worse than one that takes five per cent longer, so the trade is
 * refused here and taken one level down, where an expression's tree is small and the saving is
 * forty per cent. See spec/build.md.
 */
export function parsedComponent(source: string): Node {
	return parse(source, { modern: true }) as unknown as Node;
}

/**
 * A lookup in an object literal, `({ a: A, b: B })[key]`, written as the choice it is:
 * `(key) === "a" ? (A) : (key) === "b" ? (B) : undefined`.
 *
 * The keys of a literal are in the source, so a component chosen through such a table is chosen
 * from a domain the compiler can read, and the chain is a structural ternary like any other: each
 * test varies with the request and each branch names a component, so `settle` enumerates it as
 * the tree it is, and a key the table lacks is the `undefined` that `<svelte:component>` writes
 * nothing for. Null where the expression is not that shape, or where a key is not a name or a
 * string -- a number compares to a string key as the author's lookup would not.
 */
/**
 * The entries of an object literal, as the source of each key and value, or null where the
 * expression is not one written out in full: a spread inside it, a computed key, a getter.
 *
 * What a `{...props}` on a component call site spreads is a set of keys, and a call site knows
 * them exactly when the object is written out -- which is what a rest gathered from a caller's
 * attributes expands to. Then the spread is so many props, and the walk can enter the child.
 */
export function objectEntries(expression: string): [key: string, value: string][] | null {
	const wrapped = `<script lang="ts"></script>{${expression}}`;
	let ast: Node;
	try {
		ast = parse(wrapped, { modern: true }) as unknown as Node;
	} catch {
		return null;
	}
	const fragment = ast['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const tag = nodes.find((one) => isNode(one) && one['type'] === 'ExpressionTag');
	const node = isNode(tag) ? tag['expression'] : undefined;
	if (!isNode(node) || node['type'] !== 'ObjectExpression') return null;
	const found: [string, string][] = [];
	for (const one of Array.isArray(node['properties']) ? node['properties'] : []) {
		if (!isNode(one) || one['type'] !== 'Property' || one['computed'] === true) return null;
		if (one['kind'] !== 'init') return null;
		const key = one['key'];
		const value = one['value'];
		if (!isNode(key) || !isNode(value)) return null;
		let name: string;
		if (key['type'] === 'Identifier' && typeof key['name'] === 'string') name = key['name'];
		else if (key['type'] === 'Literal' && typeof key['value'] === 'string') name = key['value'];
		else return null;
		const { start, end } = value;
		if (typeof start !== 'number' || typeof end !== 'number') return null;
		found.push([name, wrapped.slice(start, end)]);
	}
	return found;
}

/**
 * An expression with the TypeScript written around it taken off.
 *
 * `{ a: Ay } as const` is a `TSAsExpression` holding the object, and `k as keyof typeof T` is one
 * holding the name. Neither changes what the expression is at runtime, and reading the wrapper as
 * the thing made a table that press writes `as const` look like no table at all -- so the domain
 * its keys hold went unseen and the choice was refused as one nobody could enumerate.
 */
export function bare(node: unknown): Node | null {
	let found = node;
	while (isNode(found) && typeof found['type'] === 'string' && WRAPS.has(found['type'])) {
		found = found['expression'];
	}
	return isNode(found) ? found : null;
}

/**
 * Where a node sits in the expression it was parsed from, with the wrapper's offset taken off.
 */
function spanOf(node: Node): [number, number] | null {
	const { start, end } = node;
	return typeof start === 'number' && typeof end === 'number'
		? [start - WRAPPED, end - WRAPPED]
		: null;
}

/**
 * What an expression reads off whatever it is read from, and the thing underneath.
 *
 * `short` is whether the first access away from that thing short-circuits, which decides the value
 * where there is nothing to read from: `a?.b.c` is undefined where `a` is, and `a.b?.c` throws.
 *
 * The accesses are rebuilt from the tree rather than sliced out of the source, because the source
 * may put what they are read from in parentheses of its own -- `(T[k])?.icon` -- and a slice taken
 * from where that ends would carry the closing one with it.
 */
function peel(whole: Node): { node: Node; read: string; short: boolean } {
	let node: Node = whole;
	const reads: { name: string; optional: boolean }[] = [];
	for (;;) {
		if (node['type'] !== 'MemberExpression' || node['computed'] === true) break;
		const named = node['property'];
		const inner = bare(node['object']);
		if (!isNode(named) || named['type'] !== 'Identifier' || typeof named['name'] !== 'string')
			break;
		if (inner === null) break;
		reads.unshift({ name: named['name'], optional: node['optional'] === true });
		node = inner;
	}
	const read = reads.map((one) => `${one.optional ? '?.' : '.'}${one.name}`).join('');
	return { node, read, short: reads[0]?.optional === true };
}

/**
 * A `?:` with what is read off it pushed into both branches, or null where that is not what it is.
 *
 * **A read off a choice is part of the choice.** `(summary ? T[summary.provider] : undefined)?.icon`
 * picks a component, and until the read is inside the branches the expression is a member access
 * over a ternary rather than a ternary -- so `settle` looks at a value where a choice is written
 * and nothing asks the render which branch is taken. Distributing it is exact: the test is
 * evaluated once either way, and each branch keeps whatever the read would have done to it.
 */
function distributed(whole: Node, source: string): string | null {
	const { node, read } = peel(whole);
	if (read === '' || node['type'] !== 'ConditionalExpression') return null;
	const slice = (part: unknown): string | null => {
		if (!isNode(part)) return null;
		const at = spanOf(part);
		return at === null ? null : source.slice(at[0], at[1]);
	};
	const test = slice(node['test']);
	const yes = slice(node['consequent']);
	const no = slice(node['alternate']);
	if (test === null || yes === null || no === null) return null;
	return `((${test}) ? (${yes})${read} : (${no})${read})`;
}

/**
 * A lookup in a table of components, as the chain of `?:` it is, or null where it is not one.
 *
 * `T[k]` with `T` an object literal chooses among the table's own keys, so its domain is in the
 * source and the choice is enumerable: it is written out as `k === "a" ? (Ay) : k === "b" ? (Bee)
 * : undefined`, and settled the way any structural ternary is.
 *
 * **What is read off the entry is part of the lookup.** `T[k].icon` and `T[k]?.icon` pick a
 * component out of an entry holding more than one thing, which is what a table of icons beside
 * their names is; the access goes into each arm and the domain is still the table's keys.
 *
 * The arm for a key the table lacks keeps whatever the access would have done to `undefined`: an
 * optional one short-circuits and is `undefined`, and a plain one throws, which is what the
 * expression as written does and is not this function's to soften.
 */
function tabled(whole: Node, source: string): string | null {
	const { node, read, short } = peel(whole);
	if (node['type'] !== 'MemberExpression' || node['computed'] !== true) return null;
	const object = bare(node['object']);
	const property = bare(node['property']);
	if (object === null || object['type'] !== 'ObjectExpression' || property === null) return null;
	const slice = (part: Node): string | null => {
		const at = spanOf(part);
		return at === null ? null : source.slice(at[0], at[1]);
	};
	const key = slice(property);
	if (key === null) return null;
	const arms: string[] = [];
	for (const one of Array.isArray(object['properties']) ? object['properties'] : []) {
		if (!isNode(one) || one['type'] !== 'Property' || one['computed'] === true) return null;
		if (one['kind'] !== 'init') return null;
		const name = one['key'];
		const value = one['value'];
		if (!isNode(name) || !isNode(value)) return null;
		let text: string;
		if (name['type'] === 'Identifier' && typeof name['name'] === 'string') text = name['name'];
		else if (name['type'] === 'Literal' && typeof name['value'] === 'string') text = name['value'];
		else return null;
		const chosen = slice(value);
		if (chosen === null) return null;
		arms.push(`(${key}) === ${JSON.stringify(text)} ? (${chosen})${read}`);
	}
	if (arms.length === 0) return null;
	const missing = read === '' || short ? 'undefined' : `(undefined)${read}`;
	return `(${arms.join(' : ')} : ${missing})`;
}

/** What is being called, where a rewrite of it would take the call away from its receiver. */
const CALLED: Readonly<Record<string, string>> = {
	CallExpression: 'callee',
	NewExpression: 'callee',
	TaggedTemplateExpression: 'tag',
};

/**
 * The first choice written anywhere in an expression, as where it sits and what it becomes.
 *
 * **Anywhere, not at the top.** A guard is written `{#if Icon && provider}`, and the choice is
 * inside one side of the `&&`; read only at the top, the expression is a logical operator and
 * nothing looks further. Outermost first, so the rewrite is the largest one available there.
 *
 * **Never what is being called.** Both rewrites move a read off the thing it is read from, and a
 * read that is then called is a method: `(a ?? []).slice(5)` and `(a === undefined ? [].slice :
 * a.slice)(5)` are not the same call, because the second has lost what it was called on. So the
 * callee itself is passed over, and what is inside it is not -- a choice deeper in stays attached
 * to whatever it becomes. press's article found this, its footnotes calling `slice` on a default.
 */
function choiceIn(text: string): { at: [number, number]; text: string } | null {
	let ast: Node;
	try {
		ast = parsed(text);
	} catch {
		return null;
	}
	let found: { at: [number, number]; text: string } | null = null;
	const visit = (node: unknown, called: boolean): void => {
		if (found !== null) return;
		if (Array.isArray(node)) {
			for (const one of node) visit(one, false);
			return;
		}
		if (!isNode(node)) return;
		// A chain and what it holds cover the same characters, so either span replaces both.
		const whole = bare(node['type'] === 'ChainExpression' ? node['expression'] : node);
		const at = spanOf(node);
		if (!called && whole !== null && at !== null) {
			const rewritten = tabled(whole, text) ?? distributed(whole, text);
			if (rewritten !== null) {
				found = { at, text: rewritten };
				return;
			}
		}
		const receiver = typeof node['type'] === 'string' ? CALLED[node['type']] : undefined;
		for (const [name, one] of Object.entries(node)) visit(one, name === receiver);
	};
	visit(ast['fragment'], false);
	return found;
}

/**
 * How many rewrites one expression is given before it is left as written, which is a bound on a
 * loop rather than a limit anybody should meet: press's article takes four.
 */
const DEEP = 32;

/**
 * The expression written as the choices it holds, or null where it holds none.
 *
 * Two rewrites, applied to the innermost thing each fits until neither fits anywhere. A table
 * lookup becomes the chain of `?:` its keys make; a read off a `?:` goes inside both branches, and
 * what that leaves is a rewrite again.
 *
 * **Neither is enough alone, and the order falls out of repeating them.** press's article writes
 * `(summary ? T[summary.provider] : undefined)?.icon`. Expand the table first and there is no table
 * to see, because the top of the expression is a member access. Push the read in first and the
 * branch still reads the request, so `chooses` finds nothing it can enumerate. Repeated, the branch
 * the render takes is a lookup and the lookup's keys are the domain -- which was in the source the
 * whole time.
 */
export function unfolded(expression: string): string | null {
	let text = expression;
	let changed = false;
	for (let round = 0; round < DEEP; round += 1) {
		const found = choiceIn(text);
		if (found === null) break;
		text = apply(text, [[found.at[0], found.at[1], found.text]]);
		changed = true;
	}
	return changed ? text : null;
}

/**
 * Whether an expression reads any of these names, free of anything that binds them inside it.
 *
 * Asked of an expression that has already been expanded, to decide whether a marker belongs where
 * it stands. A marker stands where request-varying data goes; an expression that reaches none of
 * the payload's names is the same every request, and the render writes it as bytes.
 */
/** Whether an expression awaits outside any function inside it, which is what the render awaits. */
export function awaitsOutside(expression: string): boolean {
	if (!/\bawait\b/.test(expression)) return false;
	let tree: Node;
	try {
		tree = parsed(expression);
	} catch {
		return false;
	}
	const inside = (node: unknown): boolean => {
		if (Array.isArray(node)) return node.some(inside);
		if (!isNode(node)) return false;
		if (node['type'] === 'AwaitExpression') return true;
		if (
			node['type'] === 'FunctionExpression' ||
			node['type'] === 'ArrowFunctionExpression' ||
			node['type'] === 'FunctionDeclaration'
		) {
			return false;
		}
		return Object.values(node).some(inside);
	};
	return inside(tree);
}

export function mentions(expression: string, names: ReadonlySet<string>): boolean {
	if (names.size === 0) return false;
	let ast: Node;
	try {
		ast = parsed(expression);
	} catch {
		// Unreadable here is not a reason to write it out as bytes: keep the marker, and let the
		// pass that reads names report whatever is wrong with it.
		return true;
	}
	let found = false;
	const walk = (node: unknown): void => {
		if (found) return;
		if (Array.isArray(node)) {
			for (const one of node) walk(one);
			return;
		}
		if (!isNode(node)) return;
		if (node['type'] === 'ExpressionTag') {
			reads(node['expression'], new Set(), (at) => {
				if (typeof at['name'] === 'string' && names.has(at['name'])) found = true;
			});
			return;
		}
		for (const one of Object.values(node)) walk(one);
	};
	walk(ast['fragment']);
	return found;
}

/**
 * The dotted name an expression spells, or null where it spells none.
 *
 * `data.locale.code` and `((data)).locale.code` are the same path: the parser keeps no
 * parentheses, so substitution's own wrapping falls away without anything having to strip it. A
 * call, an index or anything computed is not a path and gets null.
 */
export function pathOf(expression: string): string | null {
	let ast: Node;
	try {
		ast = parsed(expression);
	} catch {
		return null;
	}
	const fragment = ast['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const [only] = nodes;
	if (nodes.length !== 1 || !isNode(only) || only['type'] !== 'ExpressionTag') return null;

	const names: string[] = [];
	let at: unknown = only['expression'];
	while (isNode(at) && at['type'] === 'MemberExpression') {
		const property = at['property'];
		if (at['computed'] === true || !isNode(property) || typeof property['name'] !== 'string') {
			return null;
		}
		names.unshift(property['name']);
		at = at['object'];
	}
	if (!isNode(at) || at['type'] !== 'Identifier' || typeof at['name'] !== 'string') return null;
	names.unshift(at['name']);
	return names.join('.');
}

/**
 * The value an expression is, as JSON, where it is a literal and nothing else.
 *
 * Substitution parenthesises what it writes, so a prop handed a fixed path arrives as `("en")` and
 * comparing the text against the literal it came from finds nothing. The parser keeps no
 * parentheses, so asking the AST is asking the question that was meant.
 */
export function literalOf(expression: string): string | undefined {
	let ast: Node;
	try {
		ast = parsed(expression);
	} catch {
		return undefined;
	}
	const fragment = ast['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const [only] = nodes;
	if (nodes.length !== 1 || !isNode(only) || only['type'] !== 'ExpressionTag') return undefined;
	const inner = only['expression'];
	if (!isNode(inner) || inner['type'] !== 'Literal') return undefined;
	const value = inner['value'];
	if (typeof value === 'object' && value !== null) return undefined;
	return JSON.stringify(value ?? null);
}

/** What `parsed` wraps an expression in, so a position in its AST maps back to the expression. */
const WRAPPED = '<script lang="ts"></script>{'.length;

/**
 * Every `?:` a marker cannot stand for, written as the branch it was decided for, outermost first.
 *
 * Asked of a value handed to code the compiler cannot read. A marker stands where a value is
 * written into bytes; the branches of a ternary handed over may instead be things the component
 * *uses* -- the one that made this necessary chose between two message functions, and a string
 * where a function was expected stopped the render inside the package. Such a ternary chooses
 * what is handed, which is a decision with two outcomes, and it is compiled the way every other
 * decision is: the build renders once per branch and keeps both, and in each render the ternary
 * is written as its branch. See spec/refusals.md.
 *
 * **Which ternaries, and it is narrower than all of them.** A branch the request decides has to
 * be a marker whatever it is, and a literal is a value that can only be written, so a ternary
 * between those is a value like any other and the marker stands for the whole of it -- `tone ===
 * 'dark' ? 'text-black' : 'text-white'` on a package's icon is that, and it is written per item
 * inside an each, which enumeration could not have done. What forces a branch is a value the
 * request does not decide that is not a literal: a name, a member, a call, a function, an object
 * -- the same things `inert` leaves for Svelte to evaluate, met one level in. A ternary in a
 * branch is asked the same question, so a choice between two choices is enumerated as a tree.
 *
 * `decided` is keyed by the test's own source text, which is stable because the expression has
 * already been expanded: a name declared in a script is gone and a fixed path is its literal. The
 * first ternary nobody has decided comes back as `undecided`, and the caller asks the build for
 * both renders. Outermost first and one at a time, so a ternary inside the branch that is not
 * taken is never asked about, and nesting costs a tree of renders rather than a product.
 *
 * A ternary inside a function is left alone. It runs per call, inside the component, and decides
 * nothing about which bytes the page has.
 */
export function settle(
	expression: string,
	decided: ReadonlyMap<string, boolean>,
	/** The names the request decides, in the scope the expression was written in. */
	dynamic: ReadonlySet<string>,
	/**
	 * Names that hold a string the render writes rather than something a marker cannot stand for:
	 * an id from `$props.id()`, evaluated by the render and read back as a marker. A branch that is
	 * one of these is a value, not a choice of structure.
	 */
	plain: ReadonlySet<string> = new Set(),
): { text: string; undecided: string | null } {
	let text = expression;
	for (;;) {
		let ast: Node;
		try {
			ast = parsed(text);
		} catch {
			return { text, undecided: null };
		}
		const found = conditional(ast['fragment'], dynamic, plain);
		if (found === null) return { text, undecided: null };
		const [whole, test, consequent, alternate] = found;
		const at = (range: [number, number]): string =>
			text.slice(range[0] - WRAPPED, range[1] - WRAPPED);
		const taken = decided.get(at(test));
		if (taken === undefined) return { text, undecided: at(test) };
		text = apply(text, [
			[whole[0] - WRAPPED, whole[1] - WRAPPED, `(${at(taken ? consequent : alternate)})`],
		]);
	}
}

type Spans = [[number, number], [number, number], [number, number], [number, number]];

/**
 * The first `?:` met in document order that a marker cannot stand for, as four spans. One a
 * marker can stand for is a value, and nothing inside it is looked at: the whole of it is written.
 */
function conditional(
	node: unknown,
	dynamic: ReadonlySet<string>,
	plain: ReadonlySet<string>,
): Spans | null {
	if (Array.isArray(node)) {
		for (const one of node) {
			const found = conditional(one, dynamic, plain);
			if (found !== null) return found;
		}
		return null;
	}
	if (!isNode(node)) return null;
	const type = node['type'];
	if (type === 'ArrowFunctionExpression' || type === 'FunctionExpression') return null;
	if (type === 'ConditionalExpression' && chooses(node, dynamic, plain)) {
		// A test the request does not decide is a value the render can evaluate, so the whole
		// ternary is left to Svelte the way any inert expression is, and only what is inside its
		// branches is looked at. Enumerating it cost a structure per constant choice -- press's
		// switcher had one on every route -- and the second structure was the first again.
		if (varies(node['test'], dynamic)) {
			const spans = [node, node['test'], node['consequent'], node['alternate']].map(where);
			const [whole, test, consequent, alternate] = spans;
			if (whole && test && consequent && alternate) return [whole, test, consequent, alternate];
			return null;
		}
	}
	for (const value of Object.values(node)) {
		const found = conditional(value, dynamic, plain);
		if (found !== null) return found;
	}
	return null;
}

/** Whether a ternary has a branch a marker cannot stand for, looking through nested ones. */
function chooses(node: Node, dynamic: ReadonlySet<string>, plain: ReadonlySet<string>): boolean {
	return [node['consequent'], node['alternate']].some((branch) => {
		if (!isNode(branch)) return false;
		if (branch['type'] === 'ConditionalExpression') return chooses(branch, dynamic, plain);
		if (isLiteral(branch)) return false;
		// A call's result is not its callee. `cond ? make() : x` chooses between two values, and a
		// marker stands for a value; what a marker cannot stand for is a branch that **is** the
		// thing -- a name, a member chain reaching one, a function written there. Reading the callee
		// as a name made every call in a branch a structure, and a pattern's default written
		// `{ a = fallback() }` inside an each was refused as a choice nobody could enumerate.
		if (branch['type'] === 'CallExpression') return false;
		// A branch that names nothing and holds no function is a value like a literal:
		// `(undefined).entries`, which is what state with no value expands to, chooses no
		// component. What a marker cannot stand for names something -- a component, a function --
		// or is one, and reads nothing the request decides. A hold is a value too: `$$hold(n)` is
		// a reference the derivation pass resolves by its index, and a member read off one --
		// `($$hold(n).value)`, what a bound child's run sends back -- is that value's field. See
		// spec/derivation.md, "A hold may name the child's chain, and that is how a value crosses
		// back up".
		let structural = false;
		reads(branch, new Set(), (at) => {
			const name = at['name'];
			if (name === 'undefined' || name === '$$hold') return;
			if (!(typeof name === 'string' && plain.has(name))) structural = true;
		});
		const functions = (part: unknown): void => {
			if (structural) return;
			if (Array.isArray(part)) {
				for (const one of part) functions(one);
				return;
			}
			if (!isNode(part)) return;
			if (part['type'] === 'ArrowFunctionExpression' || part['type'] === 'FunctionExpression') {
				structural = true;
				return;
			}
			for (const one of Object.values(part)) functions(one);
		};
		functions(branch);
		return structural && !varies(branch, dynamic);
	});
}

/** Whether an expression reads a name the request decides. */
export function varies(node: unknown, dynamic: ReadonlySet<string>): boolean {
	let found = false;
	reads(node, new Set(), (at) => {
		if (typeof at['name'] === 'string' && dynamic.has(at['name'])) found = true;
	});
	return found;
}

/**
 * A value that can only be written: a literal, a template, a sign in front of a number, or
 * `undefined`, which the parser keeps as a name rather than a literal and which is one anyway.
 */
function isLiteral(node: Node): boolean {
	const type = node['type'];
	if (type === 'Literal' || type === 'TemplateLiteral') return true;
	if (type === 'Identifier' && node['name'] === 'undefined') return true;
	if (type === 'UnaryExpression' && (node['operator'] === '-' || node['operator'] === '+')) {
		return isNode(node['argument']) && node['argument']['type'] === 'Literal';
	}
	return false;
}

export function where(node: unknown): [number, number] | null {
	if (!isNode(node)) return null;
	const { start, end } = node;
	return typeof start === 'number' && typeof end === 'number' ? [start, end] : null;
}

/**
 * Whether every read of one of `names` in the expression sits inside the arguments of a call
 * whose callee is rooted at one of `callees`, arrow functions among the arguments included.
 *
 * What it is for: a runes module -- `reads.svelte.ts`, compiled by Svelte and legal nowhere
 * else -- called with a value the request decides, `createReadsQuery(() => data.slug)`. The
 * expression mentions the payload, and what it evaluates to on the server is decided inside a
 * render by the library and nowhere else, so the runtime cannot hold it as a derivation and the
 * render is the only place it can be asked. Every other read of the request stays a hole.
 */
export function onlyWithin(
	expression: string,
	names: ReadonlySet<string>,
	callees: ReadonlySet<string>,
): boolean {
	if (names.size === 0 || callees.size === 0) return false;
	let ast: Node;
	try {
		ast = parsed(expression);
	} catch {
		return false;
	}
	let outside = false;
	let called = false;
	const rootOf = (node: unknown): string | null => {
		let at = node;
		while (isNode(at) && (at['type'] === 'MemberExpression' || at['type'] === 'ChainExpression')) {
			at = at['type'] === 'ChainExpression' ? at['expression'] : at['object'];
		}
		return isNode(at) && at['type'] === 'Identifier' && typeof at['name'] === 'string'
			? at['name']
			: null;
	};
	const walk = (node: unknown, inside: boolean): void => {
		if (outside) return;
		if (Array.isArray(node)) {
			for (const one of node) walk(one, inside);
			return;
		}
		if (!isNode(node)) return;
		if (node['type'] === 'CallExpression') {
			const root = rootOf(node['callee']);
			const shielding = root !== null && callees.has(root);
			if (shielding) called = true;
			walk(node['callee'], inside);
			walk(node['arguments'], inside || shielding);
			return;
		}
		if (node['type'] === 'Identifier') {
			if (!inside && typeof node['name'] === 'string' && names.has(node['name'])) outside = true;
			return;
		}
		if (node['type'] === 'MemberExpression') {
			walk(node['object'], inside);
			if (node['computed'] === true) walk(node['property'], inside);
			return;
		}
		if (node['type'] === 'Property') {
			if (node['computed'] === true) walk(node['key'], inside);
			walk(node['value'], inside);
			return;
		}
		for (const one of Object.values(node)) walk(one, inside);
	};
	walk(ast['fragment'], false);
	return called && !outside;
}

/**
 * Whether an expression is a literal and nothing else, once substitution has had its way with it.
 *
 * `<Badge tone="x" />` becomes `("x")` where the child writes `{tone}`, and a marker planted there
 * is a hole whose value nothing decides. Svelte renders a literal into the bytes and escapes it
 * the way it escapes everything else, so leaving it to do that is fewer moving parts than carrying
 * the value through the protocol and putting it back -- and it is what the other lowering path
 * already did, which is where the two came apart.
 *
 * Deliberately only a literal. An expression that merely reaches no payload name is not the same
 * thing: it may read something ambient, and a compile-time render would bake in whatever that was.
 */
export function constant(expression: string): boolean {
	let ast: Node;
	try {
		ast = parsed(expression);
	} catch {
		return false;
	}
	const fragment = ast['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const [only] = nodes;
	if (nodes.length !== 1 || !isNode(only) || only['type'] !== 'ExpressionTag') return false;
	const inner = only['expression'];
	if (!isNode(inner)) return false;
	// A negative number is a unary operator over one, which the parser keeps as two nodes.
	const value =
		inner['type'] === 'UnaryExpression' && (inner['operator'] === '-' || inner['operator'] === '+')
			? inner['argument']
			: inner;
	return isNode(value) && value['type'] === 'Literal';
}

/**
 * Every name the two scripts declare, with what each stands for and where each was written.
 *
 * `fixed` names payload paths whose value this render is being made for -- a locale, a role, any
 * field whose domain the build declared and which the compiler is enumerating over. A path in it
 * is not a hole: it is a literal in this render, in the expressions the markup carries and in the
 * script that computed it, so both say the same thing. See spec/pipeline.md.
 */
/** The initialisers whose two evaluations are two values. See spec/derivation.md. */
export const MAKES: ReadonlySet<string> = new Set([
	'ObjectExpression',
	'ArrayExpression',
	'NewExpression',
	'CallExpression',
]);

/**
 * The part of a reach template every name of one pattern shares, as a template over `INIT`.
 *
 * `destructure()` writes an array's reach as `$$to_array(INIT, n)[0]`, so the call is the shared
 * part and the index is the name's own. Everything else reaches by member, where the initialiser is
 * what is shared and one accessor is the name's.
 */
export function shared(reach: string): string | null {
	if (reach.startsWith('$$to_array(')) {
		let depth = 0;
		for (const [at, c] of [...reach].entries()) {
			if (c === '(') depth += 1;
			else if (c === ')') {
				depth -= 1;
				if (depth > 0) continue;
				const call = reach.slice(0, at + 1);
				return call.includes(INIT) ? call : null;
			}
		}
		return null;
	}
	return reach.startsWith(INIT) ? INIT : null;
}

/** The index this expression has in a walk's held list, appending it where it is new. */
export function kept(expression: string, held: { expression: string; files?: string[] }[]): number {
	const at = held.findIndex((one) => one.expression === expression);
	if (at >= 0) return at;
	held.push({ expression });
	return held.length - 1;
}
