import { readFileSync } from 'node:fs';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { parse } from 'svelte/compiler';
import { apply, constant, destructure, type Locals, locals, mentions, settle } from 'ast';
import { classes, type PendingChoice, type PendingSpread, spread, styles } from './attributes.ts';
import {
	hands,
	identity,
	importsOf,
	inert,
	partial,
	propsOf,
	rebased,
	rename,
	rolled,
	withPrelude,
} from './compose.ts';
import {
	type AstNode,
	called,
	declarationOf,
	elseIf,
	extent,
	holdsFor,
	identified,
	isNode,
	namesIn,
	refuse,
	relatesSiblings,
	renders,
	span,
} from './node.ts';
import { OMITTED_IN_SSR } from './omitted.ts';
import { carrier, elementCarrier, sentinel } from './sentinel.ts';
import type { Block, Hole, Stream } from './shape.ts';
import { inlined, type Snippet, snippetsIn, supplied } from './snippets.ts';
import { RAW_TEXT_ELEMENTS, VALID_TAG_NAME, VOID_ELEMENTS } from './tags.ts';
import { unbound } from './unbind.ts';

/**
 * The walk: one pass over the markup that plants a marker wherever a value goes and follows a
 * component call into the component it names.
 *
 * `collect` and `descend` call each other, which is the whole of composition -- a child's own
 * expressions become the markers, expanded through the props to the caller's expression, so a prop
 * used twice is two markers and a prop never used is none. They are in one file because they are
 * one recursion.
 */

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
export interface Copy {
	file: string;
	at: string;
	source: string;
	/**
	 * The hole standing for this component's `$props.id()` anchor, where it declares one. The
	 * render puts the hole's marker where Svelte's helper would have put the id. See `render.ts`.
	 */
	fresh?: number;
}

/** One component's children, and the holes and blocks the walk put inside them. */
export interface Handed {
	/** The literal planted at the head of the group while probing. */
	probe: string;
	/** The component and the name the group arrives under, as a refusal says it. */
	what: string;
	holes: [number, number];
	blocks: [number, number];
	/**
	 * Why the group cannot be compiled if the component writes it, or undefined where it can.
	 *
	 * A passed snippet that reads one of its parameters as a value has nothing standing in that
	 * value's place, but that only matters where the component calls it during the render. Where
	 * it does not -- a closed menu, which writes none of what it is given -- the body is content
	 * the client makes and the server never had, which is what spec/refusals.md says of every
	 * client-only thing. So the walk records the reason here and the probe decides. See
	 * `supplied()`.
	 */
	reads?: string;
}

/** One caller's markup, and everything needed to walk it in the scope it was written in. */
export interface Given {
	source: string;
	nodes: unknown[];
	expand: Locals['rewrite'];
	edits: [number, number, string][];
	snippets: ReadonlyMap<string, Snippet>;
	site: Site;
}

/**
 * Where a walk is, so that it can walk into a component the way Node would resolve it.
 *
 * `stack` is the files already open, and a component that names one of them is refused rather than
 * followed: a compile-time render of a cycle does not end. That is `compose()` in
 * `crates/lowering/src/lower.rs`, which has had this since the other lowering path was written.
 */
export interface Site {
	file: string;
	root: string;
	/** Local name to specifier, for this file, so `<Card />` finds the file it was imported from. */
	imports: Record<string, string>;
	copies: Copy[];
	stack: string[];
	/** Imports the rewritten source needs that the author did not write: one per copy taken. */
	prelude: string[];
	/**
	 * Why a component was left to Svelte, one line each.
	 *
	 * A walk that stops is rolled back and the component is rendered as it was before, which is
	 * what keeps this from refusing what already worked. But when the render then fails -- and it
	 * does whenever the child does more with a prop than write it -- the author was shown Svelte's
	 * crash and never the refusal that led to it. These are kept so that failure can say both.
	 */
	missed: { file: string; reason: string }[];
	/**
	 * Markup this component was handed by its caller, by the name it arrives under.
	 *
	 * Written inside a component's tag, markup becomes an arrow function passed as `children` --
	 * `visitors/shared/component.js` builds it -- and the child renders it with `{@render
	 * children()}`. So it is walked where the child renders it rather than where it was written:
	 * the markers go into the caller's source, which is where Svelte compiled the body, and the
	 * blocks are numbered where the assembler will meet them.
	 */
	given: ReadonlyMap<string, Given>;
	/**
	 * The names the payload arrives under, which is what the entry's `$props()` destructures.
	 *
	 * A marker stands where request-varying data goes. In the entry every markup expression may be
	 * one, because its props are the payload; inside a child most are not, and one that reaches
	 * none of these is the same bytes every request. Planting a marker there made the render
	 * evaluate it per request instead -- which for `<Provider client={queryClient}>` meant a new
	 * client per request, and a marker where a package expected an object with methods.
	 *
	 * Null where the entry's props are a shape this cannot read, which keeps the older behaviour
	 * of planting one everywhere rather than guessing.
	 */
	payload: ReadonlySet<string> | null;
	/**
	 * Markup handed to a component the walk could not enter, with what was planted in it.
	 *
	 * A component is a plain call, so from outside it there is no way to tell markup a component
	 * never rendered from markup whose values it mangled. What settles it is a second render with
	 * each of these replaced by a literal nobody could produce. See `Hole.safe`.
	 */
	handed: Handed[];
	/** Elements whose attributes a spread decides, waiting for the rest of their call. */
	spreads: PendingSpread[];
	/** The copy this walk is rewriting, or null for the entry. */
	copy: Copy | null;
	/**
	 * True while making that second render: the markup is replaced rather than walked, so nothing
	 * is planted in it and what comes back says only whether the component writes it.
	 */
	probing: boolean;
	/**
	 * Payload paths this render is being made for, as literal source text.
	 *
	 * The build declares a field's domain and the compiler renders once per value; in each of those
	 * renders the path is not a hole but a literal, so nothing stands for it and everything reading
	 * it -- the expressions the walk carries, and the markup left for Svelte to evaluate -- says the
	 * same thing. Rooted at the payload, so a child gets them rebased through what its call site
	 * passes. See spec/pipeline.md.
	 */
	fixed: ReadonlyMap<string, string>;
	/**
	 * Which branch each `?:` handed to a component the walk could not enter takes in this render,
	 * keyed by the test's source text.
	 *
	 * A ternary handed to code the compiler cannot read chooses what is handed rather than writing
	 * a value, so a marker cannot stand for it. It is a decision with two outcomes and the build
	 * renders once per branch, the way it renders once per value of a declared domain. In payload
	 * terms already, so a child needs no rebasing of it. See `Undecided`, and spec/refusals.md.
	 */
	decided: ReadonlyMap<string, boolean>;
}

/**
 * A `?:` in a value handed to a component the walk could not enter, which this render was not told
 * how to take.
 *
 * Not a refusal. The walk stops so that the build can make this render twice, once per branch,
 * and `test` is what it asks the build to decide. It goes up as its own type because `descend`
 * turns every other error into a component left to Svelte, and this is the walk asking for
 * something rather than failing at it.
 */
export class Undecided extends Error {
	readonly test: string;
	constructor(test: string) {
		super(`\`${test}\` chooses what a component is given, and this render was not told which way`);
		this.test = test;
	}
}

