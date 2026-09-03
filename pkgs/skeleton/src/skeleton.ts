import { readFileSync } from 'node:fs';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { compile, parse } from 'svelte/compiler';
import { apply, type Locals, locals, resolved } from 'ast';
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
 * Markup that reaches the server and writes nothing, so the walk steps over it.
 *
 * Each of these is measured rather than assumed: `conformance/cases/inert.svelte` holds them all
 * and its expected bytes are Svelte's own.
 */
const INERT = new Set([
	'Comment',
	'SvelteWindow',
	'SvelteBody',
	'SvelteDocument',
	'SvelteOptions',
	'OnDirective',
	'UseDirective',
	'TransitionDirective',
	'AnimateDirective',
	'DebugTag',
]);

/**
 * Markup this pass has not been taught, and what to tell the author about it.
 *
 * Every message names one of the three situations `spec/refusals.md` sets out: the shape is
 * understood and unwritten, the protocol has no answer yet, or there is another way to write it.
 * A refusal that says only that something is wrong has failed.
 */
const REFUSED: Record<string, string> = {
	AwaitBlock:
		'`{#await}` is not handled yet. A synchronous render always takes its pending branch, which ' +
		'is measured and small',
	KeyBlock: '`{#key}` is not handled yet. Its only effect is on the client, and it is measured',
	SnippetBlock: '`{#snippet}` is not handled yet. It is inlining, which composition already does',
	RenderTag: '`{@render}` is not handled yet. It is inlining, which composition already does',
	ConstTag:
		'`{@const}` is not handled yet. It declares a name inside a block, which is the substitution ' +
		'a script declaration already gets, applied one scope further in',
	SvelteElement:
		'`<svelte:element>` takes its tag from a value, so which bytes exist is decided at request ' +
		'time and the outcomes cannot be enumerated at compile time. It needs a closed runtime node, ' +
		'which is not decided',
	SvelteBoundary: '`<svelte:boundary>` is not handled yet',
	SvelteFragment: '`<svelte:fragment>` is not handled yet',
	SvelteSelf: '`<svelte:self>` is not handled yet: composition does not yet follow a cycle',
	SvelteComponent: '`<svelte:component>` chooses a component from a value, which is not decided',
	SlotElement: '`<slot>` is not handled yet. Snippets replaced it, and neither is written',
	SpreadAttribute:
		'`{...}` spreads whichever keys the data carries, so the attributes that exist are decided ' +
		'at request time and cannot be enumerated at compile time. It needs a closed runtime node, ' +
		'which is not decided',
	BindDirective:
		'`bind:` is not handled yet. On the server it is an ordinary attribute, and this pass does ' +
		'not plant a hole in one yet',
	ClassDirective:
		'`class:` is not handled yet. It is a decision over two outcomes and so is enumerable; it is ' +
		'deferred on what it is worth rather than blocked',
	StyleDirective:
		'`style:` is not handled yet. It is a decision over two outcomes and so is enumerable; it is ' +
		'deferred on what it is worth rather than blocked',
	LetDirective: '`let:` is not handled yet. It belongs with slots, and neither is written',
	AttachTag: '`{@attach}` is not handled yet. It runs on the client and writes no bytes',
};

/** What a refusal says, in one shape, so the reader always learns where the question lives. */
function refuse(what: string): never {
	throw new Error(`${what}. See spec/refusals.md`);
}

