/**
 * Which component a tag names, and how: the file an import resolves to, a component that renders
 * itself, a `this` the request decides and the one candidate it can be, and what stands in for a
 * component in an expression. See spec/pipeline.md and spec/payload.md.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import {
	apply,
	importsOf as importedBy,
	type Locals,
	mentions,
	componentOf,
	objectEntries,
	parsedComponent,
	reads as readsIn,
	resolveBare,
	RUN_NAME,
	bound,
} from 'ast';
import { propsOf, rename } from './compose.ts';
import { type AstNode, isNode, refuse, span } from './node.ts';
import { marks, marksHead, writes } from './sentinel.ts';
import type { Snippet } from './snippets.ts';
import { settled } from './branches.ts';
import { takenApart } from './selection.ts';
import { type Walk } from './walk-types.ts';

/**
 * The expression with every `?:` a marker cannot stand for settled to the branch this render
 * takes, or the walk stopped to ask which. A ternary over the request between things a marker
 * cannot stand for -- components, functions, an object holding them -- is a structure wherever
 * it is written: handed to a package, naming a component, testing a block, or read as a value
 * whose evaluation would reach for those things in a scope that holds data. See `settle`.
 */
/**
 * The `.svelte` file a component tag names, or null.
 *
 * A component the project holds is imported by a relative path ending in `.svelte`, and that is
 * the file. A package's is imported by a bare specifier -- `import { DropdownMenu } from
 * 'bits-ui'` and then `<DropdownMenu.Root>` -- and is found by resolving the specifier the way a
 * Svelte-aware bundler does and following the package's re-exports to the file, member by member.
 * A package's component is a component like any other once the file is in hand, and the walk
 * enters it the same way; where it cannot, the component is left to Svelte's render, as before.
 * See `packages.ts` and spec/refusals.md.
 */
export function componentFile(tag: string, walk: Walk): string | null {
	const [head, ...members] = tag.split('.');
	if (head === undefined || head === '') return null;
	const one = walk.site.carried.get(head);
	if (one === undefined) return null;
	if (one.from.startsWith('.')) {
		if (members.length > 0 || one.kind !== 'default' || !one.from.endsWith('.svelte')) return null;
		return resolvePath(dirname(walk.site.file), one.from);
	}
	const names =
		one.kind === 'default'
			? ['default', ...members]
			: one.kind === 'named'
				? [one.exported ?? one.local, ...members]
				: members;
	if (names.length === 0) return null;
	return componentOf(one.from, names, walk.site.file);
}

/**
 * A copy takes its `<script module>` exports from the file it copies rather than restating them.
 *
 * `transform-server.js` puts the module block at the top level of the module it compiles, so Svelte
 * runs it **once per file** however many times the component is used. A copy is a second file, so a
 * restated module block runs a second time and everything it declares has a second identity.
 * `export const TABS = {}` beside `setContext(TABS, ...)` is the shape: the copy set the context
 * under its own key and a sibling reading `getContext(TABS)` off the original's key got `undefined`,
 * which showed up as a destructuring failing inside Svelte's own renderer.
 *
 * So each exported name is imported from the original and re-exported, which is one module and one
 * identity. Imports in the block stay: importing a module twice is the same module. A name the
 * block declares without exporting is left restated, since there is no way to reach it from
 * outside, and it is only observable where something changes it -- which `changedBy()` already
 * refuses.
 */
export function shared(ast: AstNode, file: string, edits: [number, number, string][]): void {
	const { names, taken } = moduleExports(ast);
	if (names.size === 0) return;
	const listed = [...names].join(', ');
	// Relative to the file this copies, which is where a copy's own specifiers are resolved from:
	// the render emits a copy under the original's directory as its origin. See `emit()` in
	// `render.ts`.
	const from = `'./${basename(file)}'`;
	const [first, ...rest] = taken;
	if (first === undefined) return;
	edits.push([first[0], first[1], `import { ${listed} } from ${from};\nexport { ${listed} };`]);
	for (const at of rest) edits.push([at[0], at[1], '']);
}

