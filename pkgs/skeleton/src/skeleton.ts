import { readFileSync } from 'node:fs';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { compile, parse } from 'svelte/compiler';
import { apply, destructure, type Locals, locals, reduce, resolved } from 'ast';
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
	/**
	 * The component this value was handed to, and the prop it was handed as.
	 *
	 * Carried for the diagnostic rather than for the compilation. A component is a plain function
	 * call with no anchor around what it writes, so when a marker does not come back the assembler
	 * sees an absence and nothing else; this is the one thing the walk knows that it does not.
	 */
	given?: string;
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
	/** `class` for a class attribute's directives, `style` for a style attribute's. */
	kind: 'class' | 'style';
	names: string[];
	/** The attribute as written, or the empty string where there was none. */
	base: string;
	/**
	 * A style decision's declarations, in source order: what to write for the value when it is
	 * present, whether it carries `!important`, and whether it is a decision at all.
	 *
	 * A declaration written with plain text is always present and needs no test; one written with
	 * an expression is present when the value is neither null nor the empty string, which is the
	 * rule `to_style` applies, and stands as a marker of its own per outcome so that every hole is
	 * consumed exactly once.
	 */
	declarations?: {
		name: string;
		important: boolean;
		literal: string | null;
		expression: string | null;
	}[];
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
	/**
	 * Every test of an if, in order, which is one per branch before the final else.
	 *
	 * `{:else if}` is one block rather than a nested one. Svelte's server transform flattens the
	 * chain -- `metadata.flattened` in `visitors/IfBlock.js` -- and tells the branches apart by
	 * numbering the marker it opens with: `<!--[0-->`, `<!--[1-->`, and `<!--[-1-->` for the else.
	 * The AST nests them, so a walk that followed it would number blocks the render never wrote.
	 */
	tests?: string[];
	/**
	 * The branch each enclosing if has to be on for this block to be rendered at all, as pairs of
	 * block and branch. Empty for anything the baseline render holds.
	 *
	 * A block inside an `{:else}` only exists in the render made for that branch, so the render
	 * made for *its* own branches has to put its ancestors there too. Getting this wrong does not
	 * corrupt anything: the block simply does not appear, and the assembler says so.
	 */
	within?: [block: number, branch: number][];
	/** The name an each binds, or the pattern it binds through, as written. */
	item: string | null;
	/**
	 * What a destructuring context binds, as pairs of name and how it is reached from one element.
	 *
	 * `{#each Object.entries(m) as [k, v]}` binds two names and neither is the element. Svelte's
	 * server writes `let [k, v] = each_array[i]`, so the element has to come apart the way the
	 * pattern says -- and the render, which iterates one placeholder, has to hand it something that
	 * can. Absent for the ordinary case, where `item` is a name.
	 */
	binds?: [name: string, access: string][];
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

/**
 * The call a `{@render}` makes, with an optional chain unwrapped.
 *
 * `{@render children?.()}` parses as a `ChainExpression` around the call, so reading `callee`
 * straight off the expression finds nothing and the tag looks like a render of something this
 * component never declared. Svelte's own transform calls `unwrap_optional` here for the same
 * reason, and this is that function.
 */
function called(expression: unknown): AstNode | null {
	if (!isNode(expression)) return null;
	const inner = expression['type'] === 'ChainExpression' ? expression['expression'] : expression;
	return isNode(inner) ? inner : null;
}

