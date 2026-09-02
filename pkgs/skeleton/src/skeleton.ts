import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { compile, parse } from 'svelte/compiler';
import { sentinel } from './sentinel.ts';

/** One dynamic position, in the order it appears in the source. */
export interface Hole {
	index: number;
	expression: string;
	/** `{@html}`, which is the one thing about a hole the output cannot reveal. */
	raw: boolean;
}

export interface Skeleton {
	/** What Svelte rendered, with a sentinel where each hole is. */
	html: string;
	holes: Hole[];
}

type AstNode = Record<string, unknown>;

function isNode(value: unknown): value is AstNode {
	return typeof value === 'object' && value !== null;
}

function span(node: unknown): [number, number] | null {
	if (!isNode(node)) return null;
	const { start, end } = node;
	if (typeof start !== 'number' || typeof end !== 'number') return null;
	return [start, end];
}

/**
 * Every expression in the markup becomes a string literal holding a sentinel, so the component
 * renders without any data and the output carries a marker wherever a value would have gone.
 *
 * Blocks are not handled here. An if or an each needs one render per branch, which is a
 * different shape of problem from replacing a value in place.
 */
function collect(source: string, node: unknown, holes: Hole[], edits: [number, number, string][]) {
	if (!isNode(node)) return;

	const type = node['type'];
	if (type === 'ExpressionTag' || type === 'HtmlTag') {
		const at = span(node['expression']);
		if (at === null) return;
		const index = holes.length;
		// Where the value lands, and therefore how it is escaped, is read off the render rather
		// than guessed here. A prop passed to a component may end up in text or in an attribute,
		// and only the component knows which.
		holes.push({ index, expression: source.slice(at[0], at[1]), raw: type === 'HtmlTag' });
		edits.push([at[0], at[1], JSON.stringify(sentinel(index))]);
		return;
	}
	if (type === 'Attribute') {
		const name = typeof node['name'] === 'string' ? node['name'] : '';
		// An event handler is never serialised, so it has no hole and no place in the output.
		if (name.startsWith('on') && name.length > 2) return;
		const value = node['value'];
		const parts = Array.isArray(value) ? value : [value];
		for (const part of parts) collect(source, part, holes, edits);
		return;
	}
	if (type === 'IfBlock' || type === 'EachBlock' || type === 'AwaitBlock' || type === 'KeyBlock') {
		throw new Error(`${String(type)} is not handled by this pass yet`);
	}

	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const child of value) collect(source, child, holes, edits);
		} else if (isNode(value) && value['type'] !== undefined) {
			collect(source, value, holes, edits);
		} else if (isNode(value) && Array.isArray(value['nodes'])) {
			for (const child of value['nodes']) collect(source, child, holes, edits);
		}
	}
}

function rewrite(source: string): { rewritten: string; holes: Hole[] } {
	const ast = parse(source, { modern: true }) as unknown as AstNode;
	const holes: Hole[] = [];
	const edits: [number, number, string][] = [];
	collect(source, ast['fragment'], holes, edits);

	edits.sort((a, b) => b[0] - a[0]);
	let rewritten = source;
	for (const [start, end, replacement] of edits) {
		rewritten = rewritten.slice(0, start) + replacement + rewritten.slice(end);
	}
	return { rewritten, holes };
}

export async function skeleton(entryFile: string): Promise<Skeleton> {
	const file = resolvePath(entryFile);
	const { rewritten, holes } = rewrite(readFileSync(file, 'utf8'));
	const html = await renderRewritten(file, rewritten);
	return { html, holes };
}

// Staged inside this package, because Svelte's output imports 'svelte/internal/server' and that
// only resolves from a directory where svelte is a dependency. Specifiers are rewritten to
// absolute URLs, so the modules can live anywhere once they are written.
async function renderRewritten(file: string, source: string): Promise<string> {
	const { mkdirSync, readFileSync: read, rmSync, writeFileSync } = await import('node:fs');
	const { basename } = await import('node:path');
	const { fileURLToPath, pathToFileURL } = await import('node:url');
	const { render } = await import('svelte/server');

	const here = dirname(fileURLToPath(import.meta.url));
	const staging = resolvePath(here, '../.build');
	mkdirSync(staging, { recursive: true });
	let written = 0;

	function emit(from: string, code: string, origin: string): string {
		for (const match of code.matchAll(/from\s+'(\.[^']*)'/g)) {
			const specifier = match[1];
			if (specifier === undefined) continue;
			const target = resolvePath(dirname(origin), specifier);
			const replacement = specifier.endsWith('.svelte')
				? emit(target, compileFile(target), target)
				: target;
			code = code.replaceAll(`'${specifier}'`, JSON.stringify(pathToFileURL(replacement).href));
		}
		const out = resolvePath(staging, `${basename(from, '.svelte')}-${written++}.js`);
		writeFileSync(out, code);
		return out;
	}

	function compileFile(target: string): string {
		return compile(read(target, 'utf8'), {
			generate: 'server',
			name: basename(target, '.svelte'),
			filename: target,
		}).js.code;
	}

	try {
		const entry = emit(
			file,
			compile(source, {
				generate: 'server',
				name: 'Entry',
				filename: file,
			}).js.code,
			file,
		);
		const mod = (await import(pathToFileURL(entry).href)) as { default: unknown };
		return render(mod.default as never, { props: {} }).body;
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
}