/** What a component's `<script module>` exports, and where each export is written. */
export function moduleExports(ast: AstNode): { names: Set<string>; taken: [number, number][] } {
	const block = ast['module'];
	const content = isNode(block) ? block['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	const names = new Set<string>();
	const taken: [number, number][] = [];
	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'ExportNamedDeclaration') continue;
		const one = statement['declaration'];
		if (!isNode(one)) continue;
		const found = new Set<string>();
		if (one['type'] === 'VariableDeclaration') {
			for (const each of Array.isArray(one['declarations']) ? one['declarations'] : []) {
				if (isNode(each)) bound(each['id'], found);
			}
		} else if (isNode(one['id']) && typeof one['id']['name'] === 'string') {
			found.add(one['id']['name']);
		}
		if (found.size === 0) continue;
		const at = span(statement);
		if (at === null) continue;
		for (const name of found) names.add(name);
		taken.push(at);
	}
	return { names, taken };
}

/**
 * The rewritten source with the imports nothing in it reads any more taken out.
 *
 * A component tag the walk replaced with a copy leaves its import behind, and the render would
 * still load the module: for a package that is its whole tree of re-exports, `.svelte` files
 * Node cannot load among them, so a name whose every use became a copy is not imported. Read off
 * the rewritten text: an import whose local names appear nowhere else in it binds nothing.
 */
export function unimported(text: string): string {
	let ast: AstNode;
	try {
		ast = parsedComponent(text) as unknown as AstNode;
	} catch {
		return text;
	}
	// Every name the rest of the file reads: the scripts' statements other than the imports, and
	// the markup's expressions. Read off the tree rather than the text, since a name inside a
	// string or a specifier is not a use and prose is full of apostrophes.
	const used = new Set<string>();
	const mark = (node: unknown): void => {
		readsIn(node, new Set(), (at) => {
			if (typeof at['name'] !== 'string') return;
			used.add(at['name']);
			// `$x` is a subscription to the store `x`, so it is a use of `x` -- and the only one an
			// imported store may have. Without this the import was dropped as unused and Svelte then
			// refused the read: "`$held` is an illegal variable name", which is what
			// `2-analyze/index.js` raises for a `$` reference whose store nothing declares.
			if (at['name'].startsWith('$') && at['name'].length > 1) used.add(at['name'].slice(1));
		});
	};
	// A name written to is not read, which is right everywhere else and wrong here: `$count++` is
	// the only mention an imported store may have, and dropping the import left Svelte refusing
	// `$count` as an illegal variable name. What this pass asks is whether the file still mentions
	// the import at all, so an assignment target counts.
	const written = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const one of node) written(one);
			return;
		}
		if (!isNode(node)) return;
		const target =
			node['type'] === 'AssignmentExpression'
				? node['left']
				: node['type'] === 'UpdateExpression'
					? node['argument']
					: undefined;
		if (isNode(target) && target['type'] === 'Identifier' && typeof target['name'] === 'string') {
			used.add(target['name']);
			if (target['name'].startsWith('$') && target['name'].length > 1) {
				used.add(target['name'].slice(1));
			}
		}
		for (const value of Object.values(node)) written(value);
	};
	// A default inside a pattern is read too -- `let { onOpenChange = noop } = $props()` reads
	// `noop` -- and a pattern is where `reads` stops, the names in it being bound rather than read.
	const defaults = (pattern: unknown): void => {
		if (Array.isArray(pattern)) {
			for (const one of pattern) defaults(one);
			return;
		}
		if (!isNode(pattern)) return;
		if (pattern['type'] === 'AssignmentPattern') {
			mark(pattern['right']);
			defaults(pattern['left']);
			return;
		}
		if (pattern['type'] === 'Property') {
			defaults(pattern['value']);
			return;
		}
		for (const value of Object.values(pattern)) defaults(value);
	};
	const scripts = [ast['instance'], ast['module']];
	for (const script of scripts) {
		const content = isNode(script) ? script['content'] : undefined;
		const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
		for (const statement of body) {
			if (!isNode(statement) || statement['type'] === 'ImportDeclaration') continue;
			mark(statement);
			written(statement);
			if (statement['type'] === 'VariableDeclaration') {
				for (const one of Array.isArray(statement['declarations'])
					? statement['declarations']
					: []) {
					if (isNode(one)) defaults(one['id']);
				}
			}
		}
	}
	mark(ast['fragment']);
	written(ast['fragment']);
	// A component tag names its import without an identifier node: `<Tree$0>` reads `Tree$0`.
	const tags = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const one of node) tags(one);
			return;
		}
		if (!isNode(node)) return;
		if (node['type'] === 'Component' && typeof node['name'] === 'string') {
			used.add(node['name'].split('.')[0] ?? node['name']);
		}
		for (const value of Object.values(node)) tags(value);
	};
	tags(ast['fragment']);

	const edits: [number, number, string][] = [];
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'ImportDeclaration') continue;
		const at = span(statement);
		const specifiers = Array.isArray(statement['specifiers']) ? statement['specifiers'] : [];
		if (at === null) continue;
		// A side-effect import of a component binds nothing and is kept for what running it does.
		// What it does is register a custom element, which is `customElements.define` and the
		// client's: the server writes the tag as an unknown element whether or not anything was
		// ever defined. The render is Node, which cannot load a `.svelte` file at all, so keeping it
		// stopped the compile with `Unknown file extension ".svelte"`.
		const from = statement['source'];
		const named = isNode(from) && typeof from['value'] === 'string' ? from['value'] : '';
		if (specifiers.length === 0) {
			if (named.endsWith('.svelte')) edits.push([at[0], at[1], '']);
			continue;
		}
		const wanted = specifiers.some((one) => {
			const local = isNode(one) ? one['local'] : undefined;
			const name = isNode(local) && typeof local['name'] === 'string' ? local['name'] : null;
			return name === null || used.has(name);
		});
		if (!wanted) edits.push([at[0], at[1], '']);
	}
	return edits.length === 0 ? text : apply(text, edits);
}

