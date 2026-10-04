/**
 * What a component declares that hydrates, and what the walk composes around it: the `hydratable`
 * values the head script carries, the imports that name them, and the renders that stand in.
 * See spec/derivation.md.
 */
import { readFileSync } from 'node:fs';
import { parse } from 'svelte/compiler';
import { stamp } from './sentinel.ts';
import { resolve as resolvePath } from 'node:path';
import { importsOf, readsOf, resolveBare, bound } from '@seam-js/ast';
import { isNode, refuse } from './node.ts';
import type { Block, Rendered } from './shape.ts';

/** Every name a component's scripts declare or import at their top level, by file, once. */
const declaredNames = new Map<string, ReadonlySet<string>>();

export function declaredIn(file: string): ReadonlySet<string> {
	const held = declaredNames.get(file);
	if (held !== undefined) return held;
	const found = new Set<string>();
	try {
		const ast = parse(readFileSync(file, 'utf8'), { modern: true }) as unknown as Record<
			string,
			unknown
		>;
		for (const block of [ast['module'], ast['instance']]) {
			const content = isNode(block) ? block['content'] : undefined;
			const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
			for (const statement of body) {
				if (!isNode(statement)) continue;
				const declaration =
					statement['type'] === 'ExportNamedDeclaration' && isNode(statement['declaration'])
						? statement['declaration']
						: statement;
				if (declaration['type'] === 'ImportDeclaration') {
					const specifiers = declaration['specifiers'];
					for (const one of Array.isArray(specifiers) ? specifiers : []) {
						if (isNode(one) && isNode(one['local'])) bound(one['local'], found);
					}
				} else if (declaration['type'] === 'VariableDeclaration') {
					const declarations = declaration['declarations'];
					for (const one of Array.isArray(declarations) ? declarations : []) {
						if (isNode(one)) bound(one['id'], found);
					}
				} else if (isNode(declaration['id'])) {
					bound(declaration['id'], found);
				}
			}
		}
	} catch {
		// A file that does not parse declares nothing this can read; the compile has said so already.
	}
	declaredNames.set(file, found);
	return found;
}

/** The name one script block imports Svelte's `hydratable` under, or null. */
function hydratableIn(block: unknown): string | null {
	const content = isNode(block) ? block['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'ImportDeclaration') continue;
		if (!isNode(statement['source']) || statement['source']['value'] !== 'svelte') continue;
		const specifiers = statement['specifiers'];
		for (const one of Array.isArray(specifiers) ? specifiers : []) {
			if (!isNode(one) || !isNode(one['imported']) || !isNode(one['local'])) continue;
			if (one['imported']['name'] !== 'hydratable') continue;
			if (typeof one['local']['name'] === 'string') return one['local']['name'];
		}
	}
	return null;
}

/**
 * The name the instance script imports Svelte's `hydratable` under, and whether the module script
 * imports it too, which the run cannot hand the request's: the two blocks are one module once
 * compiled.
 */
export function hydratableImport(source: string): { local: string | null; module: boolean } {
	const ast = parse(source, { modern: true }) as unknown as Record<string, unknown>;
	return {
		local: hydratableIn(ast['instance']),
		module: hydratableIn(ast['module']) !== null,
	};
}

/**
 * A render with the stamp of each block Svelte wraps in a child block moved inside that wrapper.
 *
 * `create_child_block` writes `<!--[-->` and `<!--]-->` around a block whose source or test awaits,
 * so its close sits between the block's own close and the stamp, and the assembler, which takes
 * the close before a stamp as the block's, took the wrapper for the block: every item of an each
 * came out wrapped in a pair of its own. Moving the stamp one close in leaves the wrapper's close as
 * the bytes around the block it is. Letting the assembler step over a close instead was tried and
 * is wrong for every block that has none -- see spec/readings.md -- which is why the walk says which
 * block has one.
 */
export function tucked(rendered: Rendered, blocks: readonly Block[]): Rendered {
	let { body, head } = rendered;
	for (const one of blocks) {
		if (one.wrapped !== true) continue;
		const at = stamp(one.index);
		body = body.replace(`<!--]-->${at}`, `${at}<!--]-->`);
		head = head.replace(`<!--]-->${at}`, `${at}<!--]-->`);
	}
	return { ...rendered, body, head };
}