/** The name a `{@render}` calls, where it calls one by name rather than through a member. */
function renders(node: AstNode): string | null {
	const callee = called(node['expression'])?.['callee'];
	return isNode(callee) && typeof callee['name'] === 'string' ? callee['name'] : null;
}

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
	/** Whether test `branch` of the chain numbered `block` is rendered as true. */
	taken: (block: number, branch: number) => boolean,
	stream: Stream,
	/** An expression as the compiler will see it, with declared names already substituted. */
	expand: Locals['rewrite'],
	/** Every snippet this component declares, by name, with how many parameters it takes. */
	snippets: ReadonlyMap<string, Snippet>,
	/** Class decisions found on the way, to be finished once the render says what the hash is. */
	pending: PendingChoice[],
	/** The branch of each enclosing if that this walk is inside of. */
	within: [number, number][],
	/** The file this walk is in, and everything the walk into a child needs. */
	site: Site,
) {
	if (!isNode(node)) return;
	const type = node['type'];
	if (typeof type !== 'string') {
		refuse('a markup node with no type reached the compiler, which cannot happen');
	}

	const walk = (child: unknown, into: Stream = stream): void => {
		collect(
			source,
			child,
			holes,
			edits,
			blocks,
			taken,
			into,
			expand,
			snippets,
			pending,
			within,
			site,
		);
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
				collect(
				source,
				child,
				holes,
				edits,
				blocks,
				taken,
				stream,
				inner,
				snippets,
				pending,
				within,
				site,
			);
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
			const styled = styles(source, node, holes, edits, expand, pending);
			const given = type === 'Component';
			const tag = typeof node['name'] === 'string' ? node['name'] : '';

			// Into the child, where the child is one this walk can follow. What it plants there is
			// what the child does with the value rather than the value itself, so a prop used twice,
			// or not at all, or computed with, is the ordinary case rather than a marker that does
			// not come back. See spec/refusals.md.
			if (
				given &&
				descend(node, {
					source,
					holes,
					edits,
					blocks,
					taken,
					stream,
					expand,
					pending,
					within,
					site,
				})
			) {
				return;
			}

			if (Array.isArray(attributes)) {
				for (const attr of attributes) {
					if (handled.has(attr) || styled.has(attr)) continue;
					const before = holes.length;
					walk(attr);
					if (!given || !isNode(attr)) continue;
					const prop = typeof attr['name'] === 'string' ? attr['name'] : '';
					for (const one of holes.slice(before)) one.given = `\`<${tag}>\` as \`${prop}\``;
				}
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
				collect(
				source,
				child,
				holes,
				edits,
				blocks,
				taken,
				stream,
				inner,
				snippets,
				pending,
				within,
				site,
			);
			}
			return;
		}

		case 'RenderTag': {
			const call = called(node['expression']);
			const name = renders(node);
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
			// The whole `{:else if}` chain, because Svelte's server writes it as one block: the
			// transform flattens it and numbers the marker per branch rather than nesting a second
			// pair of anchors. Following the AST instead would number blocks the render never wrote.
			const chain = [node];
			for (;;) {
				const next = elseIf(chain[chain.length - 1]?.['alternate']);
				if (next === null) break;
				chain.push(next);
			}
			const last = chain[chain.length - 1];
			const otherwise = last?.['alternate'];
			const index = blocks.length;
			const tests = chain.map((one) => expand(one['test']));
			blocks.push({
				index,
				kind: 'if',
				stream,
				expression: tests[0] ?? '',
				tests,
				item: null,
				counter: null,
				alternate: otherwise !== null && otherwise !== undefined,
				within: [...within],
			});

			for (const [branch, one] of chain.entries()) {
				const at = span(one['test']);
				if (at !== null) edits.push([at[0], at[1], taken(index, branch) ? 'true' : 'false']);
			}

			// Only the first branch is in the baseline render, so only its blocks are numbered where
			// the assembler counts them. A block in any other branch is numbered here and appears in
			// a render nobody counts, which is the two lists coming apart. See spec/refusals.md.
			for (const [branch, one] of chain.entries()) {
				within.push([index, branch]);
				walk(one['consequent']);
				within.pop();
			}
			if (isNode(otherwise)) {
				within.push([index, -1]);
				walk(otherwise);
				within.pop();
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
			const pattern = node['context'];
			const context = span(pattern);
			if (at === null) return;

			// A destructuring context binds names rather than the element, and Svelte's server takes
			// it apart with `let <pattern> = each_array[i]`. So the one element this render iterates
			// has to be something the pattern accepts: `0` is not, and destructuring it threw inside
			// Svelte's own output -- `number 0 is not iterable` -- which told the author nothing.
			const kind = isNode(pattern) ? pattern['type'] : undefined;
			const destructured = kind === 'ObjectPattern' || kind === 'ArrayPattern';
			const element = kind === 'ObjectPattern' ? '{}' : kind === 'ArrayPattern' ? '[]' : '0';

			let binds: [string, string][] | undefined;
			if (destructured && isNode(pattern)) {
				binds = destructure(pattern);
				// The same rule a snippet's parameter follows: a default or a rest or a nesting is
				// neither a member nor an index of the element, so there is no way in to write down.
				const bound = new Set<string>();
				namesIn(pattern, bound);
				const reached = new Set(binds.map(([name]) => name));
				const missing = [...bound].filter((name) => !reached.has(name));
				if (missing.length > 0) {
					refuse(
						`\`${String(missing[0])}\` comes out of this each block's pattern through a ` +
							'default, a rest or a nesting, which is neither a member nor an index of the ' +
							'element, so there is no way in to write down',
					);
				}
			}

			blocks.push({
				index: blocks.length,
				kind: 'each',
				within: [...within],
				stream,
				expression: expand(node['expression']),
				item: context === null ? null : source.slice(context[0], context[1]),
				...(binds === undefined ? {} : { binds }),
				counter: typeof node['index'] === 'string' ? node['index'] : null,
				alternate: false,
			});
			// One element, because the body's own expressions are sentinels and read nothing from it.
			edits.push([at[0], at[1], `[${element}]`]);
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
/**
 * The `{:else if}` this alternate is, or null where it is an ordinary `{:else}` or nothing.
 *
 * The parser puts the continuation in the alternate as a fragment holding one `IfBlock` marked
 * `elseif`. Svelte's own transform reads the same thing to flatten the chain.
 */
function elseIf(alternate: unknown): AstNode | null {
	if (!isNode(alternate) || alternate['type'] !== 'Fragment') return null;
	const nodes = alternate['nodes'];
	if (!Array.isArray(nodes) || nodes.length !== 1) return null;
	const [only] = nodes;
	if (!isNode(only) || only['type'] !== 'IfBlock' || only['elseif'] !== true) return null;
	return only;
}

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
		const call = called(node['expression']);
		const name = renders(node);
		if (call !== null && name !== null) {
			const one = into.get(name) ?? {
				declared: false,
				parameters: 0,
				renders: 0,
				passed: false,
				holds: [],
				args: [],
			};
			one.renders += 1;
			one.args = Array.isArray(call['arguments']) ? call['arguments'] : [];
			into.set(name, one);
		}
	}
	// Inside a component's tag, a snippet is a prop rather than something this component renders.
	const within = inside || node['type'] === 'Component' || node['type'] === 'SvelteComponent';
	for (const value of Object.values(node)) snippetsIn(value, into, within);
}

/**
 * One copy of a snippet per `{@render}` that calls it, so that a body stands in one place only.
 *
 * A snippet is a function -- `{#snippet a(v)}` compiles to `function a($$renderer, v)` and
 * `{@render a(x)}` to `a($$renderer, x)`, read out of `visitors/SnippetBlock.js` and
 * `visitors/RenderTag.js`. Calling it twice inlines the body twice, and this compiler plants its
 * markers in the body once: each would come back twice, which the hole check reports, and a
 * parameter would have to stand for two different arguments at once. Both used to be refused.
 *
 * Duplicating the declaration is what makes them go away, because it is what the render does
 * anyway. Each copy has one call, so it has one set of markers and one argument per parameter, and
 * everything downstream is the case that already worked. A snippet declaration writes no bytes --
 * the visitor pushes a function to `hoisted` or `init`, never to the template -- so a copy adds
 * none either, which is what makes this a rewrite rather than a change of output.
 *
 * Done to the source before any other pass reads it, so nothing downstream knows about it.
 */
function inlined(source: string): string {
	const ast = parse(source, { modern: true }) as unknown as AstNode;
	const snippets = new Map<string, Snippet>();
	snippetsIn(ast['fragment'], snippets);

	const wanted = new Set(
		[...snippets]
			.filter(([, one]) => one.declared && !one.passed && one.renders > 1)
			.map(([name]) => name),
	);
	if (wanted.size === 0) return source;

	const declarations = new Map<string, AstNode>();
	const calls = new Map<string, AstNode[]>();
	const find = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const one of node) find(one);
			return;
		}
		if (!isNode(node)) return;
		if (node['type'] === 'SnippetBlock') {
			const id = node['expression'];
			if (isNode(id) && typeof id['name'] === 'string' && wanted.has(id['name'])) {
				declarations.set(id['name'], node);
			}
		}
		if (node['type'] === 'RenderTag') {
			const name = renders(node);
			const callee = called(node['expression'])?.['callee'];
			if (name !== null && wanted.has(name) && isNode(callee)) {
				calls.set(name, [...(calls.get(name) ?? []), callee]);
			}
		}
		for (const value of Object.values(node)) find(value);
	};
	find(ast['fragment']);

	// A name nothing else in the file uses, so a copy cannot shadow a snippet the author wrote.
	const taken = new Set(snippets.keys());
	const naming = (name: string, at: number): string => {
		let candidate = `${name}$${String(at)}`;
		while (taken.has(candidate)) candidate += '$';
		taken.add(candidate);
		return candidate;
	};

	const edits: [number, number, string][] = [];
	for (const name of wanted) {
		const block = declarations.get(name);
		const sites = calls.get(name) ?? [];
		const at = span(block);
		const id = span(isNode(block) ? block['expression'] : undefined);
		if (block === undefined || at === null || id === null) continue;
		// A snippet that renders itself would lose the name it recurses through, and a recursion
		// has no fixed number of copies to make in the first place.
		if (
			sites.some((site) => {
				const where = span(site);
				return where !== null && where[0] > at[0] && where[1] < at[1];
			})
		) {
			refuse(
				`the snippet \`${name}\` renders itself, and a compile-time render has no way to stop: ` +
					'the body would have to stand in as many places as the data has depth',
			);
		}
		const text = source.slice(at[0], at[1]);
		const names = sites.map((_, index) => naming(name, index));
		const body = (to: string) =>
			text.slice(0, id[0] - at[0]) + to + text.slice(id[1] - at[0]);
		edits.push([at[0], at[1], names.map(body).join('')]);
		for (const [index, site] of sites.entries()) {
			const where = span(site);
			const to = names[index];
			if (where !== null && to !== undefined) edits.push([where[0], where[1], to]);
		}
	}

	return apply(source, edits);
}