/** Whether a component's script imports its own file. */
export function importsItself(raw: string, file: string): boolean {
	return [...importedBy(raw).values()].some(
		(one) =>
			one.from.startsWith('.') &&
			one.from.endsWith('.svelte') &&
			resolvePath(dirname(file), one.from) === file,
	);
}

/**
 * What a call of a component fragment binds each prop to: the caller's expression, or the prop's
 * own default where the caller leaves it out or passes `undefined`, as JavaScript does.
 */
export function propBinds(
	declares: readonly { local: string; prop: string; fallback: string; rest?: true }[],
	bindings: ReadonlyMap<string, string>,
): [string, string][] {
	const named = new Set(declares.filter((one) => one.rest !== true).map((one) => one.prop));
	return declares.map((one): [string, string] => {
		// A rest gathers per call what the call wrote and the pattern did not name, as `descend()`
		// gathers one for a component entered once; here it is a parameter bound to that object.
		if (one.rest === true) {
			const others = [...bindings]
				.filter(([prop]) => !named.has(prop))
				.map(([prop, value]) => `${JSON.stringify(prop)}: ${value}`);
			return [one.local, `({ ${others.join(', ')} })`];
		}
		const given = bindings.get(one.prop);
		if (given === undefined) return [one.local, one.fallback];
		if (one.fallback === 'undefined') return [one.local, given];
		return [one.local, `(${given} === undefined ? (${one.fallback}) : ${given})`];
	});
}

/**
 * A component tag that is a call of the fragment its own component is, standing in for a render
 * that would not end. The tag is renamed to a copy whose whole body is the hole's marker, so that
 * the render writes what it writes around a component call, and the hole carries what the runtime
 * binds the fragment's props to.
 */