/**
 * The render without the script `hydratable` values went into, which the injector writes per request.
 *
 * `#render_async` prepends it to the head as `\n\t\t<script>` (or `<script nonce=...>`), the
 * entries and `</script>`, and the values in it are the build's -- the sentinels a request's would
 * have been, run once. So it is taken off and the injector writes the request's own, from the
 * record the derivations filled. See `Skeleton.eager`.
 *
 * Refused where the render wrote more keys than the entry's script makes calls: a key the walk did
 * not see made is one no derivation would make per request, a child's `hydratable` or one behind
 * a function the script called, and the script would come out without it.
 */
export function unhydrated(rendered: Rendered, calls: number): Rendered {
	const opens = '\n\t\t<script';
	const closes = '</script>';
	if (!rendered.head.startsWith(opens)) return rendered;
	const end = rendered.head.indexOf(closes);
	if (end === -1) return rendered;
	const script = rendered.head.slice(0, end);
	// One entry per line inside the `for` over them, as `#hydratable_block` joins them.
	const listed = /for \(const \[k, v\] of \[\n([\s\S]*?)\n\t*\]\)/.exec(script)?.[1] ?? '';
	const keys = listed.split(',\n').length;
	if (keys > calls) {
		refuse(
			`a \`hydratable\` call this compiler cannot see made: the render wrote ${String(keys)} ` +
				`key${keys === 1 ? '' : 's'} and the entry's script makes ${String(calls)} call` +
				`${calls === 1 ? '' : 's'}. One inside a child component, or behind a function the script ` +
				'calls, is made per request by nothing. See spec/derivation.md',
		);
	}
	return { ...rendered, head: rendered.head.slice(end + closes.length) };
}

/**
 * Refuses a derivation that reads a component, which is the half of resolution this is the place for.
 *
 * A component import resolves -- the file imports it and the copy this compiler stages keeps the
 * import, so a component handed to a child as a prop is a value the build has. What the bundle
 * cannot hold is the same name: `carriedBy()` skips a default `.svelte` import because a component
 * is composed at compile time and is never a value an expression calls, and a derivation is
 * evaluated outside the render with only what the bundle carries. So the one shape that has to be
 * refused is a component reaching an expression the artifact holds.
 *
 * Asked here rather than in `bindings.ts`, for the same reason the rule about a value the render
 * changes is: over the finished list, which is the one place that holds every expression. Asked at
 * the name, it refused `runtime-legacy/transition-css-iframe` -- `<Frame component={Foo}/>` over a
 * `Foo` two lines above it in an `import` -- for a name the data does not carry. See
 * spec/derivation.md.
 */
export function composed(
	expressions: readonly { expression: string; files: string[] }[],
	root: string,
): void {
	const components = new Map<string, ReadonlySet<string>>();
	const held = (file: string): ReadonlySet<string> => {
		const found = components.get(file);
		if (found !== undefined) return found;
		const at = resolvePath(root, file);
		const names = new Set<string>();
		let source: string;
		try {
			source = readFileSync(at, 'utf8');
		} catch {
			components.set(file, names);
			return names;
		}
		for (const [local, one] of importsOf(source)) {
			if (one.kind !== 'default') continue;
			if ((resolveBare(one.from, at) ?? one.from).endsWith('.svelte')) names.add(local);
		}
		components.set(file, names);
		return names;
	};
	for (const one of expressions) {
		const names = readsOf([one.expression]);
		for (const file of one.files) {
			for (const name of names) {
				if (!held(file).has(name)) continue;
				throw new Error(
					`\`${name}\` is a component read by an expression this artifact holds, and a ` +
						'derivation is evaluated outside the render with only what the bundle carries. A ' +
						'component is composed at compile time and is not a value the bundle can hold, so ' +
						'the choice has to be written as an `{#if}` around each component. The expression: ' +
						`\`${one.expression.replace(/\s+/g, ' ').slice(0, 160)}\`. See spec/derivation.md`,
				);
			}
		}
	}
}
