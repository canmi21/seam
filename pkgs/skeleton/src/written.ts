/**
 * How an expression is written out for the render or for a derivation: a value held where it
 * crosses into a child, a test asked of the render, the author's text where the render can
 * evaluate it, and what a tag's exports and a snippet's parameters stand for. See
 * spec/derivation.md.
 */
import { relative } from 'node:path';
import { apply, type Carried, type Locals, mentions, readsOf, parsed, RUN_NAME, settle } from 'ast';
import { carries } from './compose.ts';
import { type AstNode, isNode, namesIn, refuse, span } from './node.ts';
import { sentinel } from './sentinel.ts';
import { supplied } from './snippets.ts';
import { folded, unknown } from './branches.ts';
import { Undecided, type Walk } from './walk-types.ts';

/**
 * The name an expression settles to, where it settles to one.
 *
 * `settle` decides a path whose value the build fixed; this is the arithmetic left after it, and it
 * is only ever asked of a `{@render}`'s callee. Two shapes reach a snippet through a value:
 * `{@render (show ? foo : bar)()}`, where the test has already become a literal, and
 * `{@render state.value()}` over `$state({ value: counter })`, where the object literal is what
 * substitution left. Both are folded here rather than in `settle`, which is about the request
 * deciding a path and not about reducing an expression.
 */
/**
 * A prop bound to a reference into the walk's held list, or null where it is bound to its value.
 *
 * A value that **makes** something and reaches the tag as a read of a name is held at the call
 * site, which is where its identity belongs: the caller has one value and hands the child that
 * one, so two reads inside the child must not build two. `items.includes(item)` asked a second
 * array whether it held the first one's element, and the answer was `false` where Svelte writes
 * `true`.
 *
 * Only a read of a name. An expression written at the tag -- `options={{ a: 1 }}` -- makes its
 * value there, and there is no earlier value for the child's reads to be the same as. Already
 * held is left alone: a caller's own prop arrives holding a reference, and holding it again would
 * name the reference rather than the value.
 */
export function holding(
	prop: string,
	given: string | undefined,
	byName: ReadonlySet<string>,
	walk: Walk,
): string | null {
	if (given === undefined || !byName.has(prop) || given.includes('$$hold(')) return null;
	if (!makes(given)) return null;
	return `$$hold(${String(kept(given, walk))})`;
}

/**
 * How many values an expression makes outside any function: object and array literals, `new`
 * and calls, which is `makes` counted through the whole expression rather than asked of its top.
 * Zero for text that does not parse, which `asWritten` then leaves as it was.
 */
function makers(text: string): number {
	if (!/[[{(]/.test(text)) return 0;
	let ast: Node;
	try {
		ast = parsed(text) as unknown as Node;
	} catch {
		return 0;
	}
	let found = 0;
	const step = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const one of node) step(one);
			return;
		}
		if (!isNode(node)) return;
		const kind = node['type'];
		if (
			kind === 'FunctionExpression' ||
			kind === 'ArrowFunctionExpression' ||
			kind === 'FunctionDeclaration'
		) {
			return;
		}
		if (
			kind === 'ObjectExpression' ||
			kind === 'ArrayExpression' ||
			kind === 'NewExpression' ||
			kind === 'CallExpression'
		) {
			found += 1;
		}
		for (const value of Object.values(node)) step(value);
	};
	step(ast);
	return found;
}

/**
 * Whether an expression makes something, so that two evaluations are two values.
 *
 * An object or array literal, a `new`, or a call. A member read, a name, arithmetic or a literal is
 * not one: two evaluations of those are the same value, so substitution is exact and stays exact.
 * The same reading as `holding` in locals.ts, asked of a call site's text rather than of a
 * declaration's initialiser. See spec/derivation.md.
 */