export function selfCall(
	node: AstNode,
	walk: Walk,
	tag: string,
	fragment: string,
	/** The source of the component called, which is this file's unless the cycle is longer. */
	source = walk.source,
	dynamic?: { expression: [number, number] | null },
	/**
	 * Set for `<svelte:self>`, which Svelte anchors differently from a component naming its own
	 * file even though the two render the same thing.
	 *
	 * `is_standalone` in `3-transform/utils.js` is `trimmed.length === 1` and the one node being a
	 * `RenderTag` or a **`Component`** -- and `<svelte:self>` is a `SvelteSelf`, so it never
	 * qualifies. A fragment holding one of those alone therefore gets the `<!---->` that
	 * `shared/component.js` pushes after a component, where a fragment holding one ordinary
	 * component alone does not. The stand-in this writes is a component tag, so Svelte reads it as
	 * standalone and drops the anchor the original had. Measured on
	 * `runtime-legacy/nested-transition-detach-if-false`, one `<!---->` short at one level of a
	 * recursion. See spec/ir.md.
	 */
	itself = false,
): void {
	const ast = parsedComponent(source) as unknown as AstNode;
	const declares = propsOf(ast, source);
	if (declares === null)
		refuse(`<${tag} /> renders itself and this compiler cannot read its props`);
	const bindings = new Map<string, string>();
	for (const one of Array.isArray(node['attributes']) ? node['attributes'] : []) {
		if (!isNode(one)) continue;
		if (one['type'] === 'AttachTag') continue;
		if (one['type'] === 'SpreadAttribute') {
			const entries = objectEntries(walk.expand(one['expression']));
			if (entries === null)
				refuse(`<${tag} /> renders itself with a spread nobody can list the keys of`);
			for (const [key, value] of entries) bindings.set(key, `(${value})`);
			continue;
		}
		if (one['type'] !== 'Attribute')
			refuse(`<${tag} /> renders itself with a directive, which is not handled yet`);
		const name = typeof one['name'] === 'string' ? one['name'] : '';
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
		if (parts.length !== 1 || !isNode(only) || only['type'] !== 'ExpressionTag') {
			refuse(
				`<${tag} /> renders itself with \`${name}\` mixing text and an expression, which is not handled yet`,
			);
		}
		bindings.set(name, `(${walk.expand(only['expression'])})`);
	}
	const index = walk.holes.length;
	const binds = propBinds(declares, bindings);
	walk.holes.push({ index, expression: '', raw: true, call: { fragment, binds } });
	const ordinal = walk.site.copies.length;
	// The copy writes the marker itself, from its script, which runs where the call renders; its
	// fragment holds nothing, so the call is to the markup around it what the original was. See
	// `marks()`.
	const at = resolvePath(dirname(walk.site.file), `__seam-call-${String(index)}.svelte`);
	const head = callsHead(walk, fragment, binds);
	// The anchor the original had and the stand-in would not, pushed from inside so that it lands
	// where Svelte would have pushed it: at the end of what the component wrote. Only where the
	// stand-in is the one node in its fragment, since anywhere else Svelte writes it for us, and
	// not where a `--custom` property is set, which is the other thing that suppresses it.
	const anchored =
		itself &&
		walk.alone === node &&
		!(Array.isArray(node['attributes']) ? node['attributes'] : []).some(
			(one) => isNode(one) && String(one['name'] ?? '').startsWith('--'),
		);
	const stand =
		`<script>${marks(index)};${head === null ? '' : `${marksHead(head)};`}` +
		`${anchored ? `${writes('<!---->')};` : ''}</script>`;
	// Written rather than rewritten, so it has no edits and no render changes it. See `rechosen`.
	walk.site.copies.push({
		file: walk.site.file,
		at,
		source: stand,
		raw: stand,
		inner: [],
		within: [...walk.within],
	});
	rename(walk, node, tag, at, ordinal, dynamic);
}

/**
 * The second hole a call of a headed fragment gets: a call of the fragment's head half, whose
 * marker the stand-in writes into the head stream as it writes the body's into the body. The call
 * writes a head where it sits, so every block it sits inside stands in the head stream too, as one
 * a `<svelte:head>` was walked inside does. Null for a fragment that writes none.
 */
export function callsHead(walk: Walk, fragment: string, binds: [string, string][]): number | null {
	if (!walk.site.headedFragments.has(fragment)) return null;
	const head = walk.holes.length;
	walk.holes.push({
		index: head,
		expression: '',
		raw: true,
		call: { fragment: `${fragment}h`, binds },
	});
	for (const [index] of walk.within) {
		if (walk.blocks[index]?.kind !== 'element') walk.site.headed.add(index);
	}
	return head;
}

/**
 * Whether a component's imports lead back to its own file: it renders itself one or more
 * components removed, `A` rendering `B` rendering `A`, which is the shape `importsItself` reads
 * one level up. Every component on such a cycle is entered as a fragment, so that whichever of
 * them the walk meets again while it is on the stack is a call. Each file's `.svelte` imports
 * are read once for the process: a package's tree is asked this for every component in it, and
 * the files do not change under a compile.
 */
const IMPORTS_OF: Map<string, string[]> = new Map();

/** The `.svelte` files one imports, read once per process and held in `IMPORTS_OF`. */
function componentEdges(from: string, source?: string): string[] {
	const held = IMPORTS_OF.get(from);
	if (held !== undefined) return held;
	let text = source;
	if (text === undefined) {
		try {
			text = readFileSync(from, 'utf8');
		} catch {
			text = '';
		}
	}
	const found: string[] = [];
	for (const one of importedBy(text).values()) {
		let target: string | null = null;
		if (one.from.startsWith('.')) {
			if (one.from.endsWith('.svelte')) target = resolvePath(dirname(from), one.from);
		} else if (one.kind !== 'namespace') {
			const name = one.kind === 'default' ? 'default' : (one.exported ?? one.local);
			target = componentOf(one.from, [name], from);
		}
		if (target !== null && target.endsWith('.svelte')) found.push(target);
	}
	IMPORTS_OF.set(from, found);
	return found;
}