/**
 * Every `bind:` the server writes, written the way it writes it: as an ordinary attribute.
 *
 * Read out of `visitors/shared/element.js` and `visitors/shared/component.js`. A binding is not a
 * separate kind of output. On an element the visitor ends at
 * `attributes.push({ type: 'transformed', name, expression })`, so `bind:value={v}` writes what
 * `value={v}` writes; on a component it becomes a getter and a setter for the same prop, and only
 * the getter runs while the bytes are written. The refusal used to say a marker cannot stand where
 * the value goes because `bind:` takes a name rather than an expression. **The syntax does; the
 * output does not.** Rewriting the syntax is enough, and nothing downstream then knows there was a
 * binding at all.
 *
 * The ones that are not an attribute are refused here, each saying what it is rather than what it
 * is not. Everything the visitor drops is dropped: `bind:this`, the forty the table marks
 * `omit_in_ssr`, and `bind:value` on a `<select>` or a file input.
 */
function unbound(source: string): string {
	const ast = parse(source, { modern: true }) as unknown as AstNode;
	const edits: [number, number, string][] = [];

	const walk = (node: unknown, host: AstNode | null): void => {
		if (Array.isArray(node)) {
			for (const one of node) walk(one, host);
			return;
		}
		if (!isNode(node)) return;
		const type = node['type'];
		const element = type === 'RegularElement' || type === 'SvelteElement';
		const component = type === 'Component' || type === 'SvelteComponent' || type === 'SvelteSelf';
		const inside = element || component ? node : host;

		if (type === 'BindDirective' && isNode(inside)) {
			const name = typeof node['name'] === 'string' ? node['name'] : '';
			const at = span(node);
			const value = span(node['expression']);
			const tag = typeof inside['name'] === 'string' ? inside['name'] : '';
			const onElement =
				inside['type'] === 'RegularElement' || inside['type'] === 'SvelteElement';

			// A get/set pair. The server calls the getter and writes what it returns, which is a
			// rewrite this has not been taught.
			if (isNode(node['expression']) && node['expression']['type'] === 'SequenceExpression') {
				refuse(
					`\`bind:${name}\` with a getter and a setter is not handled yet: the server calls ` +
						'the getter and writes what it returns',
				);
			}

			const dropped =
				name === 'this' ||
				OMITTED_IN_SSR.has(name) ||
				(onElement && name === 'value' && (tag === 'select' || fileInput(inside)));

			if (dropped) {
				if (at !== null) edits.push([at[0], at[1], '']);
			} else if (onElement && CONTENT_BINDINGS.has(name)) {
				refuse(
					`\`bind:${name}\` is not handled yet: the server writes the value as the element's ` +
						'content rather than as an attribute, so it replaces the children rather than ' +
						'standing among them',
				);
			} else if (onElement && name === 'value' && tag === 'textarea') {
				refuse(
					'`bind:value` on a `<textarea>` is not handled yet: the server writes the value as ' +
						"the element's content rather than as an attribute",
				);
			} else if (onElement && name === 'group') {
				refuse(
					'`bind:group` is not handled yet: the server writes `checked`, computed from this ' +
						"value together with the element's own `value` attribute rather than from either " +
						'alone',
				);
			} else if (at !== null && value !== null) {
				edits.push([at[0], at[1], `${name}={${source.slice(value[0], value[1])}}`]);
			}
		}

		for (const one of Object.values(node)) walk(one, inside);
	};
	walk(ast['fragment'], null);

	return edits.length === 0 ? source : apply(source, edits);
}