export function makes(text: string | undefined): boolean {
	if (text === undefined) return false;
	let ast: Node;
	try {
		ast = parsed(text) as unknown as Node;
	} catch {
		return false;
	}
	const fragment = (ast as unknown as AstNode)['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const [only] = nodes;
	if (nodes.length !== 1 || !isNode(only) || only['type'] !== 'ExpressionTag') return false;
	let held: unknown = only['expression'];
	while (isNode(held) && held['type'] === 'ParenthesizedExpression') held = held['expression'];
	const kind = isNode(held) ? held['type'] : undefined;
	return (
		kind === 'ObjectExpression' ||
		kind === 'ArrayExpression' ||
		kind === 'NewExpression' ||
		kind === 'CallExpression'
	);
}

/**
 * The index a held expression has in this walk's list, under the chain of the file holding it.
 *
 * The chain is the caller's, not the child's: the value is the caller's to evaluate, and a hole
 * recorded under the child would resolve its names through a file that does not declare them.
 */
export function kept(expression: string, walk: Walk): number {
	return keptUnder(expression, walk.site.stack, walk);
}

/** An empty settled map, for an expansion made the way the loop's first pass reads the name. */
export const NOTHING_SENT: ReadonlyMap<string, string> = new Map();

/**
 * The index a held expression has in this walk's list, under the chain of the given stack: the
 * caller's for a value going down, and the child's -- the caller's stack with the child's file on
 * it -- for a child's run the caller reads back up. See spec/derivation.md, "A hold may name the
 * child's chain, and that is how a value crosses back up".
 */
export function keptUnder(expression: string, stack: readonly string[], walk: Walk): number {
	const files = stack.toReversed().map((one) => relative(walk.site.root, one));
	const key = files.join('\u0000');
	const at = walk.keeping.findIndex(
		(one) => one.expression === expression && (one.files ?? []).join('\u0000') === key,
	);
	if (at >= 0) return at;
	walk.keeping.push({ expression, files });
	return walk.keeping.length - 1;
}

export function reaches(text: string): string | null {
	let ast: Node;
	try {
		ast = parsed(text) as unknown as Node;
	} catch {
		return null;
	}
	const fragment = (ast as unknown as AstNode)['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const [only] = nodes;
	if (!isNode(only) || only['type'] !== 'ExpressionTag') return null;
	const held = folded(only['expression']);
	if (!isNode(held) || held['type'] !== 'Identifier') return null;
	return typeof held['name'] === 'string' ? held['name'] : null;
}

/**
 * Appends a statement per test to the end of the instance script that reports the test's value
 * to the render's caller, so that a decision the request does not make is made once. At the end
 * rather than the top, because a declaration below is not yet in scope at the top.
 *
 * **And labelled `$:` in legacy mode, because the end of the script is not the end of the body.**
 * `transform-server.js` pushes every `$:` statement onto the instance body after it has visited
 * everything else, so a statement written below one in the source runs above it in the output --
 * and `$: items = [...]` left `items` undefined where the ask read it. Labelled, the ask is a
 * reactive statement too, and `analysis.reactive_statements` keeps them in dependency order.
 */
export function withAsks(
	ast: AstNode,
	asks: readonly [key: string, code: string][],
	wants: readonly [key: string, code: string][],
	edits: [number, number, string][],
): void {
	if (asks.length === 0 && wants.length === 0) return;
	// Only where the script writes one, which is the only thing that moves: a file with no `$:` has
	// nothing appended after the ask, and a file that has one is legacy by construction, since
	// `2-analyze/index.js` refuses the label in runes mode. Asking `legacyMode` instead disagreed
	// with Svelte over a file whose only rune is in its markup, and wrote a `$:` into a runes file.
	const after = reactive(ast) ? '$: ' : '';
	// Opened with a semicolon: the statement above may end without one, and a line starting
	// with `(` would continue it as a call.
	const lines = [
		...asks.map(
			([key, code]) =>
				`;${after}(globalThis.__seam_asked ??= {})[${JSON.stringify(key)}] = Boolean(${code});`,
		),
		// A value is answered only where it is data: a string, a number, a boolean, null, and
		// arrays and plain objects of those. A `URL` or a `Date` would round-trip as a string and
		// come back a different thing, so it is not answered and the expression stays.
		...wants.map(
			([key, code]) =>
				`;${after}(globalThis.__seam_asked ??= {})[${JSON.stringify(key)}] = ((v) => { const ok = (x) => ` +
				`x === null || ['string', 'number', 'boolean'].includes(typeof x) || (Array.isArray(x) ` +
				`? x.every(ok) : typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype ` +
				`&& Object.values(x).every(ok)); return ok(v) ? JSON.stringify(v) : undefined; })(${code});`,
		),
	];
	appended(ast, lines, edits);
}

/** Whether the instance script writes a `$:` statement, which the server transform moves. */
export function reactive(ast: AstNode): boolean {
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	return body.some(
		(one) =>
			isNode(one) &&
			one['type'] === 'LabeledStatement' &&
			isNode(one['label']) &&
			one['label']['name'] === '$',
	);
}

/** Statements added at the end of the instance script, or in one made for them. */
export function appended(
	ast: AstNode,
	lines: readonly string[],
	edits: [number, number, string][],
): void {
	if (lines.length === 0) return;
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const at = isNode(content) ? content['end'] : undefined;
	if (typeof at === 'number') {
		edits.push([at, at, `\n${lines.join('\n')}\n`]);
		return;
	}
	edits.push([0, 0, `<script>\n${lines.join('\n')}\n</script>\n`]);
}

/**
 * The binding the runtime makes for a `$props.id()`, declared in the render too: the render is
 * handed the hole's marker as the id, so an expression written in terms of the binding evaluates
 * there to the marker, and one the request decides reads the binding at request time.
 */
export function withFresh(
	ast: AstNode,
	fresh: string | null,
	ids: ReadonlySet<string>,
	edits: [number, number, string][],
): void {
	const [name] = ids;
	if (fresh === null || name === undefined) return;
	appended(ast, [`;const ${fresh} = ${name};`], edits);
}

/** An import written again, in the form it was written in: named, default, or the module. */
export function restated(one: Carried): string {
	const from = JSON.stringify(one.from);
	if (one.kind === 'namespace') return `import * as ${one.local} from ${from};`;
	if (one.kind === 'default') return `import ${one.local} from ${from};`;
	const exported = one.exported ?? one.local;
	return exported === one.local
		? `import { ${one.local} } from ${from};`
		: `import { ${exported} as ${one.local} } from ${from};`;
}

/** Whether a node is a `{#snippet}` declared under the given name. */
export function snippetNamed(child: unknown, name: string): child is AstNode {
	if (!isNode(child) || child['type'] !== 'SnippetBlock') return false;
	const id = child['expression'];
	return isNode(id) && id['name'] === name;
}

/**
 * What the render is given for an expression the request does not decide: the author's own
 * text where nothing the walk bound is in it, and the expansion otherwise. See `Walk.plain`.
 */
export function asWritten(node: unknown, written: string, walk: Walk): string {
	const at = span(node);
	if (at === null) return written;
	const plain = walk.plain(node);
	if (plain === written) return walk.source.slice(at[0], at[1]);
	// The expansion reaches the request only inside a call into a runes module, whose value the
	// library decides without the argument's value -- a query is pending on the server whatever
	// its key. What the render evaluates is then the expression in this file's own names, which
	// the copy has in scope; the expansion names the caller's, which it does not.
	if (mentions(written, unknown(walk))) return plain;
	// **And where the expansion makes a value the author's text only reads.** A copy's prop expands
	// to the caller's text, and `promise={a.promise}` over `const a = Promise.withResolvers()`
	// expands to `Promise.withResolvers().promise`: a promise made again at the read, which the
	// caller's script -- `tick().then(() => a.resolve(true))` -- never resolves. The render holds
	// the caller's one value and handed the copy that one, so the expression is evaluated in the
	// copy's own names, which read it. Only where the author's text makes nothing of its own, and
	// only where every name the expansion stood in for is one the render hands the copy as the
	// caller wrote it -- not an each item or a `{@const}` this walk may have written over, and not
	// a prop told as a value; and an expansion that is a hold or a run names a value the render is
	// given, and stays. See spec/derivation.md, "A value that makes something is held where it
	// crosses into a child".
	if (
		makers(written) > makers(plain) &&
		!written.includes('$$hold(') &&
		!written.includes(`${RUN_NAME}(`)
	) {
		const read = readsOf([written]);
		const stoodFor = [...readsOf([plain])].filter((name) => !read.has(name));
		if (stoodFor.length > 0 && stoodFor.every((name) => walk.handedAsWritten.has(name))) {
			return plain;
		}
	}
	// The expansion goes into the render's own source, so a name substitution could not follow has
	// gone with it: `{#snippet item(id = default_arg())}` written out at each read of `id` had the
	// render call `default_arg` nine times where Svelte calls it twice. The same question the
	// finished expressions are asked, at the other place an expansion is written out.
	for (const name of readsOf([written])) {
		const why =
			walk.site.changing.get(name) ??
			(name.startsWith('$') ? walk.site.changing.get(name.slice(1)) : undefined);
		if (why !== undefined) refuse(why);
	}
	return written;
}

/**
 * The getter half of a `bind:`: the node the value comes out of.
 *
 * `shared/component.js` writes `get x() { return <expression> }`, and for the two-function form
 * `bind:x={(get, set)}` the first of the pair is what that getter returns.
 */
export function getterOf(node: AstNode): unknown {
	const expression = node['expression'];
	if (!isNode(expression) || expression['type'] !== 'SequenceExpression') return expression;
	const [getter] = Array.isArray(expression['expressions']) ? expression['expressions'] : [];
	return isNode(getter) ? getter : expression;
}

/**
 * What a `bind:` hands the child for the prop, expanded: the getter, **called** where it is one.
 *
 * `element.js` writes `b.call(expression.expressions[0])` where the value goes and `component.js`
 * a getter returning the same call, so a pair is the first function's result and never the
 * function. This was a synthetic `Identifier` whose `name` carried the call, and an expansion is
 * sliced out of the source by span rather than read off a name, so the name went nowhere and the
 * child was handed the function itself. `runtime-runes/bind-getter-setter` is that: a child whose
 * `$bindable()` prop the caller binds with a pair of its own wrote `value="() =&gt; a"` where
 * Svelte writes `value="0"`. It was in the skips until the configs were read. See spec/suite.md.
 */
export function handed(node: AstNode, expand: Locals['rewrite']): string {
	const expression = node['expression'];
	const getter = getterOf(node);
	return isNode(expression) && expression['type'] === 'SequenceExpression' && getter !== expression
		? `(${expand(getter)})()`
		: expand(getter);
}

/**
 * Text put inside a template literal, escaped the way `sanitize_template_string` escapes it.
 *
 * A backslash, a backtick and the two characters that open an interpolation are the whole of it:
 * everything else, newlines included, is written as it stands.
 */
export function templated(text: string): string {
	return text.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
}

/**
 * The names a component exports readonly: `export const`, `export function`, `export class`.
 *
 * Not props -- a caller cannot pass one -- but `analysis.exports` puts them in the object
 * `$.bind_props` is given, so a caller that binds one gets the child's value back. See `descend`.
 */
/**
 * A readonly export's name and the source of what it holds, which is what `bind_props` sends up.
 *
 * `analysis.exports` carries the pair and `transform-server.js` puts `b.init(alias ?? name, id)`
 * into the object, so the value is the declaration's own initialiser read in the child's scope.
 */
export function exportedValues(ast: AstNode, source: string): [string, string][] {
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	const held = new Map<string, string>();
	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'VariableDeclaration') continue;
		for (const one of Array.isArray(statement['declarations']) ? statement['declarations'] : []) {
			if (!isNode(one)) continue;
			const id = one['id'];
			const at = span(one['init']);
			if (!isNode(id) || typeof id['name'] !== 'string' || at === null) continue;
			held.set(id['name'], source.slice(at[0], at[1]));
		}
	}
	return exportedBy(ast).map((name) => [name, held.get(name) ?? exportedInit(ast, source, name)]);
}

