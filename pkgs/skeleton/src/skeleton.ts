import { readFileSync } from 'node:fs';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { compile, parse } from 'svelte/compiler';
import { apply, destructure, type Locals, locals, resolved } from 'ast';
import { OMITTED_IN_SSR } from './omitted.ts';
import { sentinel } from './sentinel.ts';

/**
 * A decision position: the value chooses which bytes exist rather than being written into them.
 *
 * `tests` are the directive expressions in source order, and `outcomes` holds one finished
 * attribute string per combination of their truthiness, indexed by the bits -- test `i` truthy
 * sets bit `i`. Every string in it came out of Svelte's own `attr_class`, so the joining, the
 * removal branch, the escaping and the empty result that writes no attribute at all are its
 * answers rather than reproductions of them. See spec/refusals.md.
 */
export interface Choice {
	tests: string[];
	outcomes: string[];
}

/** One dynamic position, in the order it appears in the source. */
export interface Hole {
	index: number;
	expression: string;
	/** `{@html}`, which is the one thing about a hole the output cannot reveal. */
	raw: boolean;
	/** Set when the hole is a decision rather than a substitution. */
	choice?: Choice;
}

/**
 * What a class decision needs before the render, which is everything but the scoping hash.
 *
 * The hash is a hash of the filename and of the stylesheet, and Svelte appends it to the class
 * itself, so the only place to read it without reproducing it is the render this pass is about to
 * make. The outcomes are finished afterwards, in `skeleton`.
 */