/** Svelte's `CONTENT_EDITABLE_BINDINGS`, which the server writes as content rather than markup. */
const CONTENT_BINDINGS: ReadonlySet<string> = new Set(['textContent', 'innerHTML', 'innerText']);

/** An input the visitor skips `bind:value` on, told by a literal `type="file"` the way it tells. */
function fileInput(node: AstNode): boolean {
	if (node['name'] !== 'input') return false;
	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	return attributes.some((one) => {
		if (!isNode(one) || one['type'] !== 'Attribute' || one['name'] !== 'type') return false;
		const parts = Array.isArray(one['value']) ? one['value'] : [one['value']];
		const [only] = parts;
		return isNode(only) && only['type'] === 'Text' && only['data'] === 'file';
	});
}

function rewrite(
	source: string,
	taken: (block: number, branch: number) => boolean,
	file: string,
	root: string,
): Rewritten {
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
	const copies: Copy[] = [];
	const prelude: string[] = [];
	collect(
		source,
		ast['fragment'],
		holes,
		edits,
		blocks,
		taken,
		'body',
		declared.rewrite,
		snippets,
		pending,
		[],
		{ file, root, imports: importsOf(source), copies, stack: [file], prelude },
	);
	withPrelude(source, ast, prelude, edits);

	return { rewritten: apply(source, edits), holes, blocks, pending, copies };
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
	pending.push({
		index,
		tests,
		kind: 'class',
		names: directives.map((one) => String(one['name'])),
		base,
	});

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
 * `style:` is the same decision as `class:`, with the value written inside the outcome.
 *
 * Read out of `build_attr_style` and `to_style`. It is not the cheap half of the pair the way an
 * earlier note in spec/refusals.md guessed: the whole attribute is reassembled. The base is
 * re-parsed as CSS -- comments stripped, quotes and parentheses tracked -- every declaration in it
 * whose name a directive also names is **dropped**, each surviving one is re-emitted as ` x;`, then
 * the directives are appended, normal ones first and `!important` ones after, and the result is
 * trimmed. So `style="color:red"` beside a directive is not written as it was written.
 *
 * A declaration is present when its value is neither null nor the empty string, which is a decision
 * with the value substituted inside it. That is what stopped this before: a marker can stand where
 * the value goes, and nothing could stand where the declaration's presence is decided. Enumerating
 * gives both -- `2^n` outcomes, each one built by calling `attr_style` with markers for the values
 * that are present -- and **each outcome gets markers of its own**, so a value that appears in half
 * the outcomes is still a hole consumed exactly once.
 *
 * @returns the attributes this took charge of, which the caller must not walk again.
 */
function styles(
	source: string,
	node: AstNode,
	holes: Hole[],
	edits: [number, number, string][],
	expand: Locals['rewrite'],
	pending: PendingChoice[],
): ReadonlySet<unknown> {
	const empty: ReadonlySet<unknown> = new Set();
	if (node['type'] !== 'RegularElement') return empty;
	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	const directives = attributes.filter(
		(one): one is AstNode => isNode(one) && one['type'] === 'StyleDirective',
	);
	if (directives.length === 0) return empty;

	const attribute = attributes.find(
		(one) => isNode(one) && one['type'] === 'Attribute' && one['name'] === 'style',
	);
	let base = '';
	if (isNode(attribute)) {
		const value = attribute['value'];
		const parts = value === true ? [] : Array.isArray(value) ? value : [value];
		if (!parts.every((part) => isNode(part) && part['type'] === 'Text')) {
			refuse(
				'`style:` beside a `style` whose value is an expression is not handled yet: the ' +
					'attribute is reassembled from both, and a declaration in that value whose name a ' +
					'directive also names is dropped, so which bytes exist is decided by a string that ' +
					'only exists per request',
			);
		}
		base = parts.map((part) => String((part as AstNode)['data'] ?? '')).join('');
	}

	const declarations: PendingChoice['declarations'] & object = [];
	const tests: string[] = [];
	for (const one of directives) {
		const raw = typeof one['name'] === 'string' ? one['name'] : '';
		// `to_css_name`: a custom property keeps its case, everything else is lowered.
		const name = raw.startsWith('--') ? raw : raw.toLowerCase();
		const important = Array.isArray(one['modifiers']) && one['modifiers'].includes('important');
		const value = one['value'];
		// The shorthand, which Svelte reads as the variable of the same name.
		const parts = value === true ? null : Array.isArray(value) ? value : [value];

		if (parts !== null && parts.every((part) => isNode(part) && part['type'] === 'Text')) {
			const text = parts.map((part) => String((part as AstNode)['data'] ?? '')).join('');
			// Written text, so it is present or not once and for all rather than per request.
			declarations.push({ name, important, literal: text === '' ? null : text, expression: null });
			continue;
		}

		const only = parts === null ? one['expression'] : parts.length === 1 ? parts[0] : undefined;
		const inner = parts === null ? only : isNode(only) ? only['expression'] : undefined;
		if (!isNode(inner)) {
			refuse(
				`\`style:${raw}\` mixes text and an expression, which Svelte joins into one value; ` +
					'this reads a single expression, so write the whole value as one',
			);
		}
		const written = expand(inner);
		declarations.push({ name, important, literal: null, expression: written });
		// Svelte's own test, from `append_styles`: `value != null && value !== ''`. Truthiness is
		// not it -- `style:width={0}` writes `width: 0;`.
		tests.push(`(${written}) != null && (${written}) !== ''`);
	}

	if (1 << tests.length > CHOICES) {
		refuse(
			`this element has ${String(tests.length)} \`style:\` directives with values decided per ` +
				`request, which is ${String(1 << tests.length)} outcomes to enumerate. The mechanism is ` +
				`enumeration, so the limit is ${String(CHOICES)}`,
		);
	}

	const index = holes.length;
	holes.push({ index, expression: '', raw: false, choice: { tests, outcomes: [] } });
	pending.push({ index, tests, kind: 'style', names: [], base, declarations });

	for (const one of directives) {
		const at = span(one);
		if (at !== null) edits.push([at[0], at[1], `style:${String(one['name'])}={null}`]);
	}
	// A declaration of its own, so the render puts the marker inside a `style="..."` run and the
	// assembler finds the attribute the way it finds any other. Its name is not one a directive can
	// reserve, and a custom property keeps its case through `to_css_name`.
	const anchor = `style="--seam-at: ${sentinel(index)}"`;
	const at = span(attribute);
	if (at !== null) {
		edits.push([at[0], at[1], anchor]);
	} else {
		const last = Math.max(...attributes.map((one) => span(one)?.[1] ?? 0));
		edits.push([last, last, ` ${anchor}`]);
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

	const { attr_style } = await import('svelte/internal/server');

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
			// Not a fault in the decision. The usual cause is a component that was given markup and
			// rendered none of it -- a closed dialog, a collapsed panel -- which is what Svelte's own
			// server does with it and which leaves everything planted inside with nowhere to come
			// back from. See spec/refusals.md.
			refuse(
				`the ${one.kind} decision on this element was planted and no render brought ` +
					'it back. Markup this element sits inside was given to a component that rendered ' +
					'none of it, so there is nothing here to choose between',
			);
		}
		const table: string[] = [];
		if (one.kind === 'class') {
			for (let bits = 0; bits < 1 << one.names.length; bits++) {
				const directives: Record<string, boolean> = {};
				for (const [at, name] of one.names.entries()) directives[name] = ((bits >> at) & 1) === 1;
				table.push(attr_class(one.base, hash, directives));
			}
		} else {
			const declarations = one.declarations ?? [];
			const some = declarations.some((each) => each.important);
			for (let bits = 0; bits < 1 << one.tests.length; bits++) {
				const normal: Record<string, unknown> = {};
				const important: Record<string, unknown> = {};
				let test = 0;
				for (const each of declarations) {
					const bag = each.important ? important : normal;
					if (each.expression === null) {
						bag[each.name] = each.literal;
						continue;
					}
					const present = ((bits >> test) & 1) === 1;
					test += 1;
					if (!present) {
						bag[each.name] = null;
						continue;
					}
					// A marker of its own per outcome, so a value in half the outcomes is still a
					// hole planted once and consumed once.
					const at = holes.length;
					holes.push({ index: at, expression: each.expression, raw: false });
					bag[each.name] = sentinel(at);
				}
				table.push(attr_style(one.base, some ? [normal, important] : normal));
			}
		}
		const hole = holes[one.index];
		if (hole?.choice !== undefined) hole.choice.outcomes = table;
	}
}

