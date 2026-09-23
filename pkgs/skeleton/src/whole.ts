import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { parse } from 'svelte/compiler';
import { AT_REQUEST, resolved } from 'ast';
import { propsOf } from './compose.ts';
import { isNode, type AstNode } from './node.ts';
import { renderRewritten } from './render.ts';
import type { Skeleton } from './shape.ts';
import { changedBy } from './walk.ts';

/**
 * The page as Svelte renders it, where nothing on it is a request's to decide.
 *
 * A component whose inputs carry no marker is Svelte's to render, which is what `descend()` does
 * with a child it cannot walk. This is the same rule at the root: an entry that takes no props
 * renders the same bytes for every request, so Svelte's own render of it is the whole page. Null
 * where anything reachable could still differ per request. See spec/pipeline.md.
 */
export async function whole(file: string, root: string): Promise<Skeleton | null> {
	const source = readFileSync(file, 'utf8');
	if (!takesNothing(source)) return null;
	const reached = reachable(file);
	if (reached === null || !reached.every(steady)) return null;
	const rendered = await renderRewritten(file, source, root);
	return {
		html: rendered.body,
		head: rendered.head,
		alternates: {},
		payload: [],
		defaults: [],
		eager: [],
		held: [],
		holes: [],
		blocks: [],
		entered: [],
	};
}

/** Whether the entry reads no prop and nothing else the payload carries. */
function takesNothing(source: string): boolean {
	if (/\$\$(?:props|restProps)\b|\$app\//.test(source)) return false;
	let ast: AstNode;
	try {
		ast = parse(source, { modern: true }) as unknown as AstNode;
	} catch {
		return false;
	}
	const props = propsOf(ast, source);
	if (props === null || props.length > 0) return false;
	// A legacy `export let` or `export { a }` is a prop too, which `propsOf` reads only in legacy
	// mode; asked by the word so a file in either mode is covered.
	return !/\bexport\s+(?:let|var|\{)/.test(scripts(ast, source));
}

/** A value a server holds and the build has not, by the word. See `SERVER_HELD` in walk.ts. */
const SERVER_HELD = new RegExp(`(?:^|[^$\\w.])(?:${[...AT_REQUEST].join('|')})\\b`);

/**
 * Whether one reachable file renders the same for every request.
 *
 * Not a value the server holds, not a `hydratable` -- whose script the injector writes per
 * request -- and, for a component, every name its markup reads resolved without a clock, a
 * randomness or a host's global, which is what `resolved()` asks of the entry on the walked path.
 * Module state is asked where it is imported.
 */
function steady(one: { file: string; source: string }): boolean {
	if (SERVER_HELD.test(one.source) || /\bhydratable\b/.test(one.source)) return false;
	if (!one.file.endsWith('.svelte')) return true;
	try {
		resolved(one.source, basename(one.file), one.file);
	} catch {
		return false;
	}
	return true;
}

/**
 * Every file the entry reaches by a relative import, entry first, or null where one could not be
 * read or imports a binding its own module changes -- module state, which a build reads once.
 */
function reachable(entry: string): { file: string; source: string }[] | null {
	const found: { file: string; source: string }[] = [];
	const seen = new Set<string>();
	const pending = [entry];
	while (pending.length > 0) {
		const file = pending.pop()!;
		if (seen.has(file)) continue;
		seen.add(file);
		let source: string;
		try {
			source = readFileSync(file, 'utf8');
		} catch {
			return null;
		}
		found.push({ file, source });
		const declared = importsIn(file, source);
		if (declared === null) return null;
		for (const one of declared) {
			if (!one.from.startsWith('.')) continue;
			const target = located(resolvePath(dirname(file), one.from));
			if (target === null) return null;
			if (one.names.some((name) => changedBy(target).has(name))) return null;
			pending.push(target);
		}
	}
	return found;
}

/** A relative specifier as Vite resolves one written without its extension. */
function located(path: string): string | null {
	for (const one of [path, `${path}.js`, `${path}.ts`, `${path}/index.js`]) {
		if (existsSync(one) && !one.endsWith('/')) return one;
	}
	return null;
}

/** The imports a file declares, with the names each binds by what the module exports them as. */
function importsIn(file: string, source: string): { from: string; names: string[] }[] | null {
	let ast: AstNode;
	try {
		ast = parse(file.endsWith('.svelte') ? source : `<script module lang="ts">${source}</script>`, {
			modern: true,
		}) as unknown as AstNode;
	} catch {
		return null;
	}
	const found: { from: string; names: string[] }[] = [];
	for (const block of [ast['instance'], ast['module']]) {
		const content = isNode(block) ? block['content'] : undefined;
		const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
		for (const node of body) {
			if (!isNode(node) || node['type'] !== 'ImportDeclaration') continue;
			const from = isNode(node['source']) ? node['source']['value'] : undefined;
			if (typeof from !== 'string') continue;
			const specifiers = Array.isArray(node['specifiers']) ? node['specifiers'] : [];
			const names = specifiers.flatMap((one) => {
				if (!isNode(one) || one['type'] !== 'ImportSpecifier') return [];
				const imported = one['imported'];
				return isNode(imported) && typeof imported['name'] === 'string' ? [imported['name']] : [];
			});
			found.push({ from, names });
		}
	}
	return found;
}

/** The text of a component's scripts, instance and module. */
function scripts(ast: AstNode, source: string): string {
	return [ast['instance'], ast['module']]
		.map((block) => {
			if (
				!isNode(block) ||
				typeof block['start'] !== 'number' ||
				typeof block['end'] !== 'number'
			) {
				return '';
			}
			return source.slice(block['start'], block['end']);
		})
		.join('\n');
}