interface PendingChoice {
	index: number;
	tests: string[];
	names: string[];
	/** The class attribute as written, or the empty string where there was none. */
	base: string;
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
	/**
	 * The name an each binds to its counter, where it names one. The IR calls this `index`, which
	 * this field cannot: `index` here is the block's own ordinal, and the two collided once.
	 */
	counter?: string | null;
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
		'this `bind:` is one the server writes, and the value has nowhere to be planted: `bind:` ' +
		'takes a name rather than an expression, so a marker cannot stand where the value goes. The ' +
		'bindings that write nothing are handled',
	StyleDirective:
		'`style:` is not handled yet. Its value is written, but the declaration is dropped when the ' +
		'value is nullish, so it is a substitution inside a decision and waits on the same mechanism ' +
		'as `class:`',
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
	/** Every snippet this component declares, by name, with how many parameters it takes. */
	snippets: ReadonlyMap<string, Snippet>,
	/** Class decisions found on the way, to be finished once the render says what the hash is. */
	pending: PendingChoice[],
) {
	if (!isNode(node)) return;
	const type = node['type'];
	if (typeof type !== 'string') {
		refuse('a markup node with no type reached the compiler, which cannot happen');
	}

	const walk = (child: unknown, into: Stream = stream): void => {
		collect(source, child, holes, edits, blocks, taken, into, expand, snippets, pending);
	};
	const fragment = (of: unknown, into: Stream = stream): void => {
		if (!isNode(of)) return;
		const nodes = of['nodes'];
		if (!Array.isArray(nodes)) return;
		for (const child of nodes) walk(child, into);
	};

	if (INERT.has(type)) return;

	// A binding the server writes nothing for. It is not that the value is dropped: there is no
	// value, because every one of these is a measurement only a browser can take. So the walk steps
	// over it exactly as it steps over a transition. See `omitted.ts`, and spec/refusals.md.
	if (type === 'BindDirective' && OMITTED_IN_SSR.has(String(node['name']))) return;
	const why = REFUSED[type];
	if (why !== undefined) refuse(why);

	switch (type) {
		case 'Fragment': {
			const nodes = Array.isArray(node['nodes']) ? node['nodes'] : [];
			// A `{@const}` is a declaration scoped to the block it sits in, so it binds for its
			// siblings rather than for anything below. Svelte's server pushes it into that block's
			// `init` and it writes no bytes of its own. See spec/derivation.md.
			const consts = nodes.filter(
				(child) => isNode(child) && child['type'] === 'ConstTag',
			) as AstNode[];
			if (consts.length === 0) {
				for (const child of nodes) walk(child);
				return;
			}

			const bound = new Map<string, string>();
			for (const one of consts) {
				const declared = declarationOf(one);
				if (declared === null) refuse('a `{@const}` this compiler cannot read');
				const [id, init] = declared;
				// Expanded against what the earlier ones bound, so `{@const b = a + 1}` reaches `a`.
				const value = expand(init, bound);
				const at = span(init);
				// The value is unused once every read of it is a marker, and evaluating it would
				// reach for data the render is not given. What stands in has to come apart the way
				// the name does.
				if (at !== null) edits.push([at[0], at[1], holdsFor(id)]);

				if (isNode(id) && id['type'] === 'Identifier' && typeof id['name'] === 'string') {
					bound.set(id['name'], `(${value})`);
					continue;
				}
				for (const [name, access] of destructure(id as never)) {
					bound.set(name, `(${value})${access}`);
				}
				const all = new Set<string>();
				namesIn(id, all);
				const missing = [...all].filter((name) => !bound.has(name));
				if (missing.length > 0) {
					refuse(
						`a \`{@const}\` binds ${missing.map((name) => `\`${name}\``).join(', ')} through a ` +
							'default or a rest, which is neither a member nor an index of what it was ' +
							'declared to be, so there is no way in to write down',
					);
				}
			}

			const inner: Locals['rewrite'] = (child, more) =>
				expand(child, more === undefined ? bound : new Map([...bound, ...more]));
			for (const child of nodes) {
				if (isNode(child) && child['type'] === 'ConstTag') continue;
				collect(source, child, holes, edits, blocks, taken, stream, inner, snippets, pending);
			}
			return;
		}

		case 'Text':
			return;

		case 'SvelteHead':
			// The other stream. Everything under it renders into the head rather than the body.
			walk(node['fragment'], 'head');
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
			// The class directives are taken together with the class attribute, because that is how
			// Svelte writes them: one call producing one attribute, not one attribute plus a list of
			// additions. What is left after this is walked the ordinary way.
			const handled = classes(node, holes, edits, expand, pending);
			if (Array.isArray(attributes)) {
				for (const attr of attributes) if (!handled.has(attr)) walk(attr);
			}
			walk(node['fragment']);
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
			// `{n}` is sugar for `n={n}`, and the sugar only holds a bare name: put anything else
			// between those braces and Svelte's parser stops with `attribute_empty_shorthand`. This
			// pass puts a marker there, so a shorthand attribute made the compiler fail inside
			// Svelte, pointing at the author's own file and telling them something untrue about it.
			// Writing the name back out first is not a rewrite of the value -- the two forms render
			// the same bytes, measured -- and it leaves the marker somewhere the parser accepts.
			const at = span(node);
			if (at !== null && source[at[0]] === '{') edits.push([at[0], at[0], `${name}=`]);
			for (const part of parts) walk(part);
			return;
		}

		case 'SnippetBlock': {
			// The body's holes are planted here and come back where the snippet is rendered, which
			// is fine: a marker carries its own index, so where it lands is not where it was
			// written. A parameter is a different thing entirely -- its value comes from the call
			// rather than from the payload, and one body would need a different one per call.
			const parameters = Array.isArray(node['parameters']) ? node['parameters'] : [];
			if (parameters.length === 0) {
				fragment(node['body']);
				return;
			}

			// A parameter's value is the argument at the `{@render}` that calls the snippet, and
			// there is exactly one of those -- more than one is refused at the render tag, because
			// one body cannot stand in two places. So the parameter substitutes like any other
			// declared name, with the argument standing for it.
			const id = node['expression'];
			const named = isNode(id) && typeof id['name'] === 'string' ? id['name'] : '';
			const one = snippets.get(named);
			if (one === undefined) {
				refuse(`the snippet \`${named}\` takes parameters and is never rendered`);
			}
			if (one.renders === 0) {
				// Written inside a component's tag, so it is a prop that component receives: the child
				// decides when to call it and with what, and neither is visible from here. One with no
				// parameters has nothing to decide and already works, which is what `children` is.
				refuse(
					one.passed
						? `the snippet \`${named}\` is passed to a component, which calls it with arguments ` +
								'this compiler cannot see, so its parameters have no value to stand for'
						: `the snippet \`${named}\` takes parameters and is never rendered`,
				);
			}
			if (one.args.length !== parameters.length) {
				refuse(
					`the snippet \`${named}\` takes ${String(parameters.length)} parameter(s) and is ` +
						`rendered with ${String(one.args.length)}`,
				);
			}

			const bound = new Map<string, string>();
			for (const [index, parameter] of parameters.entries()) {
				if (!isNode(parameter)) refuse('a `{#snippet}` parameter this compiler cannot read');
				// Expanded, so a script name inside the argument is already what it stands for.
				const argument = expand(one.args[index]);
				if (parameter['type'] === 'Identifier' && typeof parameter['name'] === 'string') {
					bound.set(parameter['name'], argument);
					continue;
				}
				// Destructured, which is the same substitution a destructured declaration gets: the
				// name expands to the argument with the way in written after it.
				const taken = destructure(parameter as never);
				for (const [name, access] of taken) bound.set(name, `(${argument})${access}`);
				// A default or a rest is neither a member nor an index, so it has no way in. Reported
				// here rather than left to fail as an unresolved name three passes later.
				const all = new Set<string>();
				namesIn(parameter, all);
				const missing = [...all].filter((name) => !bound.has(name));
				if (missing.length > 0) {
					refuse(
						`the snippet \`${named}\` binds ${missing.map((name) => `\`${name}\``).join(', ')} ` +
							'through a default or a rest, which is neither a member nor an index of the ' +
							'argument, so there is no way in to write down',
					);
				}
			}

			// The body is walked with those names bound. Everything else about it is ordinary.
			const inner: Locals['rewrite'] = (child) => expand(child, bound);
			const body = node['body'];
			const nodes = isNode(body) ? body['nodes'] : undefined;
			for (const child of Array.isArray(nodes) ? nodes : []) {
				collect(source, child, holes, edits, blocks, taken, stream, inner, snippets, pending);
			}
			return;
		}

		case 'RenderTag': {
			const call = node['expression'];
			const callee = isNode(call) ? call['callee'] : undefined;
			const name = isNode(callee) && typeof callee['name'] === 'string' ? callee['name'] : null;
			const one = name === null ? undefined : snippets.get(name);
			if (one === undefined || !one.declared) {
				refuse(
					'`{@render}` of a snippet this component does not declare is not handled yet: the ' +
						'snippet comes from the call site, which is composition in the other direction',
				);
			}
			// Rendered twice, one body would have to appear twice, and its markers with it. The hole
			// check catches that on its own, but it reports a value coming back more than once, which
			// says nothing about the snippet that put it there.
			if ((one?.renders ?? 0) > 1) {
				refuse(
					`the snippet \`${String(name)}\` is rendered ${String(one?.renders)} times, and one ` +
						'body cannot stand in two places: each marker in it would come back more than once',
				);
			}
			// The arguments are read where the snippet's body was walked, not here. Their values are
			// unused during the render -- every expression in the body is already a marker -- and
			// evaluating one would reach for data the render is not given, so each is written out.
			const given = isNode(call) && Array.isArray(call['arguments']) ? call['arguments'] : [];
			for (const [index, argument] of given.entries()) {
				const at = span(argument);
				if (at !== null) edits.push([at[0], at[1], one.holds[index] ?? 'null']);
			}
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
				counter: null,
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
			// A key is not carried, because Svelte's own server transform never mentions one: a
			// keyed each renders byte for byte what an unkeyed one renders, measured. It belongs to
			// the client, which compiles from the source and keeps it.
			const at = span(node['expression']);
			const context = span(node['context']);
			if (at === null) return;
			blocks.push({
				index: blocks.length,
				kind: 'each',
				stream,
				expression: expand(node['expression']),
				item: context === null ? null : source.slice(context[0], context[1]),
				counter: typeof node['index'] === 'string' ? node['index'] : null,
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
/** The id and initialiser of a `{@const}`, or null when it is not the one declaration it must be. */
function declarationOf(node: AstNode): [unknown, unknown] | null {
	const declaration = node['declaration'];
	if (!isNode(declaration)) return null;
	const declarations = declaration['declarations'];
	const one = Array.isArray(declarations) ? declarations[0] : undefined;
	if (!isNode(one)) return null;
	return [one['id'], one['init']];
}

/** What a render is handed in place of a value it cannot compute, shaped so it still comes apart. */
function holdsFor(id: unknown): string {
	if (!isNode(id)) return 'null';
	if (id['type'] === 'ObjectPattern') return '{}';
	if (id['type'] === 'ArrayPattern') return '[]';
	return 'null';
}

/** Every name a parameter pattern binds, so one it cannot be taken apart by is not left silent. */
function namesIn(pattern: unknown, into: Set<string>): void {
	if (Array.isArray(pattern)) {
		for (const one of pattern) namesIn(one, into);
		return;
	}
	if (!isNode(pattern)) return;
	if (pattern['type'] === 'Identifier' && typeof pattern['name'] === 'string') {
		into.add(pattern['name']);
		return;
	}
	// A property's key is not a binding: `{ a: b }` binds `b`.
	if (pattern['type'] === 'Property') {
		namesIn(pattern['value'], into);
		return;
	}
	for (const value of Object.values(pattern)) namesIn(value, into);
}

/** What a component declares under one snippet name, and how many times it renders it. */
interface Snippet {
	/**
	 * Whether a `{#snippet}` in this component declares it. A name only ever rendered is not
	 * one: `{@render children()}` names a function that arrived as a prop, and this record
	 * exists for it because the render was seen, not because anything here declares it.
	 */
	declared: boolean;
	parameters: number;
	renders: number;
	/**
	 * Whether it was written inside a component's tag, which makes it a prop that component
	 * receives rather than something this one renders. Svelte compiles it to a function passed
	 * along, and the child decides when to call it and with what.
	 */
	passed: boolean;
	/**
	 * What a render has to be handed in each argument's place. The value is unused -- every
	 * expression in the body is already a marker -- but a parameter that destructures needs
	 * something it can be taken apart from, and `null` is not that.
	 */
	holds: string[];
	/** The arguments of the one `{@render}` that calls it, as written. */
	args: unknown[];
}

/**
 * Every snippet the markup declares, and every `{@render}` that names one.
 *
 * Collected before the walk rather than during it, because a render tag may be written above the
 * snippet it names -- which is legal, and which the compiler handles: a marker carries its own
 * index, so where it comes back is not where it was written.
 */
function snippetsIn(node: unknown, into: Map<string, Snippet>, inside = false): void {
	if (Array.isArray(node)) {
		for (const one of node) snippetsIn(one, into, inside);
		return;
	}
	if (!isNode(node)) return;

	if (node['type'] === 'SnippetBlock') {
		const id = node['expression'];
		if (isNode(id) && typeof id['name'] === 'string') {
			const one = into.get(id['name']) ?? {
				declared: false,
				parameters: 0,
				renders: 0,
				passed: false,
				holds: [],
				args: [],
			};
			const parameters = Array.isArray(node['parameters']) ? node['parameters'] : [];
			one.declared = true;
			one.parameters = parameters.length;
			one.passed = inside;
			one.holds = parameters.map((parameter) =>
				isNode(parameter) && parameter['type'] === 'ObjectPattern'
					? '{}'
					: isNode(parameter) && parameter['type'] === 'ArrayPattern'
						? '[]'
						: 'null',
			);
			into.set(id['name'], one);
		}
	}
	if (node['type'] === 'RenderTag') {
		const call = node['expression'];
		const callee = isNode(call) ? call['callee'] : undefined;
		if (isNode(call) && isNode(callee) && typeof callee['name'] === 'string') {
			const one = into.get(callee['name']) ?? {
				declared: false,
				parameters: 0,
				renders: 0,
				passed: false,
				holds: [],
				args: [],
			};
			one.renders += 1;
			one.args = Array.isArray(call['arguments']) ? call['arguments'] : [];
			into.set(callee['name'], one);
		}
	}
	// Inside a component's tag, a snippet is a prop rather than something this component renders.
	const within = inside || node['type'] === 'Component' || node['type'] === 'SvelteComponent';
	for (const value of Object.values(node)) snippetsIn(value, into, within);
}

function rewrite(source: string, taken: (block: number) => boolean): Rewritten {
	const ast = parse(source, { modern: true }) as unknown as AstNode;
	const holes: Hole[] = [];
	const blocks: Block[] = [];
	const edits: [number, number, string][] = [];
	const pending: PendingChoice[] = [];
	const declared = locals(source);

	// A render is given no data, so a declaration reading a prop would evaluate against nothing
	// and crash inside Svelte's own renderer. It has already been substituted into every
	// expression that used it, which leaves it dead here, so the render is handed a literal in
	// its place rather than the expression it stood for.
	for (const [[from, to], empty] of declared.reading) edits.push([from, to, empty]);

	const snippets = new Map<string, Snippet>();
	snippetsIn(ast['fragment'], snippets);
	collect(source, ast['fragment'], holes, edits, blocks, taken, 'body', declared.rewrite, snippets, pending);

	return { rewritten: apply(source, edits), holes, blocks, pending };
}

/**
 * How many outcomes a single element's class directives may have.
 *
 * The outcomes are enumerated, so `n` directives on one element cost `2^n` strings. Four directives
 * is past anything measured -- the most on one element in a real application is two -- and the
 * limit exists so the cost is refused with a number in it rather than paid quietly.
 */
const CHOICES = 16;

/**
 * `class:` is one decision over the whole class attribute, not an addition beside it.
 *
 * Read out of Svelte's server transform rather than guessed. `build_attr_class` collects every
 * directive on the element and emits a single `$.attr_class(value, hash, directives)`, and
 * `to_class` appends the name of each truthy directive **and removes the name of each falsy one
 * from the value it was handed**. So a directive is not something added to a class attribute: it
 * decides what the attribute is, and it can decide the attribute away entirely -- `class="on"` with
 * `class:on={false}` writes no class attribute at all. The analysis phase also invents an empty
 * class attribute when a directive has none to work with, at the end of the attribute list, which
 * is why one written here goes there too.
 *
 * The value never reaches the bytes; only its truthiness does. That makes this a decision position
 * in the sense spec/pipeline.md sets out, and a decision is compilable when its outcomes can be
 * enumerated. These can: `2^n` of them, each computed by calling Svelte's own `attr_class`, so
 * neither the joining nor the removal nor the escaping nor the empty result is reproduced here.
 *
 * What is planted is a marker as the whole class value, with the directives deleted. That is the
 * anchor: the render then carries ` class="<marker> <hash>"` at exactly the position the attribute
 * belongs, which lowering already knows how to find and replace whole. See spec/refusals.md.
 *
 * @returns the attributes this took charge of, which the caller must not walk again.
 */
function classes(
	node: AstNode,
	holes: Hole[],
	edits: [number, number, string][],
	expand: Locals['rewrite'],
	pending: PendingChoice[],
): ReadonlySet<unknown> {
	const empty: ReadonlySet<unknown> = new Set();
	// Only a real element. Anything else carrying one of these is refused where it always was,
	// which says what the construct is rather than what its attribute would have been.
	if (node['type'] !== 'RegularElement') return empty;
	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	const directives = attributes.filter(
		(one): one is AstNode => isNode(one) && one['type'] === 'ClassDirective',
	);
	if (directives.length === 0) return empty;

	if (1 << directives.length > CHOICES) {
		refuse(
			`this element has ${String(directives.length)} \`class:\` directives, which is ` +
				`${String(1 << directives.length)} outcomes to enumerate. The mechanism is enumeration, ` +
				`so the limit is ${String(CHOICES)}`,
		);
	}

	const attribute = attributes.find(
		(one) => isNode(one) && one['type'] === 'Attribute' && one['name'] === 'class',
	);
	let base = '';
	if (isNode(attribute)) {
		const value = attribute['value'];
		const parts = value === true ? [] : Array.isArray(value) ? value : [value];
		if (!parts.every((part) => isNode(part) && part['type'] === 'Text')) {
			refuse(
				'`class:` beside a `class` whose value is an expression is not handled yet: a falsy ' +
					'directive removes its own name from that value, so which bytes exist is decided by a ' +
					'string that only exists per request. Writing the whole class as one expression, ' +
					'`class={...}` with no directive beside it, is a substitution, and that is handled',
			);
		}
		base = parts.map((part) => String((part as AstNode)['data'] ?? '')).join('');
	}

	const index = holes.length;
	const tests = directives.map((one) => expand(one['expression']));
	holes.push({ index, expression: '', raw: false, choice: { tests, outcomes: [] } });
	pending.push({ index, tests, names: directives.map((one) => String(one['name'])), base });

	// The marker is appended to the class rather than put in place of it, and the directives stay
	// where they are. Both matter, and neither was obvious: whether Svelte scopes an element is
	// decided by whether a selector in the `<style>` matches it, and it matches against the class
	// attribute's *text* and against the directive names -- `css-prune.js` reads a `ClassDirective`
	// for exactly that. Replacing the text with an expression, or deleting a directive, tells the
	// analysis the element is no longer selected, and the scoping hash then never reaches the
	// render this pass reads it out of. Measured: the hash silently went missing.
	//
	// Every directive is made false so that nothing is appended after the marker, which leaves the
	// hash as the whole of what follows it and makes reading it a `slice` rather than a parse.
	for (const one of directives) {
		const at = span(one);
		if (at !== null) edits.push([at[0], at[1], `class:${String(one['name'])}={false}`]);
	}
	const marker = sentinel(index);
	const at = span(attribute);
	if (at !== null) {
		edits.push([at[0], at[1], `class="${base === '' ? marker : `${base} ${marker}`}"`]);
	} else {
		// Where Svelte's own invented one goes, which is after every attribute that was written.
		const last = Math.max(...attributes.map((one) => span(one)?.[1] ?? 0));
		edits.push([last, last, ` class="${marker}"`]);
	}

	return new Set(isNode(attribute) ? [...directives, attribute] : directives);
}

/**
 * Fills in each class decision's outcomes, which needs the render because it needs the hash.
 *
 * The scoping class is a hash of the filename relative to `rootDir` and of the stylesheet, and
 * Svelte appends it inside the class attribute itself. Reproducing it here would be a third place
 * that has to agree; reading it off the render is one. The marker stands as the whole class value,
 * so whatever follows it inside the quotes is the hash and nothing else.
 */
async function outcomes(
	holes: Hole[],
	pending: readonly PendingChoice[],
	streams: readonly string[],
): Promise<void> {
	if (pending.length === 0) return;
	const { attr_class } = await import('svelte/internal/server');

	for (const one of pending) {
		const marker = sentinel(one.index);
		let hash: string | undefined;
		let found = false;
		for (const stream of streams) {
			const start = stream.indexOf(marker);
			if (start < 0) continue;
			const close = stream.indexOf('"', start);
			if (close < 0) continue;
			const after = stream.slice(start + marker.length, close);
			hash = after.startsWith(' ') ? after.slice(1) : undefined;
			found = true;
			break;
		}
		if (!found) {
			refuse(
				`the class decision on \`${one.names.join('`, `')}\` was planted and no render brought ` +
					'it back, so there is nothing to choose between',
			);
		}
		const table: string[] = [];
		for (let bits = 0; bits < 1 << one.names.length; bits++) {
			const directives: Record<string, boolean> = {};
			for (const [at, name] of one.names.entries()) directives[name] = ((bits >> at) & 1) === 1;
			table.push(attr_class(one.base, hash, directives));
		}
		const hole = holes[one.index];
		if (hole?.choice !== undefined) hole.choice.outcomes = table;
	}
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
	/** Class decisions whose outcomes the render has still to supply the hash for. */
	pending: PendingChoice[];
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

	// `<style>` used to be refused here. It hangs off the root rather than off the fragment, so
	// neither pass's walk could see it and neither could refuse it: a styled component compiled,
	// exited zero, wrote Svelte's scoped class into the bytes and carried the stylesheet nowhere.
	// What it waited on was a half that emits one, which is the client build the plugin runs. The
	// class is a hash of the filename relative to `rootDir`, and both halves pass the project root,
	// which is what makes the class in these bytes the class in that stylesheet. See spec/build.md.

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

	// After every render rather than after the first: an element inside an if appears in the
	// alternate and not in the baseline, and the hash has to be read wherever the marker landed.
	await outcomes(baseline.holes, baseline.pending, [
		html,
		head,
		...Object.values(alternates).flatMap((one) => [one.body, one.head]),
	]);

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
	const { fileURLToPath, pathToFileURL } = await import('node:url');
	const { render } = await import('svelte/server');

	const here = dirname(fileURLToPath(import.meta.url));
	// A directory of its own per render, and only that one is removed. It used to be one shared
	// directory emptied in a `finally`, which is fine for one caller and a race for two: the
	// checks drive this from several files at once and each was deleting the other's modules.
	generation += 1;
	const staging = resolvePath(here, `../.build/${process.pid}-${generation}`);
	mkdirSync(staging, { recursive: true });
	let written = 0;

	function emit(from: string, code: string, origin: string): string {
		// Either quote. Svelte keeps the one the author wrote, so a component whose imports are
		// double-quoted -- which is most of what a package ships -- had its relative specifiers
		// left alone here and its neighbours looked for beside the staged file rather than beside
		// the source. What the author saw was Node reporting a missing module inside `.build`.
		for (const match of code.matchAll(/from\s+(['"])(\.[^'"]*)\1/g)) {
			const quote = match[1] ?? "'";
			const specifier = match[2];
			if (specifier === undefined) continue;
			const target = resolvePath(dirname(origin), specifier);
			const replacement = specifier.endsWith('.svelte')
				? emit(target, compileFile(target), target)
				: target;
			code = code.replaceAll(
				`${quote}${specifier}${quote}`,
				JSON.stringify(pathToFileURL(replacement).href),
			);
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