/**
 * One rewritten source the render has to stage: the entry, and a copy of every child walked into.
 *
 * A copy per call site rather than per file. A component compiles to a plain call, so the same
 * module rendered twice writes the same markers twice, and a marker has to come back once --
 * measured, and the same thing that made a snippet rendered twice need one copy per render. The
 * copy also carries that call site's props, which is what makes the child's expressions expand to
 * the caller's values.
 *
 * `file` is the real path, and Svelte is told that one: the scoped class and the head anchor are
 * hashes of the filename relative to `rootDir`, so a staged copy under another name would move
 * them. `at` is the path the parent imports it by, and exists only to keep two call sites apart.
 */
/** Everything the walk of one file is carrying, so a walk into a child can start another. */
interface Walk {
	source: string;
	holes: Hole[];
	edits: [number, number, string][];
	blocks: Block[];
	taken: (block: number, branch: number) => boolean;
	stream: Stream;
	expand: Locals['rewrite'];
	pending: PendingChoice[];
	within: [number, number][];
	site: Site;
}

/**
 * Walks into the component a tag names, with its props bound to what the call site passes.
 *
 * **This is the one thing that makes a component more than a value written out.** A component
 * compiles to `Child($$renderer, { ...props })` with no anchor around what it writes, so from
 * outside it there is nothing to read: a value handed over and not written back is an absence, and
 * an absence is the same shape whether the child computed with it, used it twice, or never looked
 * at it. Measured across every shape a child can take -- see spec/refusals.md -- and the only way
 * to tell them apart is to be inside.
 *
 * From inside, none of them is a special case. The child's own expressions become the markers, and
 * each expands through the props to the caller's expression, so a prop used twice is two markers, a
 * prop never used is none, and a prop computed with is the computation. Nothing here knows which
 * of those it is doing.
 *
 * **A failure to descend is not a failure.** Anything this cannot follow is left to Svelte to
 * render exactly as before, which is what keeps this from refusing what already worked: the walk
 * is attempted, and everything it touched is rolled back if it stops. Returns whether it took the
 * component over.
 */