/** The initialiser of an `export const x = 1`, whose declaration carries the export keyword. */
function exportedInit(ast: AstNode, source: string, want: string): string {
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'ExportNamedDeclaration') continue;
		const declaration = statement['declaration'];
		if (!isNode(declaration) || declaration['type'] !== 'VariableDeclaration') continue;
		for (const one of Array.isArray(declaration['declarations'])
			? declaration['declarations']
			: []) {
			if (!isNode(one)) continue;
			const id = one['id'];
			const at = span(one['init']);
			if (!isNode(id) || id['name'] !== want || at === null) continue;
			return source.slice(at[0], at[1]);
		}
	}
	return 'undefined';
}

export function exportedBy(ast: AstNode): string[] {
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	const found: string[] = [];
	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'ExportNamedDeclaration') continue;
		const declaration = statement['declaration'];
		// `export let` and `export { a }` over a `let` are **props**, not readonly exports, and
		// `propsOf` has them. Only `const`, `function` and `class` are readonly, which is what
		// `bind_props` receives from `analysis.exports` beside the bindable props rather than as
		// one of them.
		if (!isNode(declaration)) continue;
		const kind = declaration['kind'];
		if (declaration['type'] === 'VariableDeclaration' && (kind === 'let' || kind === 'var')) {
			continue;
		}
		const id = declaration['id'];
		if (isNode(id) && typeof id['name'] === 'string') {
			found.push(id['name']);
			continue;
		}
		for (const one of Array.isArray(declaration['declarations'])
			? declaration['declarations']
			: []) {
			const held = isNode(one) ? one['id'] : undefined;
			if (isNode(held) && typeof held['name'] === 'string') found.push(held['name']);
		}
	}
	return found;
}

