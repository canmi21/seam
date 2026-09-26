/**
 * The shape of a component's own markup and script, read off its AST: what binds a prop, what
 * calls itself, what reaches itself through imports, what stands as its one child.
 * See spec/refusals.md.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import {
	importsOf as importedBy,
	type Locals,
	componentOf,
	objectEntries,
	parsedComponent,
} from 'ast';
import { propsOf, rename } from './compose.ts';
import { type AstNode, isNode, refuse, span } from './node.ts';
import { marks, marksHead, writes } from './sentinel.ts';
import type { Snippet } from './snippets.ts';
import { takenApart } from './handed.ts';
import type { Walk } from './walk-types.ts';

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