export function reachesItself(file: string, raw: string): boolean {
	const seen = new Set<string>();
	const pending = componentEdges(file, raw).slice();
	for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
		if (next === file) return true;
		if (seen.has(next)) continue;
		seen.add(next);
		pending.push(...componentEdges(next));
	}
	return false;
}

/**
 * Whether a fragment's first node, whitespace aside, is text or an expression: what `is_text_first`
 * in `clean_nodes` asks before writing an empty comment ahead of a snippet's or component's body.
 */
export function opensWithText(fragment: unknown): boolean {
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const first = nodes.find(
		(one) => isNode(one) && !(one['type'] === 'Text' && /^\s*$/.test(String(one['data'] ?? ''))),
	);
	return isNode(first) && (first['type'] === 'Text' || first['type'] === 'ExpressionTag');
}

/**
 * The one node a fragment holds, where it holds one, which is what `is_standalone` turns on.
 *
 * Read out of `clean_nodes` in `3-transform/utils.js`: a comment goes, a `{@const}`, a
 * `{#snippet}`, a `<svelte:head>`, a `<title>` and the window-ish elements are hoisted out, and
 * whitespace-only text is dropped from either end. What is left is `trimmed`, and a fragment whose
 * `trimmed` is one component or one static render tag lets Svelte use the parent block's anchor
 * rather than writing one after the child. See `selfCall`.
 */
const HOISTED: ReadonlySet<string> = new Set([
	'ConstTag',
	'DeclarationTag',
	'DebugTag',
	'SvelteBody',
	'SvelteWindow',
	'SvelteDocument',
	'SvelteHead',
	'TitleElement',
	'SnippetBlock',
]);

/** A text node that is whitespace and nothing else. */
function blank(one: unknown): boolean {
	return isNode(one) && one['type'] === 'Text' && !/\S/.test(String(one['data'] ?? ''));
}

export function onlyChild(fragment: unknown): unknown {
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const regular = nodes.filter(
		(one) => isNode(one) && one['type'] !== 'Comment' && !HOISTED.has(String(one['type'])),
	);
	let from = 0;
	let to = regular.length;
	while (from < to && blank(regular[from])) from += 1;
	while (to > from && blank(regular[to - 1])) to -= 1;
	return to - from === 1 ? regular[from] : null;
}

/** Whether a snippet renders itself: one of its `{@render}` calls sits inside its own body. */
export function recurses(one: Snippet): boolean {
	const declared = one.node === undefined ? null : span(one.node);
	if (declared === null) return false;
	return one.calls.some((call) => {
		const where = span(call);
		return where !== null && where[0] > declared[0] && where[1] < declared[1];
	});
}

/** The names a fragment's parameters bind, one plain name each; a pattern is refused. */

/**
 * What a call binds each parameter to: the argument as written, `undefined` where none is, and
 * the default where the parameter has one and the argument is `undefined`, as JavaScript does.
 */
export function parameterBinds(
	parameters: readonly unknown[],
	args: readonly unknown[],
	expand: Locals['rewrite'],
	what: () => string,
): [string, string][] {
	const found: [string, string][] = [];
	for (const [at, parameter] of parameters.entries()) {
		if (!isNode(parameter)) refuse(`${what()} takes a parameter this compiler cannot read`);
		// An argument not written is `undefined`, which is what the function receives and what a
		// default answers to; a default on the parameter itself wraps whatever the pattern inside
		// then takes apart.
		const given = at < args.length ? `(${expand(args[at])})` : 'undefined';
		const defaulted = parameter['type'] === 'AssignmentPattern';
		const target = defaulted ? parameter['left'] : parameter;
		let argument = given;
		if (defaulted) {
			const fallback = `(${expand(parameter['right'])})`;
			argument =
				given === 'undefined' ? fallback : `(${given} === undefined ? ${fallback} : ${given})`;
		}
		if (!isNode(target)) refuse(`${what()} takes a parameter this compiler cannot read`);
		for (const [name, reached] of takenApart(target, argument, expand, what)) {
			found.push([name, reached]);
		}
	}
	return found;
}