/** Every name a snippet's parameters bind. */
export function parameterNames(parameters: readonly unknown[]): Set<string> {
	const names = new Set<string>();
	for (const parameter of parameters) namesIn(parameter, names);
	return names;
}

/**
 * Why a snippet passed to a component cannot be compiled if the component writes it, or null.
 *
 * Only a `{#snippet}` written directly inside the tag, which is the prop the component calls with
 * arguments of its own. Where the body reads one of those as a value, the walk plants markers that
 * name something no render binds; that is fine in markup the component never writes and a refusal
 * in markup it does, and which of the two is the probe's to say. See `Handed.reads`.
 */
export function reading(child: AstNode): string | null {
	if (child['type'] !== 'SnippetBlock') return null;
	if (supplied(child) !== null) return null;
	const id = child['expression'];
	const named = isNode(id) && typeof id['name'] === 'string' ? id['name'] : '';
	return (
		`the snippet \`${named}\` is passed to a component, which calls it with arguments this ` +
		'compiler cannot see, and it reads one of them as a value rather than rendering it, so ' +
		'there is nothing to stand in its place'
	);
}

/** The slot a child is written into, told by a literal `slot="x"` the way Svelte tells. */
/** A literal attribute's text, or null where it is absent or not written as text. */
export function attributeText(node: AstNode, name: string): string | null {
	for (const one of Array.isArray(node['attributes']) ? node['attributes'] : []) {
		if (!isNode(one) || one['type'] !== 'Attribute' || one['name'] !== name) continue;
		const parts = Array.isArray(one['value']) ? one['value'] : [one['value']];
		const [only] = parts;
		if (isNode(only) && only['type'] === 'Text' && typeof only['data'] === 'string') {
			return only['data'];
		}
	}
	return null;
}

