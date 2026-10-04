/**
 * Which file a component tag names, and what a component's module exports: resolution through
 * the project and its packages, before anything about the component's shape is asked.
 * See spec/refusals.md.
 */
import { importsOf as importedBy } from '@seam-js/ast';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { apply, componentOf, parsedComponent, reads as readsIn, bound } from '@seam-js/ast';
import { type AstNode, isNode, span } from './node.ts';
import type { Walk } from './walk-types.ts';

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