/**
 * A call of a fragment where a `{@render}` stood: a hole the render writes a marker for, through a
 * stand-in snippet whose whole body is the marker, so that the render tag stays a render tag and
 * Svelte writes around it what it writes around any.
 */
export function standIn(
	walk: Walk,
	at: [number, number],
	fragment: string,
	binds: [string, string][],
): void {
	const index = walk.holes.length;
	walk.holes.push({ index, expression: '', raw: true, call: { fragment, binds } });
	// The stand-in writes the marker itself, from a `{@const}` in its init, so its fragment holds
	// nothing and the render tag stays what the original was to the markup around it: alone in
	// its block or not, and first in it or not. See `marks()`.
	const name = `__seam_call_${String(index)}`;
	walk.edits.push([at[0], at[1], `{@render ${name}()}`]);
	const head = callsHead(walk, fragment, binds);
	walk.edits.push([
		walk.source.length,
		walk.source.length,
		`\n{#snippet ${name}()}{@const __seam_m${String(index)} = ${marks(index)}}` +
			`${head === null ? '' : `{@const __seam_h${String(head)} = ${marksHead(head)}}`}{/snippet}`,
	]);
}

/** A callee written as a name or as one member of one, `$derived.by`, and '' for anything else. */
export function calleeName(callee: Record<string, unknown>): string {
	if (callee['type'] === 'Identifier') return String(callee['name']);
	if (
		callee['type'] === 'MemberExpression' &&
		isNode(callee['object']) &&
		callee['object']['type'] === 'Identifier' &&
		isNode(callee['property'])
	) {
		return `${String(callee['object']['name'])}.${String(callee['property']['name'])}`;
	}
	return '';
}

export function contains(node: unknown, type: string): boolean {
	if (Array.isArray(node)) return node.some((one) => contains(one, type));
	if (!isNode(node)) return false;
	if (node['type'] === type) return true;
	return Object.values(node).some((one) => contains(one, type));
}

/** One plain name, which is what a settled dynamic component is when it is one import. */
export const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Refuses a component tag whose name this walk decides, saying which of the two questions it is.
 *
 * The name is `member_id(node.name)` visited, so only its root is a read; the members are property
 * accesses off whatever that is. A root the walk binds per item is a component chosen per item,
 * which a block can express and a page-wide enumeration cannot. A root the request decides is a
 * component off the wire, which the payload does not carry.
 */
export function naming(tag: string, walk: Walk): void {
	const head = tag.split('.')[0] ?? '';
	if (head === '' || !walk.dynamic.has(head)) return;
	// A name a block binds, told apart from one the payload carries the way `stands()` tells them
	// apart: the decision is made per item and there is no page-wide domain to enumerate.
	if (walk.site.payload?.has(head) !== true && !walk.fresh.includes(head)) {
		refuse(
			`\`<${tag} />\` names a component through \`${head}\`, which a block binds, so which ` +
				'component it is is decided per item and cannot be enumerated for the page. Write the ' +
				'choice as an `{#if}` around each component, which is a block and is taken per item. ' +
				'See spec/derivation.md',
		);
	}
	choosing(head, tag, walk);
}

/**
 * Whether a component the request hands in, which the source names none of, is refused at the build
 * rather than rendered as nothing and thrown on per request. Off unless the project asks. See
 * spec/payload.md.
 */
export let refusingUnnamed = false;

export function configureUnnamedComponents(enabled: boolean): void {
	refusingUnnamed = enabled;
}

export function choosing(written: string, tag: string, walk: Walk): string {
	const chosen = settled(written, walk);
	if (mentions(chosen, walk.dynamic)) {
		refuse(
			`\`<${tag}>\` is handed a component the request decides, and the source names none it ` +
				'could be. An artifact holds bytes for the components the source names and none for ' +
				'one the request sends, and this project asked to be told at the build ' +
				'(`refuseUnnamedComponents`) rather than to render nothing or throw per request. Name ' +
				"it in the source -- as the prop's default, or beside the value in the expression -- " +
				'or choose it in the load stage. It stands for ' +
				`\`${chosen.replace(/\s+/g, ' ').slice(0, 200)}\`. See spec/payload.md`,
		);
	}
	return chosen;
}

/**
 * An expression with the parentheses that wrap the whole of it taken off.
 *
 * They say nothing about what it is. `expand` puts a pair around every name it substitutes, so a
 * `this` that settles to one import comes back as `(Foo)` and an identifier test read it as an
 * expression: the tag was written out for Svelte and the child never entered, which left `bind:x`
 * with no declaration to read.
 */