export function slotOf(node: AstNode): string | null {
	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	for (const one of attributes) {
		if (!isNode(one) || one['type'] !== 'Attribute' || one['name'] !== 'slot') continue;
		const parts = Array.isArray(one['value']) ? one['value'] : [one['value']];
		const [only] = parts;
		if (isNode(only) && only['type'] === 'Text' && typeof only['data'] === 'string') {
			return only['data'];
		}
	}
	return null;
}

/**
 * What stands in for a value handed to a component the walk could not enter, as source.
 *
 * The value is going somewhere this pass cannot read, so what stands for it has to survive being
 * *used* rather than only being written out. Three things follow, in order.
 *
 * A `?:` in it whose branches are not all things a marker can stand for chooses what is handed --
 * the case that forced this chose between two message functions. It is written as the branch this
 * render was told to take, and where it was not told, the walk stops and asks. See `settle` for
 * which ternaries those are; the rest are values and get a marker like anything else.
 *
 * A value the request does not decide is left as written, so Svelte evaluates it during the
 * render: `<Provider client={queryClient}>` is that, and so is the branch a settled ternary leaves
 * behind. The same rule `inert` applies to a whole attribute, one level in.
 *
 * An object or an array gets a marker at each value rather than one for the whole, so the fields
 * the component reads off it are still there. What is left gets one marker, and is reported if it
 * does not come back.
 */