/**
 * Every expression in the markup becomes a string literal holding a sentinel, so the component
 * renders without any data and the output carries a marker wherever a value would have gone.
 *
 * Blocks are not handled here. An if or an each needs one render per branch, which is a
 * different shape of problem from replacing a value in place.
 *
 * **It is an allowlist, and the default is to stop.** This used to handle what it knew and then
 * recurse over every property of anything else, which looked thorough and was the opposite: a
 * construct it had never been taught descended quietly, planted nothing, and rendered wrong.
 * `{@const}`, an each block's index and its `{:else}` were all found that way, by rendering them
 * beside Svelte rather than by reading this code. A type that is not named below stops the
 * compilation and says which type it was, so the next one is found by the first author who writes
 * it instead of by a page that is quietly missing something.
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
	if (typeof type !== 'string') {
		refuse('a markup node with no type reached the compiler, which cannot happen');
	}

	const walk = (child: unknown, into: Stream = stream): void => {
		collect(source, child, holes, edits, blocks, taken, into, expand);
	};
	const fragment = (of: unknown, into: Stream = stream): void => {
		if (!isNode(of)) return;
		const nodes = of['nodes'];
		if (!Array.isArray(nodes)) return;
		for (const child of nodes) walk(child, into);
	};

	if (INERT.has(type)) return;
	const why = REFUSED[type];
	if (why !== undefined) refuse(why);

	switch (type) {
		case 'Fragment':
			fragment(node);
			return;

		case 'Text':
			return;

		case 'SvelteHead':
			// The other stream. Everything under it renders into the head rather than the body.
			fragment(node['fragment'], 'head');
			return;

		case 'ExpressionTag':
		case 'HtmlTag': {
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

		case 'RegularElement':
		case 'Component':
		case 'TitleElement': {
			const attributes = node['attributes'];
			if (Array.isArray(attributes)) for (const attr of attributes) walk(attr);
			fragment(node['fragment']);
			return;
		}

		case 'Attribute': {
			const name = typeof node['name'] === 'string' ? node['name'] : '';
			// An event handler is never serialised, so it has no hole and no place in the output.
			if (name.startsWith('on') && name.length > 2) return;
			const value = node['value'];
			// A bare name, which is the attribute being present rather than valued.
			if (value === true) return;
			const parts = Array.isArray(value) ? value : [value];
			// Svelte puts a handful of attribute values through a replacement table on the way out,
			// and `translate` is the only entry in it: `true` is written `"yes"`. A static string is
			// unaffected and passes; anything the table would touch does not, because reproducing a
			// one-entry table is a decision nobody has taken. See spec/ir.md.
			if (name === 'translate' && !parts.every((part) => isNode(part) && part['type'] === 'Text')) {
				refuse(
					'`translate` with a value that is not plain text is not handled yet: Svelte writes ' +
						'`true` as `"yes"` through a replacement table this does not reproduce',
				);
			}
			for (const part of parts) walk(part);
			return;
		}

		case 'IfBlock': {
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
			walk(node['consequent']);
			if (isNode(node['alternate'])) {
				// A block inside an else is numbered but never rendered in the baseline, where every
				// if is taken, so the render and the block list would stop lining up. Refused rather
				// than mis-assembled.
				const before = blocks.length;
				walk(node['alternate']);
				if (blocks.length !== before) {
					refuse(
						'a block inside an else is not handled yet: it is numbered but never appears in ' +
							'the baseline render, so the render and the block list would stop lining up',
					);
				}
			}
			return;
		}

		case 'EachBlock': {
			// Three fields the protocol has no use for yet, and each of them changes the bytes. The
			// written-bytes pass refused all three; this one inherited none of the refusals and
			// silently rendered an each without its index and an empty each without its `{:else}`.
			if (node['fallback'] !== null && node['fallback'] !== undefined) {
				refuse(
					'`{:else}` on an each block is not handled yet: the baseline render iterates one ' +
						'element, so the branch for an empty list never appears in it',
				);
			}
			if (typeof node['index'] === 'string') {
				refuse('an each block with an index is not handled yet');
			}
			if (node['key'] !== null && node['key'] !== undefined) {
				refuse('an each block with a key is not handled yet');
			}
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
			walk(node['body']);
			return;
		}

		default:
			refuse(
				`\`${source.slice(...(span(node) ?? [0, 0])).slice(0, 60)}\` is a ${type}, which the ` +
					'compiler has not been taught. Nothing is refused on principle, so this is a gap ' +
					'rather than a boundary',
			);
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
	for (const [[from, to], empty] of declared.reading) edits.push([from, to, empty]);

	collect(source, ast['fragment'], holes, edits, blocks, taken, 'body', declared.rewrite);

	return { rewritten: apply(source, edits), holes, blocks };
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

/**
 * Svelte's runtime, checked to be the one a server ships.
 *
 * `{@html}` opens its block with `<!---->` in production and with a hash of the value in
 * development, so which build of Svelte was imported changes the bytes this pass renders -- and
 * those bytes go into the IR. A hash of a sentinel is a hash of a value nobody will ever hold, so
 * the artifact would be wrong for every payload rather than for an unusual one.
 *
 * Which build is loaded comes from `NODE_ENV`, two dependencies down: Svelte reads `DEV` from
 * `esm-env`, whose fallback is true for any `NODE_ENV` that is set and does not begin with
 * `prod`. Unset, as it is under a mise task, gives production. A test runner sets it to `test` and
 * `vite dev` sets it to `development`, and the compiler is going to run inside a Vite plugin.
 *
 * Measured rather than reasoned about. The rule lives in a dependency of a dependency and could
 * change without anybody here noticing; the one call below is the behaviour itself.
 */
