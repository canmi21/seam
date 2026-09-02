import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { compile, parse } from 'svelte/compiler';
import { type Locals, locals } from 'ast';
import { sentinel } from './sentinel.ts';

/** One dynamic position, in the order it appears in the source. */
export interface Hole {
	index: number;
	expression: string;
	/** `{@html}`, which is the one thing about a hole the output cannot reveal. */
	raw: boolean;
}

/** Which of Svelte's two output streams something was rendered into. */
export type Stream = 'body' | 'head';

/** One if or each in the source, in document order. */
export interface Block {
	index: number;
	kind: 'if' | 'each';
	/**
	 * Blocks are numbered across the whole source but appear in one stream or the other, and the
	 * bytes give no way to tell which: the same two ifs, one in the head and one in the body,
	 * render identically whichever came first. So the stream is recorded here, where the AST
	 * still says.
	 */
	stream: Stream;
	/** The test of an if, or the source of an each, as written. */
	expression: string;
	/** The name an each binds. */
	item: string | null;
	/** True when the if has an else, which decides whether its alternate holds anything. */
	alternate: boolean;
}

export interface Skeleton {
	/** Every if taken, every each with one item. Holds every consequent and every each body. */
	html: string;
	/**
	 * The other stream. `render()` returns a head as well as a body, and a component that writes
	 * to it produces bytes that belong in the document rather than in the fragment. Carried even
	 * though nothing assembles it yet, because the alternative is reading only the body and
	 * calling that the whole render, which is how a title came to compile and then not exist.
	 */
	head: string;
	/**
	 * One render per if, with that one not taken, holding its alternate. Keyed by block index.
	 * Both streams, because the if may be in either.
	 */
	alternates: Record<string, Rendered>;
	holes: Hole[];
	blocks: Block[];
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
function collect(
	source: string,
	node: unknown,
	holes: Hole[],
	edits: [number, number, string][],
	blocks: Block[],
	taken: (block: number) => boolean,
	stream: Stream,
	/** An expression as the compiler will see it, with declared names already substituted. */
	expand: Locals['rewrite'],
) {
	if (!isNode(node)) return;

	const type = node['type'];
	if (type === 'SvelteHead') {
		for (const child of ((node['fragment'] as AstNode | undefined)?.['nodes'] as unknown[]) ?? []) {
			collect(source, child, holes, edits, blocks, taken, 'head', expand);
		}
		return;
	}
	if (type === 'ExpressionTag' || type === 'HtmlTag') {
		const at = span(node['expression']);
		if (at === null) return;
		const index = holes.length;
		// Where the value lands, and therefore how it is escaped, is read off the render rather
		// than guessed here. A prop passed to a component may end up in text or in an attribute,
		// and only the component knows which.
		holes.push({ index, expression: expand(node['expression']), raw: type === 'HtmlTag' });
		edits.push([at[0], at[1], JSON.stringify(sentinel(index))]);
		return;
	}
	if (type === 'Attribute') {
		const name = typeof node['name'] === 'string' ? node['name'] : '';
		// An event handler is never serialised, so it has no hole and no place in the output.
		if (name.startsWith('on') && name.length > 2) return;
		const value = node['value'];
		const parts = Array.isArray(value) ? value : [value];
		for (const part of parts) collect(source, part, holes, edits, blocks, taken, stream, expand);
		return;
	}
	if (type === 'IfBlock') {
		const at = span(node['test']);
		if (at === null) return;
		const index = blocks.length;
		blocks.push({
			index,
			kind: 'if',
			stream,
			expression: expand(node['test']),
			item: null,
			alternate: node['alternate'] !== null && node['alternate'] !== undefined,
		});
		edits.push([at[0], at[1], taken(index) ? 'true' : 'false']);
		collect(source, node['consequent'], holes, edits, blocks, taken, stream, expand);
		if (isNode(node['alternate'])) {
			// A block inside an else is numbered but never rendered in the baseline, where every
			// if is taken, so the render and the block list would stop lining up. Refused rather
			// than mis-assembled.
			const before = blocks.length;
			collect(source, node['alternate'], holes, edits, blocks, taken, stream, expand);
			if (blocks.length !== before) {
				throw new Error('a block inside an else is not handled by this pass yet');
			}
		}
		return;
	}
	if (type === 'EachBlock') {
		const at = span(node['expression']);
		const context = span(node['context']);
		if (at === null) return;
		blocks.push({
			index: blocks.length,
			kind: 'each',
			stream,
			expression: expand(node['expression']),
			item: context === null ? null : source.slice(context[0], context[1]),
			alternate: false,
		});
		// One element, because the body's own expressions are sentinels and read nothing from it.
		edits.push([at[0], at[1], '[0]']);
		collect(source, node['body'], holes, edits, blocks, taken, stream, expand);
		return;
	}
	if (type === 'AwaitBlock' || type === 'KeyBlock' || type === 'SnippetBlock') {
		throw new Error(`${String(type)} is not handled by this pass yet`);
	}

	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const child of value)
				collect(source, child, holes, edits, blocks, taken, stream, expand);
		} else if (isNode(value) && value['type'] !== undefined) {
			collect(source, value, holes, edits, blocks, taken, stream, expand);
		} else if (isNode(value) && Array.isArray(value['nodes'])) {
			for (const child of value['nodes'])
				collect(source, child, holes, edits, blocks, taken, stream, expand);
		}
	}
}