function descend(node: AstNode, walk: Walk): boolean {
	const tag = typeof node['name'] === 'string' ? node['name'] : '';
	const specifier = walk.site.imports[tag];
	// Only a component this project holds. A package's is Svelte's to render, and its file is not
	// one this compiler is arranged to rewrite.
	if (specifier === undefined || !specifier.startsWith('.') || !specifier.endsWith('.svelte')) {
		return false;
	}
	const file = resolvePath(dirname(walk.site.file), specifier);
	if (walk.site.stack.includes(file)) {
		refuse(
			`<${tag} /> is part of a cycle -- ${[...walk.site.stack, file]
				.map((one) => basename(one))
				.join(' -> ')} -- and a compile-time render of one does not end`,
		);
	}

	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	const fragment = node['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	// Markup inside the tag is a `children` snippet the child is handed, and following that is
	// following a snippet across a file, which is not written. Left to Svelte, as before.
	if (nodes.length > 0) return false;
	if (attributes.some((one) => isNode(one) && one['type'] === 'SpreadAttribute')) return false;

	// What the call site passes, as expressions in the caller's own terms. A handler is bound to
	// null: it is never called while the bytes are written, and leaving it unbound would make the
	// child read a name nothing binds.
	const bindings = new Map<string, string>();
	for (const one of attributes) {
		if (!isNode(one) || one['type'] !== 'Attribute') return false;
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
		if (parts.length !== 1 || !isNode(only) || only['type'] !== 'ExpressionTag') return false;
		bindings.set(name, `(${walk.expand(only['expression'])})`);
	}

	// Where to roll back to. Everything below appends to lists the caller owns.
	const mark = {
		holes: walk.holes.length,
		blocks: walk.blocks.length,
		edits: walk.edits.length,
		pending: walk.pending.length,
		copies: walk.site.copies.length,
	};

	try {
		const raw = inlined(unbound(readFileSync(file, 'utf8')));
		const declared = locals(raw);
		const inner: [number, number, string][] = [];
		for (const [[from, to], empty] of declared.reading) inner.push([from, to, empty]);

		const ast = parse(raw, { modern: true }) as unknown as AstNode;
		const prelude: string[] = [];
		const snippets = new Map<string, Snippet>();
		snippetsIn(ast['fragment'], snippets);

		// Every prop the child declares, bound to what the call site passes or to its own default.
		// A default only fires on `undefined`, which is what a prop the caller left out is.
		const declares = propsOf(ast, raw);
		if (declares === null) return rolled(walk, mark);
		const bound = new Map<string, string>();
		for (const one of declares) {
			const given = bindings.get(one.prop);
			bound.set(one.local, given ?? one.fallback);
		}

		// A copy per call site, so two of the same component do not write one marker twice.
		const at = resolvePath(
			dirname(walk.site.file),
			`__seam-${basename(file, '.svelte')}-${String(walk.site.copies.length)}.svelte`,
		);
		const copy: Copy = { file, at, source: '' };
		walk.site.copies.push(copy);

		collect(
			raw,
			ast['fragment'],
			walk.holes,
			inner,
			walk.blocks,
			walk.taken,
			walk.stream,
			(child, extra) => declared.rewrite(child, new Map([...bound, ...(extra ?? new Map())])),
			snippets,
			walk.pending,
			walk.within,
			{
				file,
				root: walk.site.root,
				imports: importsOf(raw),
				copies: walk.site.copies,
				stack: [...walk.site.stack, file],
				prelude,
			},
		);
		withPrelude(raw, ast, prelude, inner);
		copy.source = apply(raw, inner);

		// The values stay where they were written and are handed to the render as nothing. The
		// child's markers already carry the expressions, so what the call site passes is dead --
		// and live, it would be evaluated against data the render is not given.
		for (const one of attributes) {
			if (!isNode(one) || one['type'] !== 'Attribute') continue;
			const value = one['value'];
			const parts = value === true ? [] : Array.isArray(value) ? value : [value];
			const whole = span(one);
			// `{p}` is `p={p}`, and the short form's braces hold a bare name and nothing else, so
			// the whole attribute is written out rather than its value replaced. The same thing a
			// marker planted in one costs, met again.
			if (whole !== null && walk.source[whole[0]] === '{') {
				const name = typeof one['name'] === 'string' ? one['name'] : '';
				walk.edits.push([whole[0], whole[1], `${name}={null}`]);
				continue;
			}
			for (const part of parts) {
				if (!isNode(part) || part['type'] !== 'ExpressionTag') continue;
				const where = span(part['expression']);
				if (where !== null) walk.edits.push([where[0], where[1], 'null']);
			}
		}

		// The parent imports this call site's copy rather than the file, which is two edits: the
		// tag's name where it opens and where it closes, and one import beside the others.
		rename(walk, node, tag, at);
		return true;
	} catch (error) {
		// Rolled back, and the component is rendered by Svelte the way it was before this tried.
		// A refusal from inside a child is a refusal about a file the author did not ask to
		// compile, so it is not theirs to see.
		rolled(walk, mark);
		if (String((error as Error).message).includes('is part of a cycle')) throw error;
		return false;
	}
}

/** Puts back what a walk that did not finish appended, and says it did not take the component. */
function rolled(walk: Walk, mark: Record<string, number>): false {
	walk.holes.length = mark['holes'] ?? 0;
	walk.blocks.length = mark['blocks'] ?? 0;
	walk.edits.length = mark['edits'] ?? 0;
	walk.pending.length = mark['pending'] ?? 0;
	walk.site.copies.length = mark['copies'] ?? 0;
	return false;
}

/**
 * The imports a rewritten source needs that its author did not write, put where imports go.
 *
 * Into the instance script, or into one made for the purpose. A module script would not do: what
 * it declares is shared by every instance, and these are per call site.
 */
function withPrelude(
	source: string,
	ast: AstNode,
	prelude: readonly string[],
	edits: [number, number, string][],
): void {
	if (prelude.length === 0) return;
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const at = isNode(content) ? content['start'] : undefined;
	if (typeof at === 'number') {
		edits.push([at, at, `\n${prelude.join('\n')}\n`]);
		return;
	}
	edits.push([0, 0, `<script>\n${prelude.join('\n')}\n</script>\n`]);
}

/**
 * What a component's `$props()` binds: the name the markup uses, the prop it arrives as, and what
 * it holds when the call site passes nothing.
 *
 * A prop the caller leaves out is its default, and where there is no default it is `undefined` --
 * which is what Svelte's own output does, since `$props()` destructures the props object. Missing
 * this wrote the wrong bytes rather than refusing, and only the comparison against Svelte said so.
 *
 * Null where the pattern is one this cannot read: a rest element gathers whatever was not named,
 * and what that is at the call site is a set of keys rather than a value.
 */
function propsOf(ast: AstNode, source: string): { local: string; prop: string; fallback: string }[] | null {
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	const found: { local: string; prop: string; fallback: string }[] = [];

	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'VariableDeclaration') continue;
		const declarations = Array.isArray(statement['declarations']) ? statement['declarations'] : [];
		for (const one of declarations) {
			if (!isNode(one)) continue;
			const init = one['init'];
			const callee = isNode(init) ? init['callee'] : undefined;
			if (!isNode(callee) || callee['name'] !== '$props') continue;
			const id = one['id'];
			if (!isNode(id) || id['type'] !== 'ObjectPattern') return null;
			for (const property of Array.isArray(id['properties']) ? id['properties'] : []) {
				if (!isNode(property) || property['type'] !== 'Property') return null;
				const key = property['key'];
				const value = property['value'];
				if (!isNode(key) || typeof key['name'] !== 'string' || !isNode(value)) return null;
				if (value['type'] === 'Identifier' && typeof value['name'] === 'string') {
					found.push({ local: value['name'], prop: key['name'], fallback: 'undefined' });
					continue;
				}
				// `p = 1`, which is the default, and it is the only other shape this reads.
				const left = value['type'] === 'AssignmentPattern' ? value['left'] : undefined;
				const right = value['type'] === 'AssignmentPattern' ? span(value['right']) : null;
				if (!isNode(left) || typeof left['name'] !== 'string' || right === null) return null;
				found.push({
					local: left['name'],
					prop: key['name'],
					fallback: source.slice(right[0], right[1]),
				});
			}
		}
	}
	return found;
}