let checked = false;
async function shippable(): Promise<void> {
	if (checked) return;
	const { html } = await import('svelte/internal/server');
	const open = html('x');
	if (open !== '<!---->x<!---->') {
		throw new Error(
			`Svelte's development runtime is loaded: it writes \`${open}\` where a server writes ` +
				'`<!---->x<!---->`, and the compiler would write that into the IR. The build is chosen ' +
				'by NODE_ENV, which has to be `production` for a compile. See spec/pipeline.md',
		);
	}
	checked = true;
}

/**
 * `root` is handed to Svelte as `rootDir`, and it decides bytes rather than diagnostics.
 *
 * Two things Svelte writes are hashes of the component's filename: the anchor that opens a
 * `<svelte:head>` block, and the class that scopes a `<style>`. Before hashing, it makes the
 * filename relative to `rootDir`, which defaults to `process.cwd()` -- so left alone, the
 * directory the build ran from is in the response, and one component compiled from three
 * directories gets three different hashes.
 *
 * The client half hashes the same name and compares: `head()` in Svelte's client checks the
 * anchor's text against the hash it was compiled with, and gives up if they differ. So `rootDir`
 * is not a nicety on one side of the build; it is what makes the two sides agree. Passing it, and
 * leaving `filename` absolute, is Svelte's own answer -- the filename stays real for errors and
 * source maps. See spec/build.md.
 */
export async function skeleton(entryFile: string, root: string): Promise<Skeleton> {
	await shippable();
	const file = resolvePath(entryFile);
	const source = readFileSync(file, 'utf8');

	const parsed = parse(source, { modern: true }) as unknown as AstNode;

	// `<style>` hangs off the root rather than off the fragment, so neither pass's walk can see it
	// and neither could refuse it. A styled component compiled, exited zero, wrote Svelte's scoped
	// class into the bytes, and carried the stylesheet nowhere: the page rendered with the class
	// and no rule to match it. Measured, and the fourth defect of that shape in this compiler.
	//
	// What it waits on is named, because that is the difference between a refusal and a wall. How
	// CSS is owned is answered in spec/build.md; what is missing is the half that emits a
	// stylesheet at all, which is the client build the plugin runs.
	if (parsed['css'] !== null && parsed['css'] !== undefined) {
		refuse(
			'a `<style>` block is not handled yet: its scoped class is written into the bytes but ' +
				'nothing emits the stylesheet, so the page would render unstyled. It waits on the ' +
				'plugin, which is what runs the client build; see spec/build.md',
		);
	}

	const { found, conditional } = titles(parsed);
	if (found > 1) {
		throw new Error(
			`this component writes ${found} titles, and which of them wins is not decided; see spec/ir.md`,
		);
	}
	// The title leaves the block it was written in: the block renders empty and the title is
	// appended after every one of them, so nothing in the bytes says the two go together.
	if (conditional) {
		throw new Error(
			'which of two titles wins is not decided, and a title inside a block is that question: the ' +
				'block renders without it. See spec/ir.md',
		);
	}

	// Everything taken: this render holds every consequent and every each body.
	const baseline = rewrite(source, () => true);

	// After the walk, not before it. Every name has to come from somewhere -- this pass renders
	// rather than reading the markup, so a name nothing binds reaches Svelte's own renderer,
	// evaluates to undefined and writes an empty string. But a construct the compiler has not been
	// taught usually binds names of its own: `{#await}` binds its `:then`, a snippet binds its
	// parameters. Checking names first reports the name and hides the construct, which points the
	// author at the wrong thing. The walk above refuses the construct, so what reaches here is a
	// name in markup the compiler does understand.
	resolved(source, basename(file));
	const { body: html, head } = await renderRewritten(file, baseline.rewritten, root);

	// One more render per if, with that one not taken, for the bytes of its other branch. Its
	// ancestors stay taken, which is what keeps it reachable.
	const alternates: Record<string, Rendered> = {};
	for (const block of baseline.blocks) {
		if (block.kind !== 'if') continue;
		const flipped = rewrite(source, (index) => index !== block.index);
		alternates[String(block.index)] = await renderRewritten(file, flipped.rewritten, root);
	}

	return { html, head, alternates, holes: baseline.holes, blocks: baseline.blocks };
}

// Staged inside this package, because Svelte's output imports 'svelte/internal/server' and that
// only resolves from a directory where svelte is a dependency. Specifiers are rewritten to
// absolute URLs, so the modules can live anywhere once they are written.
// Bumped per render, because import() caches by URL and two renders of the same component
// would otherwise be the same module: the second configuration would silently return the first.
let generation = 0;

async function renderRewritten(file: string, source: string, root: string): Promise<Rendered> {
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
			rootDir: root,
		}).js.code;
	}

	try {
		const entry = emit(
			file,
			compile(source, {
				generate: 'server',
				name: 'Entry',
				filename: file,
				rootDir: root,
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