export function stands(expression: string, walk: Walk): string {
	const held = settle(expression, walk.site.decided, walk.dynamic, new Set(walk.fresh));
	if (held.undecided !== null) {
		// A name a block binds is decided per item, and a decision over it cannot be enumerated for
		// the page: the derivation the branch would test has no item to read. The choice has another
		// spelling, which is the block that is taken per item.
		const scoped = new Set(
			[...walk.dynamic].filter(
				(one) => walk.site.payload?.has(one) !== true && !walk.fresh.includes(one),
			),
		);
		if (mentions(held.undecided, scoped)) {
			refuse(
				`\`${held.undecided}\` chooses what a component is given and reads a name an each block ` +
					'binds, so the choice is made per item and cannot be enumerated for the page. Write it ' +
					'as an `{#if}` around the component, which is a block and is taken per item',
			);
		}
		throw new Undecided(held.undecided);
	}
	const text = held.text;
	if (walk.site.payload !== null && !carries(text) && !mentions(text, walk.dynamic)) return text;
	const apart = leaves(text, walk);
	if (apart !== null) return apart;
	const index = walk.holes.length;
	walk.holes.push({ index, expression: text, raw: false });
	return JSON.stringify(sentinel(index));
}

/**
 * An object or array literal with something standing at each of its values, or null where the
 * expression is not one this can take apart.
 *
 * Only for a value handed to a component the walk could not enter, and only for what is written
 * out as a literal here: the keys are the author's, so what the component reads off the object is
 * still there, and only the values it writes are markers. `{ count: n }` becomes
 * `{ count: "%%s5%%" }` rather than `"%%s5%%"`, which is the difference between a field the
 * component can read and a string that has none.
 *
 * A shorthand property has its name written back out, for the third-time reason `scope.ts` gives.
 * Anything the shape does not allow -- a spread, a computed key, a getter -- is left to the caller,
 * which plants one marker for the whole and reports it if it does not come back.
 */
export function leaves(expression: string, walk: Walk): string | null {
	// The shared, memoised parse in `ast`: the same wrapper, and read here rather than written.
	const ast = parsed(expression) as unknown as AstNode;
	const offset = '<script lang="ts"></script>{'.length;
	const fragment = ast['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const [only] = nodes;
	if (nodes.length !== 1 || !isNode(only) || only['type'] !== 'ExpressionTag') return null;
	const literal = only['expression'];
	if (!isNode(literal)) return null;
	const kind = literal['type'];
	if (kind !== 'ObjectExpression' && kind !== 'ArrayExpression') return null;
	const parts = kind === 'ObjectExpression' ? literal['properties'] : literal['elements'];
	if (!Array.isArray(parts) || parts.length === 0) return null;

	const planned: [[number, number], string, boolean][] = [];
	for (const one of parts) {
		if (!isNode(one)) return null;
		const shorthand = kind === 'ObjectExpression' && one['shorthand'] === true;
		if (kind === 'ObjectExpression') {
			if (one['type'] !== 'Property' || one['computed'] === true || one['kind'] !== 'init') {
				return null;
			}
		}
		const value = kind === 'ObjectExpression' ? one['value'] : one;
		const key = kind === 'ObjectExpression' ? one['key'] : undefined;
		const name = isNode(key) && typeof key['name'] === 'string' ? key['name'] : '';
		const where = span(value);
		if (where === null) return null;
		// An event handler is never serialised, so nothing stands for it.
		if (name.startsWith('on') && name.length > 2) continue;
		planned.push([[where[0] - offset, where[1] - offset], name, shorthand]);
	}
	if (planned.length === 0) return null;
	const edits: [number, number, string][] = [];
	for (const [[from, to], name, shorthand] of planned) {
		const held = stands(expression.slice(from, to), walk);
		edits.push([from, to, shorthand ? `${name}: ${held}` : held]);
	}
	return apply(expression, edits);
}