/** Everything the walk of one file is carrying, so a walk into a child can start another. */
export interface Walk {
	source: string;
	holes: Hole[];
	edits: [number, number, string][];
	blocks: Block[];
	taken: (block: number, branch: number) => boolean;
	stream: Stream;
	expand: Locals['rewrite'];
	/** The rune a declared name was written with, which decides whether a tag naming it is dynamic. */
	runeOf: Locals['rune'];
	/** Every snippet this component declares, by name, with how many parameters it takes. */
	snippets: ReadonlyMap<string, Snippet>;
	pending: PendingChoice[];
	within: [number, number][];
	site: Site;
	/** What the request decides, in the scope the call site sits in. */
	dynamic: ReadonlySet<string>;
	/**
	 * The names of the ids the enclosing components bind, outermost first. In `dynamic` as well,
	 * since an id is decided when the bytes are written; kept apart because a ternary reading one is
	 * not a choice made per item.
	 */
	fresh: readonly string[];
	/**
	 * The element the walk is directly inside, by tag name, or null where it is not inside one this
	 * file writes: the root, or markup handed to a component, which puts it wherever it likes. It
	 * decides what a block's stamp is carried by and nothing else. See `carrier()`.
	 */
	parent: string | null;
	/**
	 * Whether this file's stylesheet relates siblings, which decides whether a stamp that has to be
	 * an element may be written at all. See `stamps()`.
	 */
	siblings: boolean;
	/**
	 * Names an enclosing passed snippet's parameters bind, which the component supplies.
	 *
	 * A `{@render}` of one of these is the component handing back markup of its own, so nothing is
	 * planted for it and the render writes whatever it writes. See `supplied()`.
	 */
	handed?: ReadonlySet<string>;
	/**
	 * The value the enclosing `<select>` was given, and whether it is `multiple`.
	 *
	 * Svelte's renderer omits the select's `value` and writes ` selected=""` on whichever option
	 * matches it, read out of `renderer.js`. So the decision is the option's, and every option
	 * under the select gets one, as a boolean attribute nothing in the source wrote.
	 */
	selecting?: { value: string; multiple: boolean };
	/**
	 * True while walking a prop of a component the walk could not enter.
	 *
	 * The value is going somewhere this pass cannot read, so what stands for it has to survive
	 * being *used* rather than only being written out. An object is the case that does not: one
	 * marker for the whole of `{ count: n }` hands the component a string, and the field it reads
	 * off it is undefined. The marker goes on each value instead, so the object is still an object.
	 */
	opaque?: boolean;
}