export function unwrapped(text: string): string {
	let held = text.trim();
	while (held.startsWith('(') && held.endsWith(')')) {
		let depth = 0;
		let wraps = true;
		for (const [at, c] of [...held].entries()) {
			if (c === '(') depth += 1;
			else if (c === ')') depth -= 1;
			if (depth === 0 && at < held.length - 1) {
				wraps = false;
				break;
			}
		}
		if (!wraps) break;
		held = held.slice(1, -1).trim();
	}
	return held;
}

/**
 * A snippet name written so the render tag stays the dynamic one it was.
 *
 * `2-analyze/visitors/RenderTag.js` sets `metadata.dynamic = binding?.kind !== 'normal'`, and
 * `is_standalone` in `3-transform/utils.js` wants a `RenderTag` that is **not** dynamic before it
 * lets the parent block's anchor stand for the tag's own. A callee this walk settles was dynamic --
 * a prop, a member expression, anything but a plain reference to a declared snippet -- so writing
 * the settled name bare made the tag static and dropped the `<!---->` Svelte writes after it.
 * `(0, name)` is not an identifier, so the binding is not looked up and the tag stays dynamic;
 * the call is the same call. Measured.
 *
 * **Only where the tag was dynamic.** A callee that is a plain script declaration is `normal`, so
 * the tag is static and the parent block's anchor stands for it -- wrapping that one wrote a
 * `<!---->` Svelte does not. A prop, an import, a rune declaration and anything that is not an
 * identifier are the other side.
 */
export function stillDynamic(name: string, dynamic: boolean): string {
	return dynamic ? `(0, ${name})` : name;
}

/** Whether a local name is a component: the default import of a `.svelte` file. See `Carried`. */
export function componentImport(local: string, walk: Walk): boolean {
	const held = walk.site.carried.get(local);
	if (held === undefined || held.kind !== 'default') return false;
	return (resolveBare(held.from, walk.site.file) ?? held.from).endsWith('.svelte');
}

/**
 * The one component a value position can hold, following the branches an expression may take.
 *
 * Only the positions whose value is the expression's own value: the right of an `&&`, either side
 * of a `||`, a `??` or a `?:`. A component named anywhere else -- an argument, a property -- is
 * not what the expression evaluates to. Two positions naming different components is a choice
 * wider than one candidate and is not one of these.
 */
export function candidateOf(
	node: unknown,
	walk: Walk,
	through: Set<string>,
	/** What counts as the thing being named: a component this file imports, or a snippet it holds. */
	names: (held: string) => boolean,
): string | null {
	if (!isNode(node)) return null;
	const again = (child: unknown): string | null => candidateOf(child, walk, through, names);
	switch (node['type']) {
		case 'Identifier': {
			const name = typeof node['name'] === 'string' ? node['name'] : '';
			// The name itself, and not a nearer binding of it: `{:then { Component }}` beside
			// `import Component from './Component.svelte'` is one name and two things, and the walk
			// already knows which -- a name something binds is substituted, and a prop or an import
			// is left as written. Measured on `await-with-update-2`, which named the import it had
			// shadowed.
			if (unwrapped(walk.expand(node)) !== name) return null;
			if (names(name)) return name;
			// A prop's default is the value the request did not send, and the request cannot send a
			// function, so a default naming one is the only function this name can hold.
			const held = walk.site.defaults.get(name);
			if (held === undefined || through.has(name)) return null;
			through.add(name);
			return again(held);
		}
		case 'ParenthesizedExpression':
			return again(node['expression']);
		case 'SequenceExpression': {
			const parts = Array.isArray(node['expressions']) ? node['expressions'] : [];
			return again(parts[parts.length - 1]);
		}
		case 'LogicalExpression': {
			// `&&` is its right side or something falsy, which renders nothing either way.
			const right = again(node['right']);
			if (node['operator'] === '&&') return right;
			return agreed(again(node['left']), right);
		}
		case 'ConditionalExpression':
			return agreed(again(node['consequent']), again(node['alternate']));
		default:
			return null;
	}
}

/** Two value positions naming the same component, or no single candidate. */
function agreed(left: string | null, right: string | null): string | null {
	if (left === null) return right;
	if (right === null) return left;
	return left === right ? left : null;
}