/** Every import a file declares, by the name it binds, read the way `reduce` reads them. */
function importsOf(source: string): Record<string, string> {
	return reduce(source).imports;
}

/**
 * Points one component tag at a copy of its own: the name where it opens and closes, and an import.
 */
function rename(walk: Walk, node: AstNode, tag: string, at: string): void {
	const span = [node['start'], node['end']];
	const [from, to] = span;
	if (typeof from !== 'number' || typeof to !== 'number') return;
	const fresh = `${tag}$${String(walk.site.copies.length - 1)}`;
	const text = walk.source.slice(from, to);
	walk.edits.push([from + 1, from + 1 + tag.length, fresh]);
	if (text.endsWith(`</${tag}>`)) {
		walk.edits.push([to - 1 - tag.length, to - 1, fresh]);
	}
	const relative = `./${basename(at)}`;
	walk.site.prelude.push(`import ${fresh} from '${relative}';`);
}

/**
 * Where a walk is, so that it can walk into a component the way Node would resolve it.
 *
 * `stack` is the files already open, and a component that names one of them is refused rather than
 * followed: a compile-time render of a cycle does not end. That is `compose()` in
 * `crates/lowering/src/lower.rs`, which has had this since the other lowering path was written.
 */
interface Site {
	file: string;
	root: string;
	/** Local name to specifier, for this file, so `<Card />` finds the file it was imported from. */
	imports: Record<string, string>;
	copies: Copy[];
	stack: string[];
	/** Imports the rewritten source needs that the author did not write: one per copy taken. */
	prelude: string[];
}