export interface Rewritten {
	rewritten: string;
	/** Every child walked into, as the source the render has to stage in its place. */
	copies: Copy[];
	/** Every child left to Svelte instead, and why the walk stopped. */
	missed: { file: string; reason: string }[];
	/** Markup handed to one of those, with the holes and blocks the walk put inside it. */
	handed: Handed[];
	/** Elements whose attributes a spread decides, waiting for the rest of their call. */
	spreads: PendingSpread[];
	holes: Hole[];
	blocks: Block[];
	/** Class decisions whose outcomes the render has still to supply the hash for. */
	pending: PendingChoice[];
	/** The hole standing for the entry's own `$props.id()` anchor, where it declares one. */
	fresh?: number;
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
	SvelteFragment: '`<svelte:fragment>` is not handled yet',
	SvelteSelf: '`<svelte:self>` is not handled yet: composition does not yet follow a cycle',
	SvelteComponent: '`<svelte:component>` chooses a component from a value, which is not decided',
	SlotElement: '`<slot>` is not handled yet. Snippets replaced it, and neither is written',
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
/** One name the markup inside a component's tag arrives under, and the literal that measures it. */
interface Group {
	/** Where the literal goes: the head of the group, in the source. */
	at: number;
	probe: string;
	/** The component and the name, as a refusal says it. */
	what: string;
}

/**
 * What a component is handed, by the name each part of it arrives under.
 *
 * Read out of `visitors/shared/component.js`. The markup inside a component's tag is not one
 * thing. Every `{#snippet}` directly inside it is hoisted and pushed as a prop of its own under
 * its own name; a child carrying `slot="x"` joins the group of that name; everything left over
 * becomes one function passed as `children`. So a component may write one group and not another,
 * and asking about the tag as a whole cannot tell that from a fault -- which is what
 * `<DropdownMenu.Trigger>` was: markup measured as one group, part of it written, and the
 * arithmetic reporting a contradiction that was never there.
 *
 * Keyed by the child so the walk stays in document order, which is the order the ordinals count in.
 */
function handedTo(
	file: string,
	tag: string,
	nodes: readonly unknown[],
): ReadonlyMap<unknown, Group> {
	const found = new Map<unknown, Group>();
	const groups = new Map<string, Group>();
	const under = (name: string, at: number): Group => {
		const held = groups.get(name);
		if (held !== undefined) return held;
		const one: Group = {
			at,
			probe: `%%h${identity(file, at)}%%`,
			what: name === 'children' ? `\`<${tag}>\`` : `\`<${tag}>\` as \`${name}\``,
		};
		groups.set(name, one);
		return one;
	};

	for (const child of nodes) {
		if (!isNode(child)) continue;
		if (child['type'] === 'SnippetBlock') {
			const id = child['expression'];
			const name = isNode(id) && typeof id['name'] === 'string' ? id['name'] : '';
			// The body, so the declaration keeps its name and the component still receives the prop.
			// An empty one holds nothing to measure and nothing to relax.
			const at = extent(child['body'])?.[0];
			if (name === '' || at === undefined) continue;
			found.set(child, under(name, at));
			continue;
		}
		// Whitespace and comments are not content: Svelte's analysis lets them sit beside an
		// explicit `{#snippet children}` and refuses anything else with `snippet_conflict`. So they
		// open no group, or the literal planted at the group's head would be the content that
		// conflicts, and every probe of a tag written across lines would fail before it measured.
		if (child['type'] === 'Comment') continue;
		if (child['type'] === 'Text' && String(child['data'] ?? '').trim() === '') continue;
		const at = span(child)?.[0];
		if (at === undefined) continue;
		found.set(child, under(slotOf(child) ?? 'children', at));
	}
	return found;
}

/**
 * What a parameter binds, each name as the expression that reaches it from the argument.
 *
 * The same substitution a destructured declaration gets, with the way in written after the
 * argument, and a default written the way JavaScript reads one: taken when the value is
 * `undefined` and only then. A rest or a nesting is neither a member nor an index, so it has no
 * way in and is refused by name -- here rather than three passes later as an unresolved name.
 */
function takenApart(
	pattern: AstNode,
	argument: string,
	expand: Locals['rewrite'],
	what: () => string,
): Map<string, string> {
	const bound = new Map<string, string>();
	const withDefault = (reached: string, fallback: unknown): string =>
		`(${reached} === undefined ? (${expand(fallback)}) : ${reached})`;
	const one = (target: unknown, reached: string): void => {
		if (!isNode(target)) return;
		if (target['type'] === 'Identifier' && typeof target['name'] === 'string') {
			bound.set(target['name'], reached);
			return;
		}
		if (target['type'] === 'AssignmentPattern') {
			one(target['left'], withDefault(reached, target['right']));
		}
	};
	if (pattern['type'] === 'ObjectPattern') {
		for (const property of Array.isArray(pattern['properties']) ? pattern['properties'] : []) {
			if (!isNode(property) || property['type'] !== 'Property') continue;
			const key = property['key'];
			if (property['computed'] === true || !isNode(key) || typeof key['name'] !== 'string')
				continue;
			one(property['value'], `${argument}.${key['name']}`);
		}
	} else if (pattern['type'] === 'ArrayPattern') {
		for (const [at, element] of (Array.isArray(pattern['elements'])
			? pattern['elements']
			: []
		).entries()) {
			one(element, `${argument}[${String(at)}]`);
		}
	} else {
		one(pattern, argument);
	}
	// The names the pattern binds, and not the ones a default reads: `{ a = data.d }` binds `a`.
	const all = new Set<string>();
	const binding = (target: unknown): void => {
		if (!isNode(target)) return;
		if (target['type'] === 'Identifier' && typeof target['name'] === 'string')
			all.add(target['name']);
		else if (target['type'] === 'AssignmentPattern') binding(target['left']);
		else if (target['type'] === 'RestElement') binding(target['argument']);
		else if (target['type'] === 'Property') binding(target['value']);
		else if (target['type'] === 'ObjectPattern') {
			for (const part of Array.isArray(target['properties']) ? target['properties'] : [])
				binding(part);
		} else if (target['type'] === 'ArrayPattern') {
			for (const part of Array.isArray(target['elements']) ? target['elements'] : []) binding(part);
		}
	};
	binding(pattern);
	const missing = [...all].filter((each) => !bound.has(each));
	if (missing.length > 0) {
		refuse(
			`${what()} binds ${missing.map((each) => `\`${each}\``).join(', ')} through a rest or ` +
				'a nesting, which is neither a member nor an index of the argument, so there is no way ' +
				'in to write down',
		);
	}
	return bound;
}

/** Writes each expression of an attribute back out in its expanded form, for Svelte to evaluate. */
function expanded(
	attr: AstNode,
	source: string,
	expand: Locals['rewrite'],
	edits: [number, number, string][],
): void {
	const name = typeof attr['name'] === 'string' ? attr['name'] : '';
	const value = attr['value'];
	if (value === true) return;
	const at = span(attr);
	// The shorthand holds a bare name and nothing else, so the name is written out first.
	if (at !== null && source[at[0]] === '{') edits.push([at[0], at[0], `${name}=`]);
	for (const part of Array.isArray(value) ? value : [value]) {
		if (!isNode(part) || part['type'] !== 'ExpressionTag') continue;
		const where = span(part['expression']);
		if (where !== null) edits.push([where[0], where[1], expand(part['expression'])]);
	}
}

/** Where an element's opening tag closes: the index of its `>`. */
function closing(source: string, node: AstNode): number {
	const at = span(node);
	let last = at === null ? 0 : at[0];
	for (const one of Array.isArray(node['attributes']) ? node['attributes'] : []) {
		const where = span(one);
		if (where !== null) last = Math.max(last, where[1]);
	}
	const close = source.indexOf('>', last);
	if (close < 0) refuse('an element this compiler cannot read the tag of');
	return close;
}

/** One attribute of an element by name, or undefined. */
function attributeOf(node: AstNode, name: string): AstNode | undefined {
	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	return attributes.find(
		(one): one is AstNode =>
			isNode(one) && one['type'] === 'Attribute' && String(one['name']).toLowerCase() === name,
	);
}

/**
 * A `<select value>` and the `<option>`s under it, read out of `renderer.js`.
 *
 * The renderer drops the select's `value` and keeps it aside; each option then compares its own
 * value against it as it closes -- `includes` where the select is `multiple` and the value an
 * array, `===` otherwise -- and writes ` selected=""` after its attributes when they match. An
 * option's own value is its `value` attribute, or the single expression that is its content,
 * which Svelte's analysis marks so a number stays a number, or otherwise its rendered text.
 *
 * So the select's value is cut from the render, which writes nothing for it, and every option
 * gets a boolean `selected` decided by the comparison, as a hole planted where the renderer
 * writes it: last, before the `>`. Returns what the children walk under.
 */
function selection(
	node: AstNode,
	source: string,
	expand: Locals['rewrite'],
	holes: Hole[],
	edits: [number, number, string][],
	selecting: Walk['selecting'],
	skipped: Set<unknown>,
): Walk['selecting'] {
	const tag = node['name'];
	if (tag === 'select') {
		if (attributeOf(node, 'defaultvalue') !== undefined) {
			refuse('`<select defaultValue>` is not handled yet: `value` is, and it reads the same');
		}
		const value = attributeOf(node, 'value');
		if (value === undefined) return undefined;
		const written = valueExpression(value, source, expand);
		if (written === null) {
			refuse(
				'`<select value>` mixing text and an expression is not handled yet: the options compare ' +
					'against the joined string',
			);
		}
		const at = span(value);
		if (at !== null) edits.push([at[0], at[1], '']);
		skipped.add(value);
		return { value: written, multiple: attributeOf(node, 'multiple') !== undefined };
	}
	if (tag !== 'option' || selecting === undefined) return selecting;

	const own = attributeOf(node, 'value');
	let compared: string | null;
	if (own !== undefined) {
		compared = valueExpression(own, source, expand);
	} else {
		const fragment = node['fragment'];
		const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
		const [only] = nodes;
		if (nodes.length === 1 && isNode(only) && only['type'] === 'ExpressionTag') {
			compared = `(${expand(only['expression'])})`;
		} else if (nodes.every((child) => isNode(child) && child['type'] === 'Text')) {
			compared = JSON.stringify(
				nodes
					.map((child) => String((child as AstNode)['raw'] ?? (child as AstNode)['data'] ?? ''))
					.join(''),
			);
		} else {
			compared = null;
		}
	}
	if (compared === null) {
		refuse(
			'an `<option>` under a `<select value>` whose own value is mixed content is not handled ' +
				'yet: the renderer compares against the rendered text, which is one value once written',
		);
	}
	const { value, multiple } = selecting;
	const test = multiple
		? `(Array.isArray(${value}) ? (${value}).includes(${compared}) : (${value}) === (${compared}))`
		: `(${value}) === (${compared})`;
	// An option's attributes are written by the runtime helper rather than folded into the
	// template, and the helper writes a boolean attribute as `=""` whatever its value, so a marker
	// planted as the value never comes back. It is a decision instead, the way a `class:` is: the
	// marker rides in an attribute of its own, written last, and the decision owns the whole of
	// that attribute -- the space, the name, the value -- and replaces it with what the renderer
	// writes there: nothing, or ` selected=""`. The outcomes need no render to be known.
	const index = holes.length;
	holes.push({
		index,
		expression: '',
		raw: false,
		choice: { tests: [test], outcomes: ['', ' selected=""'] },
	});
	const close = closing(source, node);
	edits.push([close, close, ` data-seam-selected={${JSON.stringify(sentinel(index))}}`]);
	return selecting;
}

/** An attribute's value as one expression: a literal for text, the expression for one, else null. */
function valueExpression(
	attribute: AstNode,
	source: string,
	expand: Locals['rewrite'],
): string | null {
	const value = attribute['value'];
	if (value === true) return 'true';
	const parts = Array.isArray(value) ? value : [value];
	if (parts.every((part) => isNode(part) && part['type'] === 'Text')) {
		return JSON.stringify(parts.map((part) => String((part as AstNode)['data'] ?? '')).join(''));
	}
	const [only] = parts;
	if (parts.length === 1 && isNode(only) && only['type'] === 'ExpressionTag') {
		return `(${expand(only['expression'])})`;
	}
	return null;
}

/**
 * `bind:innerHTML`, which the server writes unescaped as the element's content.
 *
 * `element.js`: the binding's expression is the body, written as it is when truthy and the
 * children otherwise. With no children that is `value || ''`, raw, and with no anchors around
 * it -- which is not `{@html}`, whose anchors the client reads. So the hole is planted as text
 * where the content goes, and the directive goes.
 */
function contents(
	node: AstNode,
	source: string,
	expand: Locals['rewrite'],
	holes: Hole[],
	edits: [number, number, string][],
	skipped: Set<unknown>,
): void {
	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	const binding = attributes.find(
		(one): one is AstNode =>
			isNode(one) && one['type'] === 'BindDirective' && one['name'] === 'innerHTML',
	);
	if (binding === undefined) return;
	const fragment = node['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	if (nodes.length > 0) {
		refuse(
			'`bind:innerHTML` on an element with children is not handled yet: the server writes the ' +
				'children only where the value is falsy, which is a decision per request',
		);
	}
	const at = span(binding);
	const close = closing(source, node);
	if (at === null || source[close - 1] === '/')
		refuse('`bind:innerHTML` on a tag this compiler cannot read');
	const index = holes.length;
	holes.push({ index, expression: `((${expand(binding['expression'])}) || '')`, raw: true });
	edits.push([at[0], at[1], '']);
	edits.push([close + 1, close + 1, sentinel(index)]);
	skipped.add(binding);
}

/** Whether a node is a `{#snippet}` declared under the given name. */
function snippetNamed(child: unknown, name: string): child is AstNode {
	if (!isNode(child) || child['type'] !== 'SnippetBlock') return false;
	const id = child['expression'];
	return isNode(id) && id['name'] === name;
}

/** Every name a snippet's parameters bind. */
function parameterNames(parameters: readonly unknown[]): Set<string> {
	const names = new Set<string>();
	for (const parameter of parameters) namesIn(parameter, names);
	return names;
}

/**
 * Why a snippet passed to a component cannot be compiled if the component writes it, or null.
 *
 * Only a `{#snippet}` written directly inside the tag, which is the prop the component calls with
 * arguments of its own. Where the body reads one of those as a value, the walk plants markers that
 * name something no render binds; that is fine in markup the component never writes and a refusal
 * in markup it does, and which of the two is the probe's to say. See `Handed.reads`.
 */
function reading(child: AstNode): string | null {
	if (child['type'] !== 'SnippetBlock') return null;
	if (supplied(child) !== null) return null;
	const id = child['expression'];
	const named = isNode(id) && typeof id['name'] === 'string' ? id['name'] : '';
	return (
		`the snippet \`${named}\` is passed to a component, which calls it with arguments this ` +
		'compiler cannot see, and it reads one of them as a value rather than rendering it, so ' +
		'there is nothing to stand in its place'
	);
}

/** The slot a child is written into, told by a literal `slot="x"` the way Svelte tells. */
function slotOf(node: AstNode): string | null {
	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	for (const one of attributes) {
		if (!isNode(one) || one['type'] !== 'Attribute' || one['name'] !== 'slot') continue;
		const parts = Array.isArray(one['value']) ? one['value'] : [one['value']];
		const [only] = parts;
		if (isNode(only) && only['type'] === 'Text' && typeof only['data'] === 'string') {
			return only['data'];
		}
	}
	return null;
}

/**
 * What stands in for a value handed to a component the walk could not enter, as source.
 *
 * The value is going somewhere this pass cannot read, so what stands for it has to survive being
 * *used* rather than only being written out. Three things follow, in order.
 *
 * A `?:` in it whose branches are not all things a marker can stand for chooses what is handed --
 * the case that forced this chose between two message functions. It is written as the branch this
 * render was told to take, and where it was not told, the walk stops and asks. See `settle` for
 * which ternaries those are; the rest are values and get a marker like anything else.
 *
 * A value the request does not decide is left as written, so Svelte evaluates it during the
 * render: `<Provider client={queryClient}>` is that, and so is the branch a settled ternary leaves
 * behind. The same rule `inert` applies to a whole attribute, one level in.
 *
 * An object or an array gets a marker at each value rather than one for the whole, so the fields
 * the component reads off it are still there. What is left gets one marker, and is reported if it
 * does not come back.
 */
function stands(expression: string, walk: Walk): string {
	const held = settle(expression, walk.site.decided, walk.dynamic);
	if (held.undecided !== null) {
		// A name a block binds is decided per item, and a decision over it cannot be enumerated for
		// the page: the derivation the branch would test has no item to read. The choice has another
		// spelling, which is the block that is taken per item.
		const scoped = new Set(
			[...walk.dynamic].filter(
				(one) => walk.site.payload?.has(one) !== true && !walk.fresh.includes(one),
			),
		);
		if (mentions(held.undecided, scoped)) {
			refuse(
				`\`${held.undecided}\` chooses what a component is given and reads a name an each block ` +
					'binds, so the choice is made per item and cannot be enumerated for the page. Write it ' +
					'as an `{#if}` around the component, which is a block and is taken per item',
			);
		}
		throw new Undecided(held.undecided);
	}
	const text = held.text;
	if (walk.site.payload !== null && !mentions(text, walk.dynamic)) return text;
	const apart = leaves(text, walk);
	if (apart !== null) return apart;
	const index = walk.holes.length;
	walk.holes.push({ index, expression: text, raw: false });
	return JSON.stringify(sentinel(index));
}

/**
 * An object or array literal with something standing at each of its values, or null where the
 * expression is not one this can take apart.
 *
 * Only for a value handed to a component the walk could not enter, and only for what is written
 * out as a literal here: the keys are the author's, so what the component reads off the object is
 * still there, and only the values it writes are markers. `{ count: n }` becomes
 * `{ count: "%%s5%%" }` rather than `"%%s5%%"`, which is the difference between a field the
 * component can read and a string that has none.
 *
 * A shorthand property has its name written back out, for the third-time reason `scope.ts` gives.
 * Anything the shape does not allow -- a spread, a computed key, a getter -- is left to the caller,
 * which plants one marker for the whole and reports it if it does not come back.
 */
function leaves(expression: string, walk: Walk): string | null {
	const ast = parse(`<script lang="ts"></script>{${expression}}`, {
		modern: true,
	}) as unknown as AstNode;
	const offset = '<script lang="ts"></script>{'.length;
	const fragment = ast['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const [only] = nodes;
	if (nodes.length !== 1 || !isNode(only) || only['type'] !== 'ExpressionTag') return null;
	const literal = only['expression'];
	if (!isNode(literal)) return null;
	const kind = literal['type'];
	if (kind !== 'ObjectExpression' && kind !== 'ArrayExpression') return null;
	const parts = kind === 'ObjectExpression' ? literal['properties'] : literal['elements'];
	if (!Array.isArray(parts) || parts.length === 0) return null;

	const planned: [[number, number], string, boolean][] = [];
	for (const one of parts) {
		if (!isNode(one)) return null;
		const shorthand = kind === 'ObjectExpression' && one['shorthand'] === true;
		if (kind === 'ObjectExpression') {
			if (one['type'] !== 'Property' || one['computed'] === true || one['kind'] !== 'init') {
				return null;
			}
		}
		const value = kind === 'ObjectExpression' ? one['value'] : one;
		const key = kind === 'ObjectExpression' ? one['key'] : undefined;
		const name = isNode(key) && typeof key['name'] === 'string' ? key['name'] : '';
		const where = span(value);
		if (where === null) return null;
		// An event handler is never serialised, so nothing stands for it.
		if (name.startsWith('on') && name.length > 2) continue;
		planned.push([[where[0] - offset, where[1] - offset], name, shorthand]);
	}
	if (planned.length === 0) return null;
	const edits: [number, number, string][] = [];
	for (const [[from, to], name, shorthand] of planned) {
		const held = stands(expression.slice(from, to), walk);
		edits.push([from, to, shorthand ? `${name}: ${held}` : held]);
	}
	return apply(expression, edits);
}

/**
 * The stamp that says which block just closed, refused where writing one would change the bytes.
 *
 * Inside a table, text is not writable and the stamp has to be an element -- and an element is a
 * sibling, which Svelte's CSS analysis stops at, so a `+` or `~` in this component's stylesheet
 * would stop matching and the elements it relates would silently lose their scoping class.
 * Measured: two `<tr>`s related by `+`, with a block between them, both lost it. No carrier avoids
 * it there, so the combination is named rather than compiled wrong. See `carrier()`.
 */
function stamps(walk: Walk, index: number): string {
	if (walk.siblings && elementCarrier(walk.parent)) {
		refuse(
			`this block sits directly inside \`<${String(walk.parent)}>\`, where the marker saying which ` +
				'block closed has to be an element because text is not writable there -- and this ' +
				"component's stylesheet relates siblings with `+` or `~`, which that element would stand " +
				'between, so the elements it relates would lose their scoping class. Wrapping the block in ' +
				'a cell of its own, or relating those two elements without a sibling combinator, avoids it',
		);
	}
	return carrier(index, walk.parent);
}

function collect(node: unknown, walk: Walk): void {
	const {
		blocks,
		dynamic,
		edits,
		expand,
		holes,
		pending,
		site,
		snippets,
		source,
		stream,
		taken,
		within,
	} = walk;
	if (!isNode(node)) return;
	const type = node['type'];
	if (typeof type !== 'string') {
		refuse('a markup node with no type reached the compiler, which cannot happen');
	}

	// Anything but the stream is the same walk, so what changes is spread over it. The lists are
	// shared by reference, which is what makes the numbering one sequence across the whole tree.
	const step = (child: unknown, into: Stream = stream): void => {
		collect(child, into === stream ? walk : { ...walk, stream: into });
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
				for (const child of nodes) step(child);
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
				collect(child, { ...walk, expand: inner });
			}
			return;
		}

		case 'Text':
			return;

		case 'SvelteHead':
			// The other stream. Everything under it renders into the head rather than the body.
			step(node['fragment'], 'head');
			return;

		case 'ExpressionTag':
		case 'HtmlTag': {
			const at = span(node['expression']);
			if (at === null) return;
			// A literal decides nothing, so nothing has to stand for it. Written out in its expanded
			// form rather than left as it was: what it expanded from may have been a name, and the
			// declaration that name came from has been neutralised for the render.
			const written = expand(node['expression']);
			if (constant(written)) {
				edits.push([at[0], at[1], written]);
				return;
			}
			// A value going to a component the walk could not enter, which has to survive being used
			// rather than only written out. See `stands`.
			if (walk.opaque === true) {
				edits.push([at[0], at[1], stands(written, walk)]);
				return;
			}
			const index = holes.length;
			// Where the value lands, and therefore how it is escaped, is read off the render rather
			// than guessed here. A prop passed to a component may end up in text or in an attribute,
			// and only the component knows which.
			holes.push({ index, expression: written, raw: type === 'HtmlTag' });
			edits.push([at[0], at[1], JSON.stringify(sentinel(index))]);
			return;
		}

		case 'SvelteElement':
		case 'RegularElement':
		case 'Component':
		case 'TitleElement': {
			// A tag decided per request. Svelte's `element()` writes `<!---->`, then the tag and its
			// attributes, then the children and a closing tag unless the tag is void, then
			// `<!---->` -- and the attributes and the children are the same bytes a written element
			// would produce, because the namespace and the case rules are read off the node rather
			// than off the value. So the render is given a stand-in tag and the value is put back
			// where it belongs, with what it decides expressed as tests over it.
			if (type === 'SvelteElement') {
				const where = span(node['tag']);
				if (where === null) return;
				const index = blocks.length;
				const tag = expand(node['tag']);
				blocks.push({
					index,
					kind: 'element',
					stream,
					within: [...within],
					expression: tag,
					// Its own validity first: Svelte throws for a name its regex rejects, and a
					// compiled artifact has nowhere to raise that, so the element is not written.
					tests: [
						`${VALID_TAG_NAME}.test(${tag}) && (${tag})`,
						`!${JSON.stringify(VOID_ELEMENTS)}.includes(${tag})`,
						`!${JSON.stringify(RAW_TEXT_ELEMENTS)}.includes(${tag})`,
					],
					item: null,
					counter: null,
					alternate: false,
				});
				// Valid, never void and never raw text, so the render always writes the full shape.
				edits.push([where[0], where[1], JSON.stringify(`seam-el${String(index)}`)]);
			}
			const attributes = node['attributes'];
			// The three shapes a `<select>` and an `<option>` add, and `bind:innerHTML`, each a value
			// the render cannot show where it lands. See `selection()` and `contents()`.
			const skipped = new Set<unknown>();
			const selecting =
				type === 'RegularElement'
					? selection(node, source, expand, holes, edits, walk.selecting, skipped)
					: walk.selecting;
			if (type === 'RegularElement') contents(node, source, expand, holes, edits, skipped);
			// The class directives are taken together with the class attribute, because that is how
			// Svelte writes them: one call producing one attribute, not one attribute plus a list of
			// additions. What is left after this is walked the ordinary way.
			// A spread takes the whole run, so the two directive passes have nothing left to decide.
			const spreads = spread(source, node, holes, edits, expand, site.spreads, site.copy);
			const handled = spreads.size > 0 ? spreads : classes(node, holes, edits, expand, pending);
			const styled =
				spreads.size > 0 ? spreads : styles(source, node, holes, edits, expand, pending);
			const given = type === 'Component';
			const tag = typeof node['name'] === 'string' ? node['name'] : '';

			// Into the child, where the child is one this walk can follow. What it plants there is
			// what the child does with the value rather than the value itself, so a prop used twice,
			// or not at all, or computed with, is the ordinary case rather than a marker that does
			// not come back. See spec/refusals.md.
			if (given && descend(node, walk)) {
				return;
			}
			// A tag naming a declaration written with a rune, which Svelte's analysis reads as a
			// dynamic component: `metadata.dynamic` in `2-analyze/visitors/Component.js` is set for
			// a binding whose kind is not `normal`, and the server then writes `<!--[-->` and
			// `<!--]-->` around what it renders, or `<!--[!--><!--]-->` for a value that is nothing.
			// The declaration reads props, so the render has been handed a literal for it, and the
			// tag rendered nothing where a request renders an icon. `<svelte:component this={...}>`
			// goes through the same `build_inline_component`, dynamic, so the tag is rewritten to
			// that with the expression expanded -- what the name stands for, with every fixed path
			// a literal -- for Svelte to evaluate. One that reaches the request is a component chosen
			// per request, which is not decided. See spec/refusals.md.
			if (type === 'Component' && !tag.includes('.') && walk.runeOf(tag) !== undefined) {
				const whole = span(node);
				if (whole !== null) {
					const at: [number, number] = [whole[0] + 1, whole[0] + 1 + tag.length];
					const written = expand({ type: 'Identifier', name: tag, start: at[0], end: at[1] });
					if (mentions(written, dynamic)) {
						refuse(
							`\`<${tag}>\` chooses a component from a value the request decides, which is not ` +
								'decided: a structure is enumerated, and this one is not enumerable',
						);
					}
					edits.push([at[0], at[1], `svelte:component this={${written}}`]);
					const close = `</${tag}>`;
					if (source.endsWith(close, whole[1])) {
						edits.push([whole[1] - close.length, whole[1], '</svelte:component>']);
					}
				}
			}

			if (Array.isArray(attributes)) {
				for (const attr of attributes) {
					if (handled.has(attr) || styled.has(attr) || skipped.has(attr)) continue;
					// A prop handed to a component this walk could not enter, whose value the request
					// does not decide. Left as written, so Svelte evaluates it during the render: a
					// marker is a string, and a component given one where it expected an object with
					// methods calls a method on a string. `<Provider client={queryClient}>` is that,
					// and it is the shape every wrapper from a package has.
					//
					// Left as written is not left as the author wrote it: what a name expanded from may
					// be a declaration the render has been handed a literal for, or a fixed path the
					// render holds as a literal, so the expression is written out expanded -- the same
					// rule a constant in markup already follows -- and Svelte evaluates that. Measured
					// on press's language switcher, given `code={locale}` with `locale` neutralised:
					// the render computed the trigger's label from nothing and baked it in.
					if (given && site.payload !== null && inert(attr, expand, dynamic)) {
						expanded(attr, source, expand, edits);
						continue;
					}
					const before = holes.length;
					collect(attr, { ...walk, opaque: given });
					if (!given || !isNode(attr)) continue;
					const prop = typeof attr['name'] === 'string' ? attr['name'] : '';
					for (const one of holes.slice(before)) one.given = `\`<${tag}>\` as \`${prop}\``;
				}
			}

			// From here down the walk is inside this element, which is what decides how a block's
			// stamp is carried. A component is not one: what it does with the markup, and where it
			// puts it, is the child's business.
			const encloses = type === 'RegularElement' ? tag : null;

			// Markup handed to a component the walk could not enter, in the groups Svelte splits it
			// into. Each group's range is kept so that a second render can say whether the component
			// writes that group at all.
			const fragment = node['fragment'];
			const inside = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
			if (!given || inside.length === 0) {
				collect(fragment, { ...walk, parent: encloses, selecting });
				return;
			}
			const groups = handedTo(site.file, tag, inside);
			const planted = new Set<Group>();
			for (const child of inside) {
				const group = groups.get(child);
				// A literal at the head of the group rather than in place of it. **The probing walk
				// has to be the same walk**, and replacing the markup made it a different one: it
				// descended where the baseline had not and did not where the baseline had, so the
				// markup rendered with none of the rewriting the pass had done and the render threw
				// far more often than it answered. Worse, an outer replacement erased every group
				// nested inside it, so a component sitting in another component's markup was never
				// measured -- which is not an absence, it is a group that was never asked about, and
				// it read as the contradiction it is not. Inserting leaves the walk alone: every
				// group at every depth carries its own literal, and one render answers for all of
				// them.
				if (group !== undefined && site.probing && !planted.has(group)) {
					planted.add(group);
					edits.push([group.at, group.at, group.probe]);
				}
				const from: [number, number] = [holes.length, blocks.length];
				collect(child, { ...walk, parent: encloses });
				if (group === undefined) continue;
				const one: Handed = {
					probe: group.probe,
					what: group.what,
					holes: [from[0], holes.length],
					blocks: [from[1], blocks.length],
				};
				const reads = isNode(child) ? reading(child) : null;
				if (reads !== null) one.reads = reads;
				site.handed.push(one);
			}
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
			// Svelte puts `translate` through a replacement table on the way out -- `true` is written
			// `"yes"` and `false` `"no"` -- and it is the one entry. A literal is folded by Svelte in
			// the render; a value decided per request is a hole like any other, and the injector
			// carries the table under the name. See spec/ir.md.
			// `{n}` is sugar for `n={n}`, and the sugar only holds a bare name: put anything else
			// between those braces and Svelte's parser stops with `attribute_empty_shorthand`. This
			// pass puts a marker there, so a shorthand attribute made the compiler fail inside
			// Svelte, pointing at the author's own file and telling them something untrue about it.
			// Writing the name back out first is not a rewrite of the value -- the two forms render
			// the same bytes, measured -- and it leaves the marker somewhere the parser accepts.
			const at = span(node);
			if (at !== null && source[at[0]] === '{') edits.push([at[0], at[0], `${name}=`]);
			for (const part of parts) step(part);
			return;
		}

		case 'SnippetBlock': {
			// The declaration writes no bytes. Svelte compiles it to a function and the body writes
			// where the `{@render}` calls it, so that is where it is walked -- which is also the
			// only place its blocks are numbered against the branches that actually hold them.
			//
			// What is refused here is what the declaration alone decides, so that a snippet nobody
			// renders still says why rather than passing unnoticed.
			const parameters = Array.isArray(node['parameters']) ? node['parameters'] : [];
			const id = node['expression'];
			const named = isNode(id) && typeof id['name'] === 'string' ? id['name'] : '';
			const one = snippets.get(named);

			// Written inside a component's tag, so the component decides when to call it. There is
			// no `{@render}` here to walk it at, and it is rendered, so the declaration is the only
			// place -- which is what `children` is, and every snippet a package is handed.
			if (one?.passed === true && one.renders === 0) {
				// The component supplies the arguments, and this pass cannot see them. Where a
				// parameter is only ever rendered that is not a problem: what it holds is markup the
				// component writes during the render, like any other component writing its own
				// bytes. Where one is read as a value there is nothing to put in its place.
				//
				// Where one is read as a value there is nothing to put in its place -- if the component
				// writes the body at all. That is not known here; it is what the probe render measures,
				// so the body is walked as written and the group carries the reason. See `Handed.reads`.
				const names = supplied(node) ?? parameterNames(parameters);
				collect(node['body'], {
					...walk,
					handed: names.size === 0 ? walk.handed : new Set([...(walk.handed ?? []), ...names]),
				});
				return;
			}

			if (parameters.length === 0) return;
			if (one === undefined || one.renders === 0) {
				// Written inside a component's tag, so it is a prop that component receives: the child
				// decides when to call it and with what, and neither is visible from here. One with no
				// parameters has nothing to decide and already works, which is what `children` is.
				refuse(`the snippet \`${named}\` takes parameters and is never rendered`);
			}
			// Fewer arguments than parameters is a function call: the rest are `undefined`, and a
			// default is what answers to that. More is an argument nothing receives.
			if (one.args.length > parameters.length) {
				refuse(
					`the snippet \`${named}\` takes ${String(parameters.length)} parameter(s) and is ` +
						`rendered with ${String(one.args.length)}`,
				);
			}
			return;
		}

		case 'RenderTag': {
			const call = called(node['expression']);
			const name = renders(node);

			// Markup the caller wrote inside this component's tag. Walked here, where the child
			// renders it, in the scope it was written in.
			const handed = name === null ? undefined : site.given.get(name);
			if (handed !== undefined) {
				const given = isNode(call) && Array.isArray(call['arguments']) ? call['arguments'] : [];
				if (given.length > 0) {
					refuse(
						`\`{@render ${name}()}\` is called with arguments, and what it renders was written ` +
							'at the call site, which has no name to give them to',
					);
				}
				for (const child of handed.nodes) {
					collect(child, {
						...walk,
						source: handed.source,
						edits: handed.edits,
						expand: handed.expand,
						snippets: handed.snippets,
						site: handed.site,
					});
				}
				return;
			}

			// A snippet an enclosing passed snippet was handed: the component supplies it, so what it
			// writes is the component's own bytes and nothing here stands for any of it.
			if (name !== null && walk.handed?.has(name) === true) {
				const args = isNode(call) && Array.isArray(call['arguments']) ? call['arguments'] : [];
				if (args.length > 0) {
					refuse(
						`\`{@render ${name}()}\` passes arguments to a snippet the component supplied, ` +
							'which this compiler cannot see the body of',
					);
				}
				return;
			}

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
			if (one.renders > 1) {
				refuse(
					`the snippet \`${String(name)}\` is rendered ${String(one.renders)} times, and one ` +
						'body cannot stand in two places: each marker in it would come back more than once',
				);
			}
			const declaration = one.node;
			if (declaration === undefined) refuse(`the snippet \`${String(name)}\` has no declaration`);

			// A parameter's value is the argument here, and there is exactly one call, so it
			// substitutes like any other declared name with the argument standing for it. The
			// arguments themselves are then written out: their values are unused during the render,
			// every expression in the body being a marker already, and evaluating one would reach
			// for data the render is not given.
			const parameters = Array.isArray(declaration['parameters']) ? declaration['parameters'] : [];
			const bound = new Map<string, string>();
			for (const [index, parameter] of parameters.entries()) {
				if (!isNode(parameter)) refuse('a `{#snippet}` parameter this compiler cannot read');
				// An argument not written is `undefined`, which is what the function receives and
				// what a default answers to.
				const argument = index < one.args.length ? expand(one.args[index]) : 'undefined';
				for (const [each, reached] of takenApart(
					parameter,
					`(${argument})`,
					expand,
					() => `the snippet \`${String(name)}\``,
				)) {
					bound.set(each, reached);
				}
			}

			const given = isNode(call) && Array.isArray(call['arguments']) ? call['arguments'] : [];
			for (const [index, argument] of given.entries()) {
				const at = span(argument);
				if (at !== null) edits.push([at[0], at[1], one.holds[index] ?? 'null']);
			}

			// The body, here, with the parameters bound and everything else this walk carries --
			// which is what puts its blocks inside the branches that actually render them. What the
			// body binds for itself comes down through `more`.
			const inner: Locals['rewrite'] = (child, more) =>
				expand(child, more === undefined ? bound : new Map([...bound, ...more]));
			collect(declaration['body'], { ...walk, expand: inner });
			return;
		}

		case 'AwaitBlock': {
			// What `$.await` does, read out of `internal/server/index.js`: a promise writes `<!--[-->`
			// and the pending branch, without waiting; anything else writes `<!--[!-->` and the then
			// branch with the value bound to it; the catch branch is never written, because nothing
			// is awaited and so nothing rejects. Two branches decided by one test, which is an if to
			// every pass after this one -- the anchors are bytes read off the render, whichever they
			// are. The block stays an await in the rendered source so Svelte writes its own anchors,
			// and only the expression is swapped: a promise for the render that holds the pending
			// branch, and something the pattern can take apart for the one that holds the then
			// branch, whose value is unused because every expression in it is a marker already. The
			// payload is data and holds no promise, but a derivation may return one, and then the
			// pending branch is what Svelte's own server would have written. See spec/refusals.md.
			const whole = span(node);
			const at = span(node['expression']);
			if (whole === null || at === null) return;
			const value = node['value'];
			const waiting = node['pending'];
			const then = node['then'];

			const index = blocks.length;
			const expression = expand(node['expression']);
			const test = `typeof (${expression})?.then === 'function'`;
			blocks.push({
				index,
				kind: 'if',
				stream,
				expression: test,
				tests: [test],
				item: null,
				counter: null,
				alternate: true,
				within: [...within],
			});
			const kind = isNode(value) ? value['type'] : undefined;
			const holds = kind === 'ObjectPattern' ? '{}' : kind === 'ArrayPattern' ? '[]' : 'null';
			edits.push([at[0], at[1], taken(index, 0) ? 'Promise.resolve()' : holds]);
			// Which block just closed, written where the render puts it and nowhere else.
			edits.push([whole[1], whole[1], stamps(walk, index)]);

			if (isNode(waiting)) {
				within.push([index, 0]);
				step(waiting);
				within.pop();
			}
			if (isNode(then)) {
				// The value is the expression itself, resolved: `then_fn(promise)` is called with what
				// was awaited, which was never a promise on this branch. So it substitutes the way a
				// snippet's parameter does, with a destructuring reached through the way in.
				const bound = isNode(value)
					? takenApart(value, `(${expression})`, expand, () => 'this await')
					: new Map<string, string>();
				const inner: Locals['rewrite'] = (child, more) =>
					expand(child, more === undefined ? bound : new Map([...bound, ...more]));
				within.push([index, -1]);
				collect(then, { ...walk, expand: inner });
				within.pop();
			}
			// The catch branch is left as written and never walked: the server never writes it, so
			// nothing planted there would come back.
			return;
		}

		case 'SvelteBoundary': {
			// Read out of `3-transform/server/visitors/SvelteBoundary.js`. On the server a boundary
			// is one shape, not a decision: `<!--[-->`, its children, `<!--]-->` -- or, given a
			// `pending` snippet, `<!--[!-->`, that snippet's body, `<!--]-->` and none of the
			// children, because a synchronous render is pending by definition. The `failed` snippet
			// is never written: nothing throws during a render this compiler accepts, and if it did
			// the hole check would say so. So there is no block here. The anchors are a pair the
			// assembler copies as bytes, the way it copies a package component's own, and what is
			// inside them is walked as anything else is. See spec/refusals.md.
			const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
			for (const attribute of attributes) {
				// A snippet handed by attribute is decided at request time -- `pending={p}` renders the
				// children when `p` is nullish -- and a name this walk would have to see rendered.
				if (
					isNode(attribute) &&
					(attribute['name'] === 'pending' || attribute['name'] === 'failed')
				) {
					refuse(
						`\`<svelte:boundary ${String(attribute['name'])}={...}>\` is not handled yet: a snippet ` +
							'handed as an attribute is chosen at request time, where one written inside the ' +
							'tag is not',
					);
				}
			}
			const fragment = node['fragment'];
			const children =
				isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
			const pendingSnippet = children.find((child) => snippetNamed(child, 'pending'));
			// The failed snippet goes from the rendered source: it is declared with a parameter and
			// never rendered here, which is a refusal the walk would otherwise raise about a body
			// nobody writes.
			for (const child of children) {
				const at = snippetNamed(child, 'failed') ? span(child) : null;
				if (at !== null) edits.push([at[0], at[1], '']);
			}
			if (pendingSnippet !== undefined) {
				step(pendingSnippet['body']);
				return;
			}
			for (const child of children) {
				if (!snippetNamed(child, 'failed')) step(child);
			}
			return;
		}

		case 'KeyBlock': {
			// The key is the client's: it says when to recreate the fragment, and the server's
			// transform never evaluates it. `KeyBlock.js` writes `<!---->`, the fragment, `<!---->`,
			// which is no block at all -- an empty comment is what the assembler steps over -- so the
			// body is walked as if the key were not there, because on the server it is not.
			step(node['fragment']);
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

			// Which block just closed, written where the render puts it and nowhere else.
			const whole = span(node);
			if (whole !== null) edits.push([whole[1], whole[1], stamps(walk, index)]);

			// Only the first branch is in the baseline render, so only its blocks are numbered where
			// the assembler counts them. A block in any other branch is numbered here and appears in
			// a render nobody counts, which is the two lists coming apart. See spec/refusals.md.
			for (const [branch, one] of chain.entries()) {
				within.push([index, branch]);
				step(one['consequent']);
				within.pop();
			}
			if (isNode(otherwise)) {
				within.push([index, -1]);
				step(otherwise);
				within.pop();
			}
			return;
		}

		case 'EachBlock': {
			// A key is not carried, because Svelte's own server transform never mentions one: a
			// keyed each renders byte for byte what an unkeyed one renders, measured. It belongs to
			// the client, which compiles from the source and keeps it.
			const at = span(node['expression']);
			const pattern = node['context'];
			const context = span(pattern);
			const fallback = node['fallback'];
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

			const index = blocks.length;
			blocks.push({
				index,
				kind: 'each',
				within: [...within],
				stream,
				expression: expand(node['expression']),
				item: context === null ? null : source.slice(context[0], context[1]),
				...(binds === undefined ? {} : { binds }),
				counter: typeof node['index'] === 'string' ? node['index'] : null,
				alternate: fallback !== null && fallback !== undefined,
			});
			// One element, because the body's own expressions are sentinels and read nothing from it.
			// An each with an `{:else}` is two shapes the way an if is: Svelte's server writes
			// `<!--[-->` and the items for a list with something in it, and `<!--[!-->` and the
			// fallback for one with nothing, so the fallback gets a render of its own, from an empty
			// list, the way an else does. See spec/refusals.md.
			edits.push([at[0], at[1], taken(index, 0) ? `[${element}]` : '[]']);
			// Which block just closed, written where the render puts it and nowhere else.
			const whole = span(node);
			if (whole !== null) edits.push([whole[1], whole[1], stamps(walk, index)]);
			// What the block binds is decided per item, so an expression reading it is a marker
			// even when nothing else in it reaches the payload.
			const inside = new Set(dynamic);
			namesIn(pattern, inside);
			if (typeof node['index'] === 'string') inside.add(node['index']);
			within.push([index, 0]);
			collect(node['body'], { ...walk, dynamic: inside });
			within.pop();
			if (isNode(fallback)) {
				within.push([index, -1]);
				step(fallback);
				within.pop();
			}
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
	if (attributes.some((one) => isNode(one) && one['type'] === 'SpreadAttribute')) return false;
	// A `{#snippet}` inside the tag arrives under its own name and may take parameters, which the
	// caller does not choose. Only the markup that becomes `children` is followed.
	if (nodes.some((one) => isNode(one) && one['type'] === 'SnippetBlock')) return false;
	// `let:` puts the markup in `$$slots` instead, on a different path through the visitor.
	if (attributes.some((one) => isNode(one) && one['type'] === 'LetDirective')) return false;

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
		handed: walk.site.handed.length,
		spreads: walk.site.spreads.length,
	};

	try {
		const raw = inlined(unbound(readFileSync(file, 'utf8')));
		const ahead = parse(raw, { modern: true }) as unknown as AstNode;
		// Its number now, not when the tag is renamed: the walk below takes copies of its own, so
		// counting then gave a nested pair of the same component one name twice.
		const ordinal = walk.site.copies.length;
		// A `$props.id()` is a binding the runtime makes when it writes the anchor, named for this
		// copy so that two components declaring one in a page do not share it. See `fresh.ts`.
		const fresh = identified(ahead) ? `__i${String(ordinal + 1)}` : null;
		// The paths this render is fixed at, said in the child's own names. A prop bound to the
		// whole of one is that path inside the child; a prop bound to a prefix of one carries the
		// rest of it along. Without this a child would read `data.locale.code` as its own `data`,
		// which is a different value with the same spelling.
		const held = rebased(walk.site.fixed, propsOf(ahead, raw) ?? [], bindings);
		const declared = locals(raw, held, fresh ?? undefined);
		const inner: [number, number, string][] = [];
		for (const [[from, to], empty] of declared.reading) inner.push([from, to, empty]);

		const ast = ahead;
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

		// The anchor's hole comes before every hole the child plants, which is where Svelte writes
		// the anchor: at the start of the component, before anything it renders.
		if (fresh !== null) {
			copy.fresh = walk.holes.length;
			walk.holes.push({ index: copy.fresh, expression: fresh, raw: false, fresh: true });
		}

		collect(ast['fragment'], {
			...walk,
			source: raw,
			edits: inner,
			expand: (child, extra) =>
				declared.rewrite(child, new Map([...bound, ...(extra ?? new Map())])),
			runeOf: declared.rune,
			snippets,
			siblings: relatesSiblings(ast),
			dynamic: fresh === null ? walk.dynamic : new Set([...walk.dynamic, fresh]),
			fresh: fresh === null ? walk.fresh : [...walk.fresh, fresh],
			site: {
				file,
				root: walk.site.root,
				imports: importsOf(raw),
				copies: walk.site.copies,
				stack: [...walk.site.stack, file],
				prelude,
				given: hands(walk, nodes),
				payload: walk.site.payload,
				missed: walk.site.missed,
				handed: walk.site.handed,
				spreads: walk.site.spreads,
				copy,
				probing: walk.site.probing,
				fixed: held,
				decided: walk.site.decided,
			},
		});
		withPrelude(raw, ast, prelude, inner);
		copy.source = apply(raw, inner);

		// The values stay where they were written and are handed to the render as nothing. The
		// child's markers already carry the expressions, so what the call site passes is dead --
		// and live, it would be evaluated against data the render is not given.
		//
		// Nothing, except for the paths this render is fixed at: those the compiler knows, and
		// markup the child leaves for Svelte to evaluate reads them out of its props like anything
		// else. So the prop is handed exactly them, in the shape they sit in, and nothing more.
		for (const one of attributes) {
			if (!isNode(one) || one['type'] !== 'Attribute') continue;
			const value = one['value'];
			const parts = value === true ? [] : Array.isArray(value) ? value : [value];
			const whole = span(one);
			// `{p}` is `p={p}`, and the short form's braces hold a bare name and nothing else, so
			// the whole attribute is written out rather than its value replaced. The same thing a
			// marker planted in one costs, met again.
			const name = typeof one['name'] === 'string' ? one['name'] : '';
			const local = declares.find((each) => each.prop === name)?.local;
			const known = local === undefined ? undefined : partial(held, local);
			const placed = known === undefined ? 'null' : JSON.stringify(known);
			if (whole !== null && walk.source[whole[0]] === '{') {
				walk.edits.push([whole[0], whole[1], `${name}={${placed}}`]);
				continue;
			}
			for (const part of parts) {
				if (!isNode(part) || part['type'] !== 'ExpressionTag') continue;
				const where = span(part['expression']);
				if (where !== null) walk.edits.push([where[0], where[1], placed]);
			}
		}

		// The parent imports this call site's copy rather than the file, which is two edits: the
		// tag's name where it opens and where it closes, and one import beside the others.
		rename(walk, node, tag, at, ordinal);
		return true;
	} catch (error) {
		// Rolled back, and the component is rendered by Svelte the way it was before this tried.
		// A refusal from inside a child is a refusal about a file the author did not ask to
		// compile, so it is not theirs to see.
		rolled(walk, mark);
		// The walk asking for a second render is not the walk failing, and it is answered above.
		if (error instanceof Undecided) throw error;
		if (String((error as Error).message).includes('is part of a cycle')) throw error;
		walk.site.missed.push({ file, reason: String((error as Error).message) });
		return false;
	}
}

/**
 * Rewrites the markup so it renders with no data: every expression becomes a string literal
 * holding a sentinel, every if is written as a constant, and every each iterates one element.
 *
 * Svelte does not fold a constant condition away -- `{#if true}` still writes `<!--[0-->` and
 * `{#if false}` still writes `<!--[-1-->` -- so a branch can be chosen by editing the source
 * rather than by threading a prop through the component.
 */
export function rewrite(
	source: string,
	taken: (block: number, branch: number) => boolean,
	file: string,
	root: string,
	probing = false,
	fixed: ReadonlyMap<string, string> = new Map(),
	decided: ReadonlyMap<string, boolean> = new Map(),
): Rewritten {
	const ast = parse(source, { modern: true }) as unknown as AstNode;
	const holes: Hole[] = [];
	const blocks: Block[] = [];
	const edits: [number, number, string][] = [];
	const pending: PendingChoice[] = [];
	// The entry's own id, where it declares one, named apart from every copy's.
	const fresh = identified(ast) ? '__i0' : null;
	const declared = locals(source, fixed, fresh ?? undefined);

	// A render is given no data, so a declaration reading a prop would evaluate against nothing
	// and crash inside Svelte's own renderer. It has already been substituted into every
	// expression that used it, which leaves it dead here, so the render is handed a literal in
	// its place rather than the expression it stood for.
	for (const [[from, to], empty] of declared.reading) edits.push([from, to, empty]);

	const snippets = new Map<string, Snippet>();
	snippetsIn(ast['fragment'], snippets);
	const copies: Copy[] = [];
	const prelude: string[] = [];
	const declares = propsOf(ast, source);
	const payload = declares === null ? null : new Set(declares.map((one) => one.local));
	const missed: { file: string; reason: string }[] = [];
	const handed: Handed[] = [];
	const spreads: PendingSpread[] = [];
	if (fresh !== null) holes.push({ index: 0, expression: fresh, raw: false, fresh: true });
	collect(ast['fragment'], {
		source,
		holes,
		edits,
		blocks,
		taken,
		stream: 'body',
		expand: declared.rewrite,
		runeOf: declared.rune,
		snippets,
		pending,
		within: [],
		site: {
			file,
			root,
			imports: importsOf(source),
			copies,
			stack: [file],
			prelude,
			given: new Map(),
			payload,
			missed,
			handed,
			spreads,
			copy: null,
			probing,
			fixed,
			decided,
		},
		dynamic: fresh === null ? (payload ?? new Set()) : new Set([...(payload ?? []), fresh]),
		fresh: fresh === null ? [] : [fresh],
		parent: null,
		siblings: relatesSiblings(ast),
	});
	withPrelude(source, ast, prelude, edits);

	return {
		rewritten: apply(source, edits),
		holes,
		blocks,
		pending,
		copies,
		missed,
		handed,
		spreads,
		...(fresh === null ? {} : { fresh: 0 }),
	};
}