/**
 * Every function the source names, each standing for the one thing a derivation can ask of one.
 *
 * A component and a snippet are both functions and the derivation scope is data: the payload
 * carries no function and the carried bundle drops a component on purpose, so neither name is
 * there to read. What either is worth to a derivation is that it exists, which is what the
 * constructs that consume them ask. See spec/payload.md.
 */
export function standsFor(walk: Walk): Map<string, string> {
	const stands = new Map<string, string>();
	for (const [local] of walk.site.carried) {
		if (componentImport(local, walk)) stands.set(local, 'true');
	}
	for (const [named, one] of walk.snippets) {
		if (one.declared) stands.set(named, 'true');
	}
	return stands;
}

/**
 * The one component a `<svelte:component this={...}>` the request decides can render, and the test
 * that says whether it renders it.
 *
 * **The payload carries data and no function**, which is a decision rather than a limit -- see
 * spec/payload.md -- so a component never comes off the wire and the only component `this` can
 * hold is one the source itself names. That closes what read as an open enumeration: the choice
 * has two outcomes, the component the source names and nothing at all, which is an `{#if}` with an
 * empty else. Svelte's server compiles the tag to exactly that shape, `build_inline_component`
 * writing `if (X) { BLOCK_OPEN; X($$renderer, {}); }` against `else { BLOCK_OPEN_ELSE; }`.
 *
 * A request that sends a truthy value that is not a component renders nothing either way: Svelte
 * calls it and throws, and there are no bytes to reproduce. See spec/roadmap.md.
 */
/**
 * A `this` the entry's script run answers, as a chain over the components the file imports.
 *
 * `let component; $: component = componentName === 'Sub' ? Sub : other` is a name the run holds,
 * and which component it holds is decided by identity -- and the run's `Sub` and the walk's are
 * two module instances, so no comparison outside the run can tell. The run captures the imports
 * beside the declarations, so the chain compares inside it:
 * `((component === Sub) ? Sub : component)`, one test per import in source order, the value
 * itself last. Each test is one the request decides, so the walk enumerates it as it does any
 * `?:` between components, the named branch renders that component's bytes, and the last branch
 * is a value the source names none of -- nothing for nothing, a throw per request otherwise, as
 * spec/payload.md has it. `ran()` in skeleton.ts writes both sides of each test as fields of the
 * run. The entry's only: a copy's run is written at each read, and a component reaching a
 * derivation is what `composed()` refuses. See spec/derivation.md, "A component the run chose is
 * compared inside the run".
 */
export function runChosen(expression: unknown, walk: Walk): string | null {
	if (walk.site.copy !== null && walk.site.copy !== undefined) return null;
	if (!isNode(expression) || expression['type'] !== 'Identifier') return null;
	const name = expression['name'];
	if (typeof name !== 'string' || !walk.site.changing.has(name) || !walk.dynamic.has(name)) {
		return null;
	}
	const imports = [...walk.site.carried.keys()].filter((local) => componentImport(local, walk));
	if (imports.length === 0) return null;
	return imports.reduceRight(
		(rest, local) => `((${name} === ${local}) ? ${local} : ${rest})`,
		name,
	);
}

export function chosenComponent(
	expression: unknown,
	walk: Walk,
): { name: string; test: string } | null {
	// A component the script run chose is compared by identity, and the run's copy of a component is
	// not the one a candidate names. See `ranBy` in `descend()`.
	if (walk.expand(expression).includes(`${RUN_NAME}(`)) {
		refuse(
			'a component chosen by a script this compiler runs per request: which component renders is ' +
				'decided by identity, and the run holds its own copy of each, not the one the source ' +
				'names. See spec/derivation.md',
		);
	}
	if (!mentions(settled(walk.expand(expression), walk), walk.dynamic)) return null;
	const through = new Set<string>();
	const name = candidateOf(expression, walk, through, (held) => componentImport(held, walk));
	if (name === null) return null;
	// A default this followed to a component is one the derivation scope cannot hold, so it stands
	// there for what a component is worth to a derivation and nothing more: that it exists.
	for (const one of through) walk.site.stood.add(one);
	// The test asks whether the value is something, and every component is: a function is truthy.
	// So each component the expression names stands for `true` in it, which is also what leaves it
	// evaluable -- `gather()` in the carry package drops a component from the bundle on purpose,
	// so the name is not there for a derivation to read.
	return { name, test: settled(walk.expand(expression, standsFor(walk)), walk) };
}