interface Copy {
	file: string;
	at: string;
	source: string;
}

/** Both of Svelte's output streams, because reading only one of them loses content silently. */
interface Rendered {
	body: string;
	head: string;
}

interface Rewritten {
	rewritten: string;
	/** Every child walked into, as the source the render has to stage in its place. */
	copies: Copy[];
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
	// Before anything reads it: a snippet rendered more than once becomes one copy per call, which
	// is what the render does with it anyway and what leaves every pass below the case it knows.
	const source = inlined(unbound(readFileSync(file, 'utf8')));

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

	// The first branch of every if, and every each with one item. An if with no `{:else if}` has
	// only that branch, so this is what "everything taken" used to mean.
	const baseline = rewrite(source, (_block, branch) => branch === 0, file, root);

	// After the walk, not before it. Every name has to come from somewhere -- this pass renders
	// rather than reading the markup, so a name nothing binds reaches Svelte's own renderer,
	// evaluates to undefined and writes an empty string. But a construct the compiler has not been
	// taught usually binds names of its own: `{#await}` binds its `:then`, a snippet binds its
	// parameters. Checking names first reports the name and hides the construct, which points the
	// author at the wrong thing. The walk above refuses the construct, so what reaches here is a
	// name in markup the compiler does understand.
	resolved(source, basename(file));
	const { body: html, head } = await renderRewritten(file, baseline.rewritten, root, baseline.copies);

	// One more render per branch the baseline does not hold, keyed the way Svelte numbers them:
	// `1`, `2` for each `{:else if}`, and `-1` for the else, which is what it writes into the
	// marker that opens the branch. Every other block stays on its first branch, which is what
	// keeps this one reachable.
	const alternates: Record<string, Rendered> = {};
	for (const block of baseline.blocks) {
		if (block.kind !== 'if') continue;
		const wanted = [...(block.tests ?? []).keys()].slice(1);
		// The else always gets a render, with or without a `{:else}` written: Svelte opens the
		// branch either way and an empty one is still the bytes for an if that is not taken.
		for (const branch of [...wanted, -1]) {
			// The ancestors go back on the branch that makes this block exist, or the render would
			// not hold it and there would be nothing to read.
			const forced = new Map(block.within ?? []);
			const chosen = (index: number, at: number) =>
				index === block.index ? at === branch : at === (forced.get(index) ?? 0);
			const flipped = rewrite(source, chosen, file, root);
			alternates[`${String(block.index)}.${String(branch)}`] = await renderRewritten(
				file,
				flipped.rewritten,
				root,
				flipped.copies,
			);
		}
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

async function renderRewritten(
	file: string,
	source: string,
	root: string,
	copies: readonly Copy[] = [],
): Promise<Rendered> {
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
			// A copy resolves its own relative imports from where its original sits, not from the
			// name it was staged under.
			const replacement = specifier.endsWith('.svelte')
				? emit(target, compileFile(target), staged.get(target)?.file ?? target)
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

	// A copy is compiled from what the walk rewrote, under the name of the file it copies: the
	// scoped class and the head anchor are hashes of that filename, so telling Svelte the staged
	// name would move both.
	const staged = new Map(copies.map((one) => [one.at, one]));

	function compileFile(target: string): string {
		const copy = staged.get(target);
		const from = copy?.file ?? target;
		return compile(copy?.source ?? read(target, 'utf8'), {
			generate: 'server',
			name: basename(from, '.svelte'),
			filename: from,
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