/**
 * How many titles the source writes, and whether any sits inside a block.
 *
 * A second title overwrites the first by a precedence rule read off the render tree, and two
 * readings of that rule each disagreed with what it actually does, so it is not reproduced: one
 * title, or none. A title inside a block is a separate problem: the title is not part of the
 * block on either side, so the block renders empty and the title is appended regardless, and
 * nothing in the bytes ties the one to the other. See spec/ir.md.
 */
function titles(node: unknown, guarded = false): { found: number; conditional: boolean } {
	if (!isNode(node)) return { found: 0, conditional: false };
	if (node['type'] === 'TitleElement') return { found: 1, conditional: guarded };
	const inside = guarded || node['type'] === 'IfBlock' || node['type'] === 'EachBlock';
	let found = 0;
	let conditional = false;
	const visit = (child: unknown) => {
		const seen = titles(child, inside);
		found += seen.found;
		conditional ||= seen.conditional;
	};
	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const child of value) visit(child);
		} else if (isNode(value)) {
			visit(value);
		}
	}
	return { found, conditional };
}

/**
 * Rewrites the markup so it renders with no data: every expression becomes a string literal
 * holding a sentinel, every if is written as a constant, and every each iterates one element.
 *
 * Svelte does not fold a constant condition away -- `{#if true}` still writes `<!--[0-->` and
 * `{#if false}` still writes `<!--[-1-->` -- so a branch can be chosen by editing the source
 * rather than by threading a prop through the component.
 */
function rewrite(source: string, taken: (block: number) => boolean): Rewritten {
	const ast = parse(source, { modern: true }) as unknown as AstNode;
	const holes: Hole[] = [];
	const blocks: Block[] = [];
	const edits: [number, number, string][] = [];
	const declared = locals(source);

	// A render is given no data, so a declaration reading a prop would evaluate against nothing
	// and crash inside Svelte's own renderer. It has already been substituted into every
	// expression that used it, which leaves it dead here, so the render is handed a literal in
	// its place rather than the expression it stood for.
	for (const [from, to] of declared.reading) edits.push([from, to, 'null']);

	collect(source, ast['fragment'], holes, edits, blocks, taken, 'body', declared.rewrite);

	edits.sort((a, b) => b[0] - a[0]);
	let rewritten = source;
	for (const [start, end, replacement] of edits) {
		rewritten = rewritten.slice(0, start) + replacement + rewritten.slice(end);
	}
	return { rewritten, holes, blocks };
}

/** Both of Svelte's output streams, because reading only one of them loses content silently. */
interface Rendered {
	body: string;
	head: string;
}

interface Rewritten {
	rewritten: string;
	holes: Hole[];
	blocks: Block[];
}

export async function skeleton(entryFile: string): Promise<Skeleton> {
	const file = resolvePath(entryFile);
	const source = readFileSync(file, 'utf8');

	const { found, conditional } = titles(parse(source, { modern: true }) as unknown as AstNode);
	if (found > 1) {
		throw new Error(`this component writes ${found} titles, and only one of them would survive`);
	}
	// The title leaves the block it was written in: the block renders empty and the title is
	// appended after every one of them, so nothing in the bytes says the two go together.
	if (conditional) {
		throw new Error('a title inside a block is not handled yet: the block renders without it');
	}

	// Everything taken: this render holds every consequent and every each body.
	const baseline = rewrite(source, () => true);
	const { body: html, head } = await renderRewritten(file, baseline.rewritten);

	// One more render per if, with that one not taken, for the bytes of its other branch. Its
	// ancestors stay taken, which is what keeps it reachable.
	const alternates: Record<string, Rendered> = {};
	for (const block of baseline.blocks) {
		if (block.kind !== 'if') continue;
		const flipped = rewrite(source, (index) => index !== block.index);
		alternates[String(block.index)] = await renderRewritten(file, flipped.rewritten);
	}

	return { html, head, alternates, holes: baseline.holes, blocks: baseline.blocks };
}

// Staged inside this package, because Svelte's output imports 'svelte/internal/server' and that
// only resolves from a directory where svelte is a dependency. Specifiers are rewritten to
// absolute URLs, so the modules can live anywhere once they are written.
// Bumped per render, because import() caches by URL and two renders of the same component
// would otherwise be the same module: the second configuration would silently return the first.
let generation = 0;

async function renderRewritten(file: string, source: string): Promise<Rendered> {
	const { mkdirSync, readFileSync: read, rmSync, writeFileSync } = await import('node:fs');
	const { basename } = await import('node:path');
	const { fileURLToPath, pathToFileURL } = await import('node:url');
	const { render } = await import('svelte/server');

	const here = dirname(fileURLToPath(import.meta.url));
	const staging = resolvePath(here, '../.build');
	mkdirSync(staging, { recursive: true });
	generation += 1;
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
		const out = resolvePath(staging, `${basename(from, '.svelte')}-${generation}-${written++}.js`);
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
		const { body, head } = render(mod.default as never, { props: {} });
		return { body, head };
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
}
