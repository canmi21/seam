import { readFileSync } from 'node:fs';
import { basename, dirname, relative, resolve as resolvePath } from 'node:path';
import { parse } from 'svelte/compiler';
import {
	apply,
	AT_REQUEST,
	type Carried,
	constant,
	type Edit,
	importsOf as importedBy,
	type Locals,
	GIVEN,
	locals,
	literalOf,
	mentions,
	onlyWithin,
	readsOf,
	componentOf,
	declaredBy,
	declaring,
	objectEntries,
	parsed,
	parsedComponent,
	reads as readsIn,
	resolveBare,
	runeCalled,
	runeHolds,
	settle,
	STATE_ON_SERVER,
	stateImports,
	unfolded,
} from 'ast';
import {
	classes,
	clsxed,
	type PendingChoice,
	type PendingSpread,
	spread,
	styles,
} from './attributes.ts';
import {
	carries,
	hands,
	identity,
	importsOf,
	inert,
	legacyMode,
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
import {
	carrier,
	elementCarrier,
	headCloses,
	headOpens,
	headOpensWith,
	marks,
	marksHead,
	collides,
	sentinel,
	writes,
} from './sentinel.ts';
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
	/** What `source` was made from, kept so another render's choices can be applied to it. */
	raw: string;
	/** The edits that made it, kept for the same reason. See `rechosen`. */
	inner: Edit[];
	/**
	 * The hole standing for this component's `$props.id()` anchor, where it declares one. The
	 * render puts the hole's marker where Svelte's helper would have put the id. See `render.ts`.
	 */
	fresh?: number;
	/** The tests this copy asks the render to decide. See `Site.asks`. */
	asks?: [key: string, code: string][];
	/** The values this copy asks the render for. See `Site.wants`. */
	wants?: [key: string, code: string][];
	/**
	 * The branches this copy's call site sits inside, outermost first. A copy inside a branch the
	 * baseline does not take renders only in that branch's alternate, so what it asks is answered
	 * only there; the pass that asks makes that alternate and no other. See `skeleton()`.
	 */
	within?: [number, number][];
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
	/**
	 * Names `let:` binds on this group, which the component supplies when it renders the slot.
	 *
	 * `build_inline_component` gives each slot function a second parameter, an object pattern built
	 * from the group's `let:` directives, and `$.slot` calls it with the props written on the
	 * `<slot>`. So the caller's markup reads names whose values the child decides, and what it
	 * reads them as is the expression the `<slot>` passed under that prop: `let:thing={x}` over
	 * `<slot {thing}/>` inside an each makes `x` the each's item, per iteration.
	 *
	 * Keyed by the slot's prop name, valued by the name the caller bound it to -- or by the pattern
	 * it bound, where `let:box={{ width, height }}` binds several names from the one prop.
	 */
	handed: ReadonlyMap<string, string | AstNode>;
	/** Whether the caller's file is in legacy mode, which decides whether its `{@const}`s sort. */
	legacy: boolean;
	/**
	 * The parameters of the `{#snippet}` this group is, where it is one.
	 *
	 * A snippet written inside a component's tag is a prop the component renders with arguments of
	 * its own, so the group's nodes are walked with those parameters bound to those arguments --
	 * which is what a `let:` already does for a slot, spelled the other way round.
	 */
	parameters?: readonly unknown[];
	/**
	 * Which `<slot>` walked this group, where one has. A component may render one group from more
	 * than one `<slot>` -- `<slot key="a"/><slot key="b"/>` renders the caller's markup twice, with
	 * different props each time -- and the group is one span of the caller's source. Two walks then
	 * write two different rewrites over it, which `apply` reports as one place recorded twice: an
	 * error naming offsets rather than a question. See `descend`.
	 */
	walked?: string;
	/** Whether walking it put a marker in the bytes. See the `<slot>` case in `collect`. */
	planted?: boolean;
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
	/** The same imports with what each one is -- default, named, the module -- for a package's. */
	carried: ReadonlyMap<string, Carried>;
	/**
	 * What each prop of this file holds when the request sends nothing, by the local's name.
	 *
	 * The entry's only. A child's prop is bound to what its call site passed, or to the default
	 * already where it passed nothing, so the name is gone by the time an expression is read.
	 */
	defaults: ReadonlyMap<string, unknown>;
	/**
	 * The props whose default the walk followed to a component, which the derivation scope then
	 * stands `true` for rather than the component itself. See `chosenComponent()`.
	 */
	stood: Set<string>;
	/**
	 * The names substitution cannot follow, from every file this walk read, with why.
	 *
	 * `locals()` records them rather than refusing: the render runs the instance script and has the
	 * value, so an expression the render evaluates is right with the name left as written. What
	 * cannot hold one is an expression this compiler has to write itself, and that is asked of the
	 * finished list rather than here -- the walk folds branches away, and a refusal about markup
	 * nothing renders is a refusal about nothing. Unioned across files, since two files' locals are
	 * two scopes and the union only ever refuses more. See spec/derivation.md.
	 */
	changing: Map<string, string>;
	/**
	 * The fragment this file's copy is the body of, where the component renders itself: a call of
	 * itself inside it is a call of this fragment. Undefined for a component that does not.
	 */
	fragment?: string;
	/** The fragments this file's recursive snippets became, by the snippet's name. */
	fragments: Map<string, string>;
	copies: Copy[];
	stack: string[];
	/** Imports the rewritten source needs that the author did not write: one per copy taken. */
	prelude: string[];
	/**
	 * Tests the request does not decide and this walk was not told the answer to, which the
	 * render is asked: a statement at the end of the instance script reports each one's value,
	 * and the walk runs again told. See `spec/refusals.md`.
	 */
	asks: [key: string, code: string][];
	/**
	 * Expressions the request does not decide that the runtime still has to hold -- an each's
	 * source, iterated per request -- which the render is asked for as a JSON literal, so that
	 * the runtime iterates the value and never computes it. See `Site.asks`.
	 */
	wants: [key: string, code: string][];
	/** The answers to `wants` this walk was told, by expression, as JSON. */
	told: ReadonlyMap<string, string>;
	/**
	 * Names imported from a runes module, `.svelte.ts` or `.svelte.js`, across every file walked.
	 * A call into one with a request-decided argument is decided by the render. See `varies()`.
	 */
	runes: Set<string>;
	/**
	 * Context keys a `setContext` in this walk was given a value the request decides, across every
	 * file walked. Shared, because a parent sets what a child reads and the parent is walked first.
	 *
	 * `getContext` is not a name the request decides, so an expression reading one looks inert and
	 * is written back for the render to evaluate -- against the neutralised value the parent's
	 * `setContext` was handed there. Measured: `setContext('k', { v })` over a prop, with the child
	 * writing `{held.v}`, rendered empty where Svelte wrote the value. `'*'` where the key itself
	 * is not a literal. See `varies()`.
	 */
	contexts: Set<string>;
	/**
	 * Asks no render answered: markup nothing rendered, a branch nobody took. Not asked again,
	 * and walked as a decision the runtime makes, which is what they were before.
	 */
	mute: ReadonlySet<string>;
	/**
	 * What a component `bind:` met on this pass settles a name to, by the caller's local. Empty on
	 * a pass that was already told them, which is how the walk knows it has settled. See `Walk.sent`.
	 */
	sends: Map<string, string>;
	/**
	 * What each binding of a name settles it to and the branch that has to render for it to,
	 * in source order, from which `sends` is composed.
	 *
	 * `bind_props` assigns up only where the caller's value is `undefined` and never back, so among
	 * the bindings of one name the **first** whose branch renders is the one whose value the name
	 * holds. Kept as pairs rather than composed at each tag, because a second tag has to nest
	 * inside the first rather than replace it.
	 */
	sending: Map<string, [when: string, value: string][]>;
	/**
	 * A block's branch tests as the settling loop sees them where the block was walked, by block.
	 *
	 * The loop renders the template again, so a name a binding settles is read by the markup after
	 * it on the same pass and by the markup before it on the next. Expanding a test against the
	 * bindings settled so far is that, and source order falls out of the walk's own order:
	 * `component-binding-conditional` and `-conditional-b` differ in where a `<Baz bind:x/>` sits
	 * and Svelte answers `bar` and `foo`. See `branchTest`.
	 */
	tested: Map<number, string[]>;
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
	 * Body blocks a `<svelte:head>` was walked inside, across every file entered, which have to
	 * stand in the head stream as well: `$.head` runs where the component does, so an if decides
	 * and an each repeats the child's head block the way they decide and repeat its body. Each
	 * block reads this once its body is walked. See `mirrored()`.
	 */
	headed: Set<number>;
	/**
	 * The components a file entered as a fragment on the way here became, by file: a tag naming
	 * one of them, met again while it is still being walked, is a call of its fragment rather than
	 * a render that would not end. Shared by every file of the walk. See `reachesItself()`.
	 */
	callable: Map<string, string>;
	/**
	 * The fragments whose component writes a `<svelte:head>`, by name, known before the body is
	 * walked: a call of one writes a marker into the head as well as the body, and stands in the
	 * head stream what it sits inside. Shared by every file of the walk. See `headedFragment()`.
	 */
	headedFragments: Set<string>;
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
	 * Every edit whose text this walk's branch choices decided, the entry's and every copy's.
	 *
	 * Shared by every file of the walk, so that one list re-materialises the whole render. See
	 * `Choice` and `rechosen`.
	 */
	choices: Choice[];
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
 * The one edit a branch choice decides, written for this render and recorded for the others.
 *
 * Every consultation of `taken` goes through here, which is what makes the list of choices the
 * complete difference between one render's rewrite and another's. See `Choice`.
 */
function chose(
	walk: Walk,
	edits: Edit[],
	from: number,
	to: number,
	block: number,
	branch: number,
	taken: string,
	untaken: string,
): Choice {
	const at = edits.length;
	edits.push([from, to, walk.taken(block, branch) ? taken : untaken]);
	const one: Choice = { edits, at, block, branch, taken, untaken };
	walk.site.choices.push(one);
	return one;
}

/**
 * A choice with both of its texts wrapped, for a caller that learns what wraps them afterwards.
 *
 * An `{#await}` whose body writes a head is the one of these: whether the block stands in the head
 * stream is known once its body has been walked, and what opens it goes around the expression the
 * choice already wrote. Wrapping both texts rather than the written one keeps the choice a choice.
 */
function rewrapped(walk: Walk, one: Choice, wrap: (text: string) => string): void {
	one.taken = wrap(one.taken);
	one.untaken = wrap(one.untaken);
	const edit = one.edits[one.at];
	if (edit !== undefined) edit[2] = walk.taken(one.block, one.branch) ? one.taken : one.untaken;
}

/**
 * A choice whose taken text is replaced, for a `this` that turned out to name a copy.
 *
 * `descend()` points a tag it entered at the copy it took, which for a dynamic component is an
 * edit over the `this` expression -- the same characters a choice already owns. So the copy's name
 * goes into the choice rather than beside it, and the branch that renders nothing keeps its own
 * text. See `rename()` in compose.ts.
 */
function rechose(walk: Walk, one: Choice, taken: string): void {
	one.taken = taken;
	const edit = one.edits[one.at];
	if (edit !== undefined) edit[2] = walk.taken(one.block, one.branch) ? one.taken : one.untaken;
}

/**
 * The same walk, re-materialised for a render that takes different branches.
 *
 * A walk is a list of edits against a source, and `taken` decides the text of a handful of them
 * and nothing else -- not which components are entered, not where a hole goes, not what a block is
 * numbered. So an alternate render needs the choices set the other way and the edits applied
 * again, which is a string splice per file rather than a walk of the route. On one route of press
 * that is 137 walks of a hundred components down to three. See `Choice`, and spec/build.md.
 */
export function rechosen(
	made: Rewritten,
	taken: (block: number, branch: number) => boolean,
): Rewritten {
	for (const one of made.choices) {
		const edit = one.edits[one.at];
		if (edit !== undefined) edit[2] = taken(one.block, one.branch) ? one.taken : one.untaken;
	}
	return {
		...made,
		rewritten: unimported(apply(made.source, made.edits)),
		// A copy of each copy rather than the copy: the walk this came from keeps its own bytes,
		// and the alternates are made from it one after another.
		copies: made.copies.map((copy) =>
			copy.inner.length === 0 ? copy : { ...copy, source: unimported(apply(copy.raw, copy.inner)) },
		),
	};
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
	/**
	 * The same expansion without what the walk bound on the way in -- a snippet's parameters, an
	 * argument's way in -- which is what tells an expression the render can evaluate as written
	 * from one it cannot. Where the two agree, the author's own text is what the render is given,
	 * because the render runs the author's script whole: `const u = new URL(x);
	 * u.searchParams.set('q', y)` holds the query at render time, and the expansion of `u` does
	 * not. See `spec/refusals.md`.
	 */
	plain: Locals['rewrite'];
	/** The rune a declared name was written with, which decides whether a tag naming it is dynamic. */
	runeOf: Locals['rune'];
	declares: Locals['has'];
	/**
	 * What a component `bind:` settles a name to, by the caller's local: `expr === undefined ?
	 * <what the child sends> : expr`.
	 *
	 * Read where the template itself reads the name and never inside a declaration this pass
	 * expands on the way, because `transform-server.js` wraps only `template.body` in the settling
	 * loop and the instance script runs once, above it. Collected on one pass and given to the
	 * next, since Svelte re-renders the whole template and the settled value holds above the tag
	 * as well as below it. See `Site.sends`.
	 */
	sent: ReadonlyMap<string, string>;
	/** Whether the walk is inside a `<svelte:boundary>`, whose `failed` snippet is Svelte's to call. */
	boundary?: true;
	/**
	 * Whether this file is in legacy mode, which is the one thing that decides whether a fragment's
	 * `{@const}`s are put in topological order: `clean_nodes` calls `sort_const_tags` under
	 * `!state.analysis.runes` and nowhere else. Read the way `2-analyze/index.js` reads it --
	 * `<svelte:options runes={...}>` first, then whether anything in the scripts is a rune.
	 */
	legacy: boolean;
	/** Every snippet this component declares, by name, with how many parameters it takes. */
	snippets: ReadonlyMap<string, Snippet>;
	pending: PendingChoice[];
	/**
	 * The markup the walk folded away, by root-relative path: what no request reaches.
	 *
	 * Only a branch behind a test the request does not decide, so it is dead for every request and
	 * not only for this render. What the name check owes an author is a name that would have gone
	 * into the bytes as nothing; there are no bytes here. Shared by reference across the walk, the
	 * way the copies and the choices are, so a component entered anywhere records under its own
	 * name. See `resolved()` in the ast package.
	 */
	dead: Map<string, [number, number][]>;
	/**
	 * A held declaration's initialiser, by the index the substitution refers to it with.
	 *
	 * One list for the whole walk, so the index is unique across the entry and every copy: a child
	 * entered twice is two copies with two call sites, and one name over two values is a silent
	 * wrong byte. The pass that names derivations resolves the reference. See spec/derivation.md.
	 */
	keeping: { expression: string; files?: string[] }[];
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
	 * Whether a whitespace-only text node here is removed rather than collapsed to one space, which
	 * is `can_remove_entirely` in `clean_nodes`: inside an `<svg>` and outside a `<text>`, and in a
	 * handful of elements whose children are rows or options. A stamp standing alone there has to
	 * be an element, or the whitespace beside it survives where Svelte had none. See `carrier()`.
	 */
	tight: boolean;
	/** Whether the walk is in the svg namespace, which decides which element may carry a stamp. */
	svg: boolean;
	/**
	 * Whether this file's stylesheet relates siblings, which decides whether a stamp that has to be
	 * an element may be written at all. See `stamps()`.
	 */
	siblings: boolean;
	/**
	 * The one node the enclosing fragment holds, where it holds one. Compared by identity, so a
	 * walk carrying it past the fragment it was read for matches nothing. See `onlyChild`.
	 */
	alone: unknown;
	/**
	 * Whether the fragment about to be walked is one Svelte reads `is_standalone` for.
	 *
	 * `clean_nodes` computes the flag for every fragment, but only `Fragment.js` puts it on the
	 * state the visitors read. Two visitors take `{ hoisted, trimmed }` off `clean_nodes` and call
	 * `process_children` themselves -- `RegularElement.js` and `TitleElement.js` -- so what their
	 * children see is the enclosing fragment's value, and inside an element that is always false:
	 * the flag needs the fragment's one trimmed node to be a `Component`, and the node the walk
	 * came through to get inside an element is the element. Every block visits its fragment, so an
	 * `{#if}`, an `{#each}`, a `{#key}`, a `{#snippet}`, an `{#await}`, a boundary and a
	 * component's own children all get a fresh flag of their own.
	 *
	 * So this is false only under an element or a `<title>`. See `selfCall`.
	 */
	standalone: boolean;
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
	selecting?: { value: string; multiple: string };
	/**
	 * What each name an enclosing `{#each}` binds is iterated over, as the block's source expanded.
	 *
	 * Only a plain name, and only the expression rather than the render's answer to it. A component
	 * tag naming one of these is the one thing that cannot be a marker: the body is written once and
	 * every item renders the same bytes, so the tag has to be the same component for all of them.
	 * See `perItem()`.
	 */
	items: ReadonlyMap<string, string>;
	/**
	 * True while walking an element's attributes, as against a component's props. Only an
	 * element is scoped by the stylesheet, which is what `classValue` is for.
	 */
	scoping?: boolean;
	/**
	 * True while walking the value of an element's `class` attribute.
	 *
	 * Whether Svelte scopes an element is decided by whether a selector in the `<style>` could
	 * match it, and for a `class` written as an expression that is decided by what the expression
	 * could evaluate to: `gather_possible_values` in `2-analyze/css/utils.js` reads a literal, a
	 * ternary, a logical and an array, and gives up on anything else, which is then a class that
	 * could be anything and an element that is scoped. So a marker, which is a literal, or a
	 * constant written back in place of `className`, told the analysis the class was known and
	 * matched nothing, and the scoping hash went missing from the render.
	 *
	 * It was wrapped as `(0, ...)`, a sequence the analysis cannot read at all. **That is right
	 * only where the author's own expression could not be read either.** A class written as a
	 * ternary of literals is one it reads: it gathers both, finds no selector matching either, and
	 * does not scope -- so hiding them scoped an element Svelte leaves alone. press writes
	 * `class="truncate {tone === 'dark' ? 'text-black' : 'text-white'}"`, and that one class was
	 * every differing byte of two hundred and sixty-seven of its responses.
	 *
	 * So what is written goes in the taken branch of a ternary and the author's expression stays
	 * in the other: the analysis reads the author's possible values exactly as it would have, plus
	 * a marker that matches no selector, and gives up on the author's where it always did. The
	 * branch is never evaluated -- the test is `1` -- so what it names need not hold anything.
	 * Measured over both stylesheets that can matter, against every shape the analysis reads.
	 */
	classValue?: boolean;
	/** True while walking any part of an element's `class` attribute, which is shielded. */
	inClass?: boolean;
	/**
	 * True while walking the branches of a block whose test the request does not decide and the
	 * render has not yet been asked about. The render this pass makes forces a branch to hold
	 * it, so nothing inside may be handed to the render to evaluate -- `tip.stat.lang` under
	 * `{#if tip}` throws where `tip` is state with no value -- and nothing inside is asked, since
	 * the next pass walks only the branch taken. Everything inside is a hole this pass, as it was.
	 */
	asking?: boolean;
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

/**
 * An edit whose text is the only thing a render's branch choice decides.
 *
 * The walk asks `taken` in exactly four places and each of them writes one of two constants:
 * `true` or `false` for an if's test, a resolved promise or a placeholder for an `{#await}`, one
 * element or none for an each, and the same pair inside the `{#if}` a content binding opens. Every
 * other thing a walk produces -- the holes, the blocks, the copies, every span -- is the same for
 * every branch, because `collect()` goes into all of them whatever `taken` says. That is what lets
 * a route be walked once per structure and re-materialised per render. See `rechosen`.
 */
export interface Choice {
	/** The edits this one sits in: the entry's own, or one copy's. */
	edits: Edit[];
	at: number;
	block: number;
	branch: number;
	/** The text where the render takes this branch, and where it does not. */
	taken: string;
	untaken: string;
}

export interface Rewritten {
	rewritten: string;
	/** What `rewritten` was made from, kept so another render's choices can be applied to it. */
	source: string;
	/** The edits that made it, kept for the same reason. See `rechosen`. */
	edits: Edit[];
	/** The markup no request reaches, by root-relative path. See `Walk.dead`. */
	dead: Map<string, [number, number][]>;
	/** Every held declaration's initialiser. See `Walk.keeping`. */
	keeping: { expression: string; files?: string[] }[];
	/** The names substitution cannot follow, with why. See `Site.changing`. */
	changing: ReadonlyMap<string, string>;
	/** Every edit whose text a branch choice decides, the entry's and every copy's. */
	choices: Choice[];
	/** What a component `bind:` settles a name to, found on this pass. See `Site.sends`. */
	sends: ReadonlyMap<string, string>;
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
	/** The payload's keys, which the entry's `$props()` names, or null where it could not be read. */
	payload: string[] | null;
	/** A default on one of those keys, as the derivation that decides it. See `Skeleton.defaults`. */
	defaults: { name: string; expression: string; files: string[] }[];
	/** Tests the render is asked to decide, by their expanded text. See `Site.asks`. */
	asks: string[];
	/** Values the render is asked for, by their expanded text. See `Site.wants`. */
	wants: string[];
	/** Class decisions whose outcomes the render has still to supply the hash for. */
	pending: PendingChoice[];
	/** The hole standing for the entry's own `$props.id()` anchor, where it declares one. */
	fresh?: number;
}

/**
 * Markup that reaches the server and writes nothing, so the walk steps over it.
 *
 * Each of these is measured rather than assumed: `corpus/cases/inert.svelte` holds them all
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
	// No server visitor emits one: `shared/component.js` puts it into a component's props, where
	// nothing on the server calls it, and an element's is not visited at all.
	'AttachTag',
	'DebugTag',
	// Read where the caller's markup is grouped, not where it is written: a `let:` names what the
	// component supplies to the slot it belongs to, and `hands()` collects it. `build_inline_component`
	// puts it in the slot function's parameter and writes nothing for it here. See `Given.handed`.
	'LetDirective',
]);

/**
 * Markup this pass has not been taught, and what to tell the author about it.
 *
 * Every message names one of the three situations `spec/refusals.md` sets out: the shape is
 * understood and unwritten, the protocol has no answer yet, or there is another way to write it.
 * A refusal that says only that something is wrong has failed.
 */
const REFUSED: Record<string, string> = {
	BindDirective:
		'this `bind:` is one the server writes, and the value has nowhere to be planted: `bind:` ' +
		'takes a name rather than an expression, so a marker cannot stand where the value goes. The ' +
		'bindings that write nothing are handled',
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
 * Whether a group holds anything Svelte writes a slot function for.
 *
 * `build_inline_component` visits the group and drops it where the block comes out empty --
 * `if (block.body.length === 0) continue` -- and whitespace around a named slot's element is what
 * `clean_nodes` takes out. `<Child a="b"><div slot="foo" /></Child>` has a default group of two
 * whitespace text nodes and no default slot at all, and giving the props object a `children` for it
 * put a key in `Object.keys($props())` that Svelte does not have.
 */
function filled(group: Given | undefined): boolean {
	if (group === undefined) return false;
	return group.nodes.some(
		(one) => !isNode(one) || one['type'] !== 'Text' || String(one['data'] ?? '').trim() !== '',
	);
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
 * The way in, read forward out of Svelte's own `_extract_paths` in `compiler/utils/ast.js`, which
 * is the client transform's answer to the same question. There is a way in to every name a pattern
 * binds, and it is not always a member: a key written `[expr]` or as a literal is an index, a
 * nesting is one way in written after another, and a rest is a call --
 * `exclude_from_object(value, keys)` for an object, `to_array(value).slice(n)` for an array. Both
 * are Svelte's own, carried the way `attributes` is, so the emptying rule and the symbol handling
 * are upstream's rather than reproduced here.
 *
 * A default is written the way JavaScript reads one: taken when the value is `undefined` and only
 * then. A computed key is expanded against what the pattern has bound so far, because JavaScript
 * binds a pattern left to right and `{ length, [length - 1]: last }` reads the one from the other.
 */
function takenApart(
	pattern: AstNode,
	argument: string,
	expand: Locals['rewrite'],
	what: () => string,
): Map<string, string> {
	const bound = new Map<string, string>();
	// Bound so far, so a computed key reaches a name written before it in the same pattern.
	const write = (node: unknown): string => expand(node, bound);
	const withDefault = (reached: string, fallback: unknown): string =>
		`(${reached} === undefined ? (${write(fallback)}) : ${reached})`;
	const one = (target: unknown, reached: string): void => {
		if (!isNode(target)) return;
		const type = target['type'];
		if (type === 'Identifier' && typeof target['name'] === 'string') {
			bound.set(target['name'], reached);
			return;
		}
		if (type === 'AssignmentPattern') {
			one(target['left'], withDefault(reached, target['right']));
			return;
		}
		// `let:x={{ a, b }}` parses as an expression and is really a pattern -- Svelte says so in as
		// many words, `shared/component.js` rebuilding it with `b.object_pattern(expression.properties)`
		// and an `@ts-expect-error` beside it. Only the outermost one is rebuilt there, because the
		// printer turns the rest back into source JavaScript reads as a pattern; here the node is
		// walked, so both spellings are read at every depth.
		if (type === 'ObjectPattern' || type === 'ObjectExpression') {
			// The keys a rest leaves out are every key the pattern names, in the order Svelte writes
			// them: a plain name as itself, a literal as its value read as a string, and a computed
			// key as `String(...)` of the expression, which evaluates it a second time.
			const taken: string[] = [];
			for (const property of Array.isArray(target['properties']) ? target['properties'] : []) {
				if (!isNode(property)) continue;
				if (property['type'] === 'RestElement' || property['type'] === 'SpreadElement') {
					one(property['argument'], `$$exclude_from_object(${reached}, [${taken.join(', ')}])`);
					continue;
				}
				if (property['type'] !== 'Property') continue;
				const key = property['key'];
				if (!isNode(key)) refuse(`${what()} has a key this compiler cannot read`);
				const computed = property['computed'] === true;
				const literal = key['type'] === 'Literal';
				if (!computed && key['type'] === 'Identifier' && typeof key['name'] === 'string') {
					taken.push(JSON.stringify(key['name']));
					one(property['value'], `${reached}.${key['name']}`);
					continue;
				}
				taken.push(literal ? JSON.stringify(String(key['value'])) : `String(${write(key)})`);
				one(property['value'], `${reached}[${write(key)}]`);
			}
			return;
		}
		if (type === 'ArrayPattern' || type === 'ArrayExpression') {
			// Through `to_array` and not by index. An array pattern destructures by the iterator
			// protocol -- Svelte's server writes `let [a, b] = each_array[i]` and lets the engine do
			// it -- and reading `value[0]` instead is the same answer for an array and no answer at
			// all for anything else: measured, `{#each rows as [a, b]}` over a list of sets wrote
			// `-` where Svelte wrote `x-y`.
			//
			// **Without the count `_extract_paths` passes.** That is the client transform's answer to
			// this question and it is one step away from the server's: `to_array(value, n)` caps an
			// unbounded iterator at `n`, and it reaches that branch through `Symbol.iterator in
			// value`, which throws on a primitive. `{@const [first] = 'ab'}` destructures on the
			// server and threw here. So the call is made the way the branch below it behaves --
			// arrays unchanged, everything else through `Array.from` -- which is the engine's answer
			// for every source but an endless one, and an endless one is not a thing a render ends
			// on either way.
			const elements = Array.isArray(target['elements']) ? target['elements'] : [];
			const listed = `$$to_array(${reached})`;
			for (const [at, element] of elements.entries()) {
				if (!isNode(element)) continue;
				if (element['type'] === 'RestElement') {
					one(element['argument'], `${listed}.slice(${String(at)})`);
					continue;
				}
				one(element, `${listed}[${String(at)}]`);
			}
			return;
		}
		refuse(`${what()} destructures in a way this compiler cannot read: a ${String(type)}`);
	};
	one(pattern, argument);
	return bound;
}

/**
 * Writes over everything in a pattern the render would evaluate, leaving one that binds the same
 * names from a placeholder without reaching for anything.
 *
 * The render takes the pattern apart from `{}` or `[]` and every read of what it binds is a marker
 * already, so nothing the pattern computes is wanted -- and each of these throws or reaches for
 * data the render is not given. A default's value and a computed key become `undefined`; a nested
 * pattern becomes a name, because `{ a: { b } }` over `{}` destructures `undefined` and throws,
 * which is Svelte's own output failing on a placeholder nobody wrote. The name carries `$$`, which
 * Svelte reserves and no author can collide with, and the position it stands at, which no two
 * nestings in one file share.
 */
function neutralise(pattern: unknown, edits: [number, number, string][], top = true): void {
	if (!isNode(pattern)) return;
	const type = pattern['type'];
	const at = span(pattern);
	if (!top && (type === 'ObjectPattern' || type === 'ArrayPattern')) {
		if (at !== null) edits.push([at[0], at[1], `$$p${String(at[0])}`]);
		return;
	}
	if (type === 'AssignmentPattern') {
		const where = span(pattern['right']);
		if (where !== null) edits.push([where[0], where[1], 'undefined']);
		neutralise(pattern['left'], edits, top);
		return;
	}
	if (type === 'RestElement') {
		neutralise(pattern['argument'], edits, false);
		return;
	}
	if (type === 'ObjectPattern') {
		for (const property of Array.isArray(pattern['properties']) ? pattern['properties'] : []) {
			if (!isNode(property)) continue;
			if (property['type'] === 'RestElement') {
				neutralise(property, edits, false);
				continue;
			}
			if (property['computed'] === true) {
				const where = span(property['key']);
				if (where !== null) edits.push([where[0], where[1], 'undefined']);
			}
			neutralise(property['value'], edits, false);
		}
		return;
	}
	if (type === 'ArrayPattern') {
		for (const element of Array.isArray(pattern['elements']) ? pattern['elements'] : []) {
			neutralise(element, edits, false);
		}
	}
}

/** Writes each expression of an attribute back out in its expanded form, for Svelte to evaluate. */
function expanded(
	attr: AstNode,
	source: string,
	walk: Walk,
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
		if (where === null) continue;
		// The author's own text where the walk bound nothing in it, so that the render runs the
		// author's script whole. See `asWritten`.
		const written = walk.expand(part['expression']);
		edits.push([where[0], where[1], asWritten(part['expression'], written, walk)]);
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

/** Whether a fragment writes a name out as a value: `{children}`, not `{@render children()}`. */
function reads(ast: AstNode, name: string): boolean {
	let found = false;
	const step = (one: unknown): void => {
		if (found) return;
		if (Array.isArray(one)) {
			for (const each of one) step(each);
			return;
		}
		if (!isNode(one)) return;
		if (one['type'] === 'ExpressionTag') {
			const held = one['expression'];
			if (isNode(held) && held['type'] === 'Identifier' && held['name'] === name) {
				found = true;
				return;
			}
		}
		for (const value of Object.values(one)) step(value);
	};
	step(ast['fragment']);
	return found;
}

/**
 * Svelte's `DOM_BOOLEAN_ATTRIBUTES`, which `crates/lowering/src/attributes.rs` carries for the
 * runtime and this file needs for the one element whose attributes the render cannot show.
 */
const BOOLEAN = new Set([
	'allowfullscreen',
	'async',
	'autofocus',
	'autoplay',
	'checked',
	'controls',
	'default',
	'defer',
	'disabled',
	'disablepictureinpicture',
	'disableremoteplayback',
	'formnovalidate',
	'indeterminate',
	'inert',
	'ismap',
	'loop',
	'multiple',
	'muted',
	'nomodule',
	'novalidate',
	'open',
	'playsinline',
	'readonly',
	'required',
	'reversed',
	'seamless',
	'selected',
	'webkitdirectory',
]);

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
/**
 * Whether some `<option>` under this `<select>` writes no `value` and holds a body this walk cannot
 * read as one value.
 *
 * `renderer.option` compares against the rendered body where the attribute is absent, and the walk
 * can read that body only where it is text, or one expression. A `{@render}` in it is bytes the
 * render writes and nothing here can name.
 */
function unreadable(node: AstNode): boolean {
	let found = false;
	const step = (one: unknown): void => {
		if (found) return;
		if (Array.isArray(one)) {
			for (const each of one) step(each);
			return;
		}
		if (!isNode(one)) return;
		if (one['name'] === 'option' && one['type'] === 'RegularElement') {
			if (attributeOf(one, 'value') === undefined) {
				const fragment = one['fragment'];
				const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
				const [only] = nodes;
				const single = nodes.length === 1 && isNode(only) && only['type'] === 'ExpressionTag';
				const text = nodes.every((child) => isNode(child) && child['type'] === 'Text');
				if (!single && !text) found = true;
			}
		}
		for (const value of Object.values(one)) step(value);
	};
	step(node['fragment']);
	return found;
}

function selection(
	node: AstNode,
	source: string,
	expand: Locals['rewrite'],
	holes: Hole[],
	edits: [number, number, string][],
	selecting: Walk['selecting'],
	skipped: Set<unknown>,
	/** Keys the spread pass must leave out of the object it builds, lowercased. */
	dropped: Set<string>,
	/** Whether a value is the same every request, so the render's own comparison is every one's. */
	inert: (text: string) => boolean,
): Walk['selecting'] {
	const tag = node['name'];
	if (tag === 'select') {
		// `renderer.select()` takes both off the attributes, writes neither, and compares the
		// options against `value === undefined ? defaultValue : value`.
		//
		// A spread carries either of them exactly as a written attribute does, because the renderer
		// reads them off the **merged** attributes. So the tag is read in source order and the last
		// of each name wins, which is what building one object out of the parts does -- and both
		// have to come off the tag, or Svelte's own `select()` does the comparison a second time
		// over what was left. Measured before either was: `<select {...{ defaultValue: 'b' }}
		// defaultValue="a">` marked both options, ours from the attribute and Svelte's own from the
		// spread.
		//
		// Taking one out of a spread means rewriting the object, which is only possible where its
		// keys can be listed. Where they cannot, the value is the request's and so is the option
		// that carries it, and that is refused by name.
		const listed = Array.isArray(node['attributes']) ? node['attributes'] : [];
		// Where a spread is on the tag, the spread pass rewrites the whole run of attributes and
		// two passes writing over the same span is an error. So the names go into `dropped` and the
		// edits are that pass's; without a spread they are this one's.
		const spreading = listed.some((one) => isNode(one) && one['type'] === 'SpreadAttribute');
		/** Kept until the tag is known to be one this walk models, since taking it off is an edit. */
		const taken: AstNode[] = [];
		const each = (attribute: AstNode): string => {
			const written = valueExpression(attribute, source, expand);
			if (written === null) {
				refuse(
					'`<select value>` mixing text and an expression is not handled yet: the options ' +
						'compare against the joined string',
				);
			}
			taken.push(attribute);
			return written;
		};
		let chosen: string | undefined;
		let held: string | undefined;
		/** What `!!select_attrs.multiple` reads, as an expression rather than as a syntax fact. */
		let several = 'false';
		for (const one of listed) {
			if (!isNode(one)) continue;
			if (one['type'] === 'SpreadAttribute') {
				const grown = expand(one['expression']);
				const entries = objectEntries(grown);
				// Keys this pass can list are read as written, which keeps the value a literal where the
				// object is one. Where it cannot list them the three names are read off the object
				// instead, which is what `renderer.select` does: `const { value, defaultValue, ...rest }
				// = attrs`, so a key the object does not carry is `undefined` there and here. The
				// select takes charge either way, because an object whose keys nobody can list may
				// carry one and the comparison cannot be left half to the render.
				//
				// **A spread only overwrites the keys it has.** `{ value: v, ...other }` keeps `v`
				// where `other` has no `value`, so reading the key off the object unconditionally
				// wrote `undefined` over a value the tag had already given: measured on
				// `select-multiple-spread-and-bind`, whose `bind:value` came before `{...other}` and
				// lost to an object with neither key in it.
				if (entries === null) {
					chosen = merges(grown, 'value', chosen);
					held = merges(grown, 'defaultValue', held);
					several = merges(grown, 'multiple', several);
					continue;
				}
				for (const [key, value] of entries) {
					const name = key.toLowerCase();
					if (name === 'value') chosen = `(${value})`;
					else if (name === 'defaultvalue') held = `(${value})`;
					else if (name === 'multiple') several = `(${value})`;
				}
				continue;
			}
			if (one['type'] !== 'Attribute' || typeof one['name'] !== 'string') continue;
			const name = one['name'].toLowerCase();
			if (name === 'value') chosen = each(one);
			else if (name === 'defaultvalue') held = each(one);
			// `select()` reads `renderer.local.multiple = !!select_attrs.multiple`, which is the
			// value rather than the attribute being written: `multiple={false}` is not multiple.
			// Taken off the tag rather than off `taken`, since it stays where it was written.
			else if (name === 'multiple') several = valueExpression(one, source, expand) ?? 'true';
		}
		if (chosen === undefined && held === undefined) return undefined;
		const written =
			chosen === undefined
				? String(held)
				: held === undefined
					? chosen
					: `(${chosen} === undefined ? ${held} : ${chosen})`;
		// `renderer.option` compares against the **rendered body** where the option writes no `value`
		// of its own, and a body this walk cannot read as one value is a body it cannot compare. The
		// comparison is the render's to make in that case: nothing here varies with the request, so
		// the bytes the render writes are the bytes every request gets, and the way to leave it to
		// the render is to leave the tag alone -- both names have to stay on it, or `select()` sees
		// neither. Only where nothing varies; where the value is the request's the option is refused
		// by name as before.
		if (inert(written) && unreadable(node)) return undefined;
		for (const attribute of taken) {
			if (!spreading) {
				const at = span(attribute);
				if (at !== null) edits.push([at[0], at[1], '']);
			}
			skipped.add(attribute);
		}
		if (spreading) {
			dropped.add('value');
			dropped.add('defaultvalue');
		}
		// `select()` maps `multiple === ''` to `true` before reading it, because `multiple=""` is a
		// present boolean attribute in markup and `!!''` is false. Folded where the value is written,
		// and written out where it comes off an object nobody can list the keys of.
		const many =
			several === '""'
				? 'true'
				: several === 'true' || several === 'false'
					? several
					: `((${several}) === '' ? true : (${several}))`;
		return { value: written, multiple: many };
	}
	if (tag !== 'option') return selecting;

	// Every `<option>` goes through `renderer.option` -- `is_option_special` in `RegularElement.js`
	// is the name alone, with no `<select>` around it required -- so its attributes are written by
	// `attributes()` rather than folded into the template. That helper writes a boolean attribute
	// as `name=""` whatever its value, so a marker planted as one never comes back and the render
	// showed `disabled=""` on every item of an each. It is a decision, and it takes the shape
	// `selected` takes below: the marker rides in an attribute of its own, planted where the
	// boolean one stood so the order the helper writes in is kept, and the decision owns the whole
	// of that attribute -- the space, the name, the value.
	for (const attribute of Array.isArray(node['attributes']) ? node['attributes'] : []) {
		if (!isNode(attribute) || attribute['type'] !== 'Attribute') continue;
		const name = typeof attribute['name'] === 'string' ? attribute['name'].toLowerCase() : '';
		if (!BOOLEAN.has(name)) continue;
		const parts = Array.isArray(attribute['value']) ? attribute['value'] : [attribute['value']];
		const [only] = parts;
		// Written as text or as nothing, the helper's answer is the same every request and the
		// render already shows it.
		if (parts.length !== 1 || !isNode(only) || only['type'] !== 'ExpressionTag') continue;
		const where = span(attribute);
		if (where === null) continue;
		const index = holes.length;
		holes.push({
			index,
			expression: '',
			raw: false,
			choice: { tests: [`!!(${expand(only['expression'])})`], outcomes: ['', ` ${name}=""`] },
		});
		edits.push([
			where[0],
			where[1],
			`data-seam-boolean-${String(index)}={${JSON.stringify(sentinel(index))}}`,
		]);
		skipped.add(attribute);
	}

	if (selecting === undefined) return selecting;

	// `renderer.option` compares against the rendered body and takes the attributes' `value` over it
	// where they have one: `if (has_own_property.call(attrs, 'value')) value = attrs.value`. A spread
	// carries the key exactly as a written attribute does, so the run is read in source order and
	// the last of them wins, the way a select's is.
	let spread: string | undefined;
	for (const one of Array.isArray(node['attributes']) ? node['attributes'] : []) {
		if (!isNode(one) || one['type'] !== 'SpreadAttribute') continue;
		const grown = expand(one['expression']);
		const entries = objectEntries(grown);
		if (entries === null) {
			spread = merges(grown, 'value', spread);
			continue;
		}
		for (const [key, value] of entries) if (key.toLowerCase() === 'value') spread = `(${value})`;
	}
	const own = attributeOf(node, 'value');
	let compared: string | null;
	if (own !== undefined) {
		compared = valueExpression(own, source, expand);
	} else if (spread !== undefined) {
		compared = spread;
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
	// `select()` puts `!!select_attrs.multiple` on the renderer and `option()` reads it, so it is a
	// value like the select's own. The two literal cases keep the shape they had, since every
	// derivation this compiler has recorded was written with them.
	const test =
		multiple === 'false'
			? `(${value}) === (${compared})`
			: multiple === 'true'
				? `(Array.isArray(${value}) ? (${value}).includes(${compared}) : (${value}) === (${compared}))`
				: `((${multiple}) && Array.isArray(${value}) ? (${value}).includes(${compared}) : (${value}) === (${compared}))`;
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
/**
 * A key read off a merged object the way a spread merges it: only where the object has it.
 *
 * `{ value: v, ...other }` keeps `v` where `other` has no `value`, so reading the key off the
 * object unconditionally writes `undefined` over a value the tag had already given.
 */
function merges(object: string, key: string, before: string | undefined): string {
	const named = JSON.stringify(key);
	const held = before ?? 'undefined';
	return `(Object.prototype.hasOwnProperty.call(${object}, ${named}) ? (${object})[${named}] : ${held})`;
}

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
 * A binding the server writes as the element's content: `bind:innerHTML`, unescaped, and
 * `bind:textContent`, `bind:innerText` and a textarea's `bind:value`, escaped.
 *
 * `RegularElement.js`: the binding's expression is the body, written when truthy and the
 * children otherwise, with no anchor around either -- which is not `{@html}`, whose anchors the
 * client reads. With no children the body is the whole content: `value || ''` raw for
 * `innerHTML`, and `{value}` for the rest, which `unbind.ts` writes. With children it is a
 * decision between the value and them, and it is written as the if it is, marked bare so that
 * the anchors the render carries stay out of the bytes. A textarea takes no block, so there the
 * children are the text they can only be and the choice is one expression.
 *
 * What is tested is what Svelte tests: the value itself for `innerHTML`, and `$.escape(value)`
 * for the rest, which is empty exactly when `String(value ?? '')` is.
 */
function contents(
	node: AstNode,
	walk: Walk,
	holes: Hole[],
	edits: [number, number, string][],
	skipped: Set<unknown>,
): number | undefined {
	const { source, expand, blocks, within, stream } = walk;
	const tag = typeof node['name'] === 'string' ? node['name'] : '';
	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	const binding = attributes.find(
		(one): one is AstNode =>
			isNode(one) &&
			one['type'] === 'BindDirective' &&
			(one['name'] === 'innerHTML' ||
				one['name'] === 'textContent' ||
				one['name'] === 'innerText' ||
				(one['name'] === 'value' && tag === 'textarea')),
	);
	if (binding === undefined) return;
	const raw = binding['name'] === 'innerHTML';
	const fragment = node['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const at = span(binding);
	const close = closing(source, node);
	if (at === null || source[close - 1] === '/')
		refuse(`\`bind:${String(binding['name'])}\` on a tag this compiler cannot read`);
	const value = `(${expand(binding['expression'])})`;
	skipped.add(binding);
	edits.push([at[0], at[1], '']);

	if (nodes.length === 0) {
		const index = holes.length;
		holes.push({ index, expression: `(${value} || '')`, raw: true });
		edits.push([close + 1, close + 1, sentinel(index)]);
		return;
	}

	if (tag === 'textarea') {
		// Its children are text and nothing else once Svelte has looked at them: anything dynamic
		// is moved into a `value` attribute by `2-analyze/visitors/RegularElement.js`, which a
		// binding beside it then contradicts.
		const parts: string[] = [];
		for (const child of nodes) {
			if (!isNode(child) || child['type'] !== 'Text') {
				refuse(
					'a `<textarea>` with a `bind:value` and children that are not text is not handled ' +
						'yet: Svelte moves such children into a `value` attribute',
				);
			}
			parts.push(JSON.stringify(String(child['data'] ?? '')));
		}
		const index = holes.length;
		holes.push({
			index,
			expression: `(String(${value} ?? '') !== '' ? ${value} : ${parts.join(' + ')})`,
			raw: false,
		});
		const whole = span(node);
		const end = whole === null ? -1 : source.lastIndexOf('</', whole[1]);
		if (end < 0) refuse('a `<textarea>` this compiler cannot read the end of');
		edits.push([close + 1, end, sentinel(index)]);
		return;
	}

	const test = raw ? value : `String(${value} ?? '') !== ''`;
	const index = blocks.length;
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
		bare: true,
	});
	const hole = holes.length;
	holes.push({ index: hole, expression: value, raw });
	const whole = span(node);
	const end = whole === null ? -1 : source.lastIndexOf('</', whole[1]);
	if (end < 0)
		refuse(
			`an element with \`bind:${String(binding['name'])}\` this compiler cannot read the end of`,
		);
	chose(
		walk,
		edits,
		close + 1,
		close + 1,
		index,
		0,
		`{#if true}${sentinel(hole)}{:else}`,
		`{#if false}${sentinel(hole)}{:else}`,
	);
	const [from, to, text] = stamped({ ...walk, parent: tag }, index, walk.source, end);
	edits.push([from, to, `{/if}${text}`]);
	// The children are the else, and the caller walks them within it.
	return index;
}

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
function componentFile(tag: string, walk: Walk): string | null {
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
function shared(ast: AstNode, file: string, edits: [number, number, string][]): void {
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
function moduleExports(ast: AstNode): { names: Set<string>; taken: [number, number][] } {
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
				if (isNode(each)) namesIn(each['id'], found);
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
function unimported(text: string): string {
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
function importsItself(raw: string, file: string): boolean {
	return [...importedBy(raw).values()].some(
		(one) =>
			one.from.startsWith('.') &&
			one.from.endsWith('.svelte') &&
			resolvePath(dirname(file), one.from) === file,
	);
}

/**
 * What a call of a component fragment binds each prop to: the caller's expression, or the prop's
 * own default where the caller leaves it out or passes `undefined`, as JavaScript does.
 */
function propBinds(
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
function selfCall(
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
function callsHead(walk: Walk, fragment: string, binds: [string, string][]): number | null {
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

function reachesItself(file: string, raw: string): boolean {
	const edges = (from: string, source?: string): string[] => {
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
	};
	const seen = new Set<string>();
	const pending = edges(file, raw).slice();
	for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
		if (next === file) return true;
		if (seen.has(next)) continue;
		seen.add(next);
		pending.push(...edges(next));
	}
	return false;
}

/**
 * Whether a fragment's first node, whitespace aside, is text or an expression: what `is_text_first`
 * in `clean_nodes` asks before writing an empty comment ahead of a snippet's or component's body.
 */
function opensWithText(fragment: unknown): boolean {
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

function onlyChild(fragment: unknown): unknown {
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const regular = nodes.filter(
		(one) => isNode(one) && one['type'] !== 'Comment' && !HOISTED.has(String(one['type'])),
	);
	const blank = (one: unknown): boolean =>
		isNode(one) && one['type'] === 'Text' && !/\S/.test(String(one['data'] ?? ''));
	let from = 0;
	let to = regular.length;
	while (from < to && blank(regular[from])) from += 1;
	while (to > from && blank(regular[to - 1])) to -= 1;
	return to - from === 1 ? regular[from] : null;
}

/** Whether a snippet renders itself: one of its `{@render}` calls sits inside its own body. */
function recurses(one: Snippet): boolean {
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
function parameterBinds(
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
function standIn(
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

/**
 * Refuses `await` in markup, which is async Svelte: a promise awaited per request while the bytes
 * are written, which is loading data, and the one thing this line gives up by definition. Svelte
 * itself compiles it only under `experimental.async`; `{#await}` is not this, since a synchronous
 * render writes its pending branch and awaits nothing. See spec/roadmap.md.
 */
function awaitless(ast: AstNode, what: string): void {
	// An `await` inside a function is that function's, run when something calls it -- a handler,
	// a load -- and not the render's. Only one the render itself would await is async Svelte.
	const outside = (node: unknown): boolean => {
		if (Array.isArray(node)) return node.some(outside);
		if (!isNode(node)) return false;
		if (node['type'] === 'AwaitExpression') return true;
		if (
			node['type'] === 'FunctionExpression' ||
			node['type'] === 'ArrowFunctionExpression' ||
			node['type'] === 'FunctionDeclaration'
		) {
			return false;
		}
		return Object.values(node).some(outside);
	};
	// The experiment: compiled with `experimental.async` and rendered by awaiting, which is what
	// SvelteKit does when a project turns the same flag on. See spec/roadmap.md.
	if (process.env['SEAM_ASYNC'] !== undefined) return;
	if (outside(ast['fragment']) || outside(ast['instance'])) {
		refuse(
			`${what} awaits in its markup or at the top of its script, which is async Svelte: a ` +
				'value loaded per request while the bytes are written, which is the load stage and not ' +
				"this compiler's to render",
		);
	}
}

/** Whether markup holds a node of this type anywhere inside it. */
function contains(node: unknown, type: string): boolean {
	if (Array.isArray(node)) return node.some((one) => contains(one, type));
	if (!isNode(node)) return false;
	if (node['type'] === type) return true;
	return Object.values(node).some((one) => contains(one, type));
}

/** One plain name, which is what a settled dynamic component is when it is one import. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * The component an expression chooses, settled. A `?:` in it chooses which component, the way one
 * handed to a package chooses what is handed, and is enumerated the same way: the walk stops and
 * asks, and the build renders once per branch. A lookup in a table of components, and what is read
 * off either, is the same choice with its domain in the source -- unfolded by `settled`, which
 * every expression goes through. What the taken branch leaves has to be inert; one that still
 * reaches the request is a component chosen per request, which is not enumerable and is refused.
 */
/**
 * A component tag whose root an `{#each}` binds, written as the one component every item is.
 *
 * The body of an each is written once and every item renders those bytes, so a tag naming the item
 * is only expressible where the item is the same component throughout. The block's source is read
 * for that: a list the source writes out, whose elements all name one thing. Then the root is
 * written as that thing and the tag is Svelte's to render, which is where a member tag already goes
 * -- `2-analyze/visitors/Component.js` marks a tag with a `.` in it dynamic and the server writes
 * the anchors for it.
 *
 * True where it wrote the name, false where the caller should refuse. A list whose elements differ
 * is the false case and stays refused: the body would have to be written once per element, which is
 * the block unrolled and not the block.
 */
function perItem(
	node: AstNode,
	tag: string,
	walk: Walk,
	edits: [number, number, string][],
): boolean {
	const [head] = tag.split('.');
	if (head === undefined) return false;
	const over = walk.items.get(head);
	if (over === undefined) return false;
	const listed = elements(over);
	if (listed === null || listed.length === 0) return false;
	const [only] = listed;
	if (only === undefined || !listed.every((one) => one === only)) return false;
	// A tag's name is a path of names and not an expression, so what goes in its place has to be one
	// too. `member_id` splits on `.` and builds the chain, which is the only shape it can build.
	const named = unwrapped(only);
	if (!PATH.test(named)) return false;
	// The block's source is a derivation like any other, and `carriedBy` carries no component: the
	// default export of a `.svelte` file is composed at compile time and is never a value an
	// expression calls. So a list of components written that way cannot be evaluated at all, and the
	// tag is not this pass's to answer. A named export of a component's module script is an ordinary
	// import and is carried, which is what `component-namespace` writes.
	const [root] = named.split('.');
	if (root === undefined || componentImport(root, walk)) return false;
	const at = span(node);
	const name = typeof node['name'] === 'string' ? node['name'] : '';
	if (at === null || name === '' || !walk.source.startsWith(`<${name}`, at[0])) return false;
	edits.push([at[0] + 1, at[0] + 1 + head.length, named]);
	const closing = `</${name}>`;
	if (walk.source.endsWith(closing, at[1])) {
		const from = at[1] - closing.length + 2;
		edits.push([from, from + head.length, named]);
	}
	return true;
}

/** A tag's name: `member_id` splits it on `.` and builds the chain, so it is a path of names. */
const PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

/** The elements of an array literal, as source, or null where the expression is not one. */
function elements(expression: string): string[] | null {
	let ast: Node;
	try {
		ast = parsed(expression) as unknown as Node;
	} catch {
		return null;
	}
	const fragment = (ast as unknown as AstNode)['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const [tag] = nodes;
	if (nodes.length !== 1 || !isNode(tag) || tag['type'] !== 'ExpressionTag') return null;
	// `parsed` wraps the expression in a component -- `{<expression>}` in its markup -- so an offset
	// in the tree is an offset in that wrapper. Just past the tag's own `{` is the expression's
	// offset zero, which the expression node is not: a parenthesised one may or may not survive as a
	// node of its own, and its start is then past the paren.
	const base = (span(tag)?.[0] ?? -1) + 1;
	if (base === 0) return null;
	let held: unknown = tag['expression'];
	while (isNode(held) && held['type'] === 'ParenthesizedExpression') held = held['expression'];
	if (!isNode(held) || held['type'] !== 'ArrayExpression') return null;
	const found: string[] = [];
	for (const one of Array.isArray(held['elements']) ? held['elements'] : []) {
		const where = span(one);
		if (where === null) return null;
		found.push(`(${expression.slice(where[0] - base, where[1] - base)})`);
	}
	return found;
}

/**
 * Refuses a component tag whose name this walk decides, saying which of the two questions it is.
 *
 * The name is `member_id(node.name)` visited, so only its root is a read; the members are property
 * accesses off whatever that is. A root the walk binds per item is a component chosen per item,
 * which a block can express and a page-wide enumeration cannot. A root the request decides is a
 * component off the wire, which the payload does not carry.
 */
function naming(tag: string, walk: Walk): void {
	const head = tag.split('.')[0] ?? '';
	if (head === '' || !walk.dynamic.has(head)) return;
	// A name a block binds, told apart from one the payload carries the way `stands()` tells them
	// apart: the decision is made per item and there is no page-wide domain to enumerate.
	if (walk.site.payload?.has(head) !== true && !walk.fresh.includes(head)) {
		refuse(
			`\`<${tag} />\` names a component through \`${head}\`, which a block binds, so which ` +
				'component it is is decided per item and cannot be enumerated for the page. Write the ' +
				'choice as an `{#if}` around each component, which is a block and is taken per item. ' +
				'See spec/derivation.md',
		);
	}
	choosing(head, tag, walk);
}

function choosing(written: string, tag: string, walk: Walk): string {
	const chosen = settled(written, walk);
	if (mentions(chosen, walk.dynamic)) {
		refuse(
			`\`<${tag}>\` is handed a component the request decides, and the source names none it ` +
				'could be. The payload carries data and no function, so a component never comes off ' +
				'the wire: the component this renders is the one the request sent, and an artifact ' +
				"has no bytes for it. Name it in the source -- as the prop's default, or beside the " +
				'value in the expression -- or choose it in the load stage. It stands for ' +
				`\`${chosen.replace(/\s+/g, ' ').slice(0, 200)}\``,
		);
	}
	return chosen;
}

/**
 * An expression with the parentheses that wrap the whole of it taken off.
 *
 * They say nothing about what it is. `expand` puts a pair around every name it substitutes, so a
 * `this` that settles to one import comes back as `(Foo)` and an identifier test read it as an
 * expression: the tag was written out for Svelte and the child never entered, which left `bind:x`
 * with no declaration to read.
 */
function unwrapped(text: string): string {
	let held = text.trim();
	while (held.startsWith('(') && held.endsWith(')')) {
		let depth = 0;
		let wraps = true;
		for (const [at, c] of [...held].entries()) {
			if (c === '(') depth += 1;
			else if (c === ')') depth -= 1;
			if (depth === 0 && at < held.length - 1) {
				wraps = false;
				break;
			}
		}
		if (!wraps) break;
		held = held.slice(1, -1).trim();
	}
	return held;
}

/**
 * A snippet name written so the render tag stays the dynamic one it was.
 *
 * `2-analyze/visitors/RenderTag.js` sets `metadata.dynamic = binding?.kind !== 'normal'`, and
 * `is_standalone` in `3-transform/utils.js` wants a `RenderTag` that is **not** dynamic before it
 * lets the parent block's anchor stand for the tag's own. A callee this walk settles was dynamic --
 * a prop, a member expression, anything but a plain reference to a declared snippet -- so writing
 * the settled name bare made the tag static and dropped the `<!---->` Svelte writes after it.
 * `(0, name)` is not an identifier, so the binding is not looked up and the tag stays dynamic;
 * the call is the same call. Measured.
 *
 * **Only where the tag was dynamic.** A callee that is a plain script declaration is `normal`, so
 * the tag is static and the parent block's anchor stands for it -- wrapping that one wrote a
 * `<!---->` Svelte does not. A prop, an import, a rune declaration and anything that is not an
 * identifier are the other side.
 */
function stillDynamic(name: string, dynamic: boolean): string {
	return dynamic ? `(0, ${name})` : name;
}

/**
 * The replacement for a construct's expression, with the `await` the construct had kept.
 *
 * `create_child_block` in `3-transform/server/visitors/shared/utils.js` wraps a node whose
 * `metadata.expression.has_await` is set in `renderer.child_block`, and that pushes `BLOCK_OPEN`
 * and `BLOCK_CLOSE` around what the node writes. This walk substitutes the awaited value away, so
 * Svelte saw no await and wrote no pair -- eight samples short by exactly those four bytes.
 *
 * Keeping the keyword keeps the anchors, and `await` of a value that is not a promise is that
 * value, so nothing else moves. Read off the **expansion** rather than off the source: the await
 * may sit in a declaration the construct reads, which is what `has_await` propagates through --
 * `const foo = $derived(await 1)` beside `{#if foo}` is that, and there is no `await` written in
 * the markup at all.
 */
function awaited(expanded: string, replacement: string): string {
	return awaiting(expanded) ? `await ${replacement}` : replacement;
}

/** Whether an expression awaits outside any function, which is what `has_await` records. */
function awaiting(text: string): boolean {
	if (!/\bawait\b/.test(text)) return false;
	let ast: Node;
	try {
		ast = parsed(text) as unknown as Node;
	} catch {
		return false;
	}
	const outside = (node: unknown): boolean => {
		if (Array.isArray(node)) return node.some(outside);
		if (!isNode(node)) return false;
		if (node['type'] === 'AwaitExpression') return true;
		if (
			node['type'] === 'FunctionExpression' ||
			node['type'] === 'ArrowFunctionExpression' ||
			node['type'] === 'FunctionDeclaration'
		) {
			return false;
		}
		return Object.values(node).some(outside);
	};
	return outside(ast);
}

/** Whether a local name is a component: the default import of a `.svelte` file. See `Carried`. */
function componentImport(local: string, walk: Walk): boolean {
	const held = walk.site.carried.get(local);
	if (held === undefined || held.kind !== 'default') return false;
	return (resolveBare(held.from, walk.site.file) ?? held.from).endsWith('.svelte');
}

/**
 * The one component a value position can hold, following the branches an expression may take.
 *
 * Only the positions whose value is the expression's own value: the right of an `&&`, either side
 * of a `||`, a `??` or a `?:`. A component named anywhere else -- an argument, a property -- is
 * not what the expression evaluates to. Two positions naming different components is a choice
 * wider than one candidate and is not one of these.
 */
function candidateOf(
	node: unknown,
	walk: Walk,
	through: Set<string>,
	/** What counts as the thing being named: a component this file imports, or a snippet it holds. */
	names: (held: string) => boolean,
): string | null {
	if (!isNode(node)) return null;
	const again = (child: unknown): string | null => candidateOf(child, walk, through, names);
	switch (node['type']) {
		case 'Identifier': {
			const name = typeof node['name'] === 'string' ? node['name'] : '';
			// The name itself, and not a nearer binding of it: `{:then { Component }}` beside
			// `import Component from './Component.svelte'` is one name and two things, and the walk
			// already knows which -- a name something binds is substituted, and a prop or an import
			// is left as written. Measured on `await-with-update-2`, which named the import it had
			// shadowed.
			if (unwrapped(walk.expand(node)) !== name) return null;
			if (names(name)) return name;
			// A prop's default is the value the request did not send, and the request cannot send a
			// function, so a default naming one is the only function this name can hold.
			const held = walk.site.defaults.get(name);
			if (held === undefined || through.has(name)) return null;
			through.add(name);
			return again(held);
		}
		case 'ParenthesizedExpression':
			return again(node['expression']);
		case 'SequenceExpression': {
			const parts = Array.isArray(node['expressions']) ? node['expressions'] : [];
			return again(parts[parts.length - 1]);
		}
		case 'LogicalExpression': {
			// `&&` is its right side or something falsy, which renders nothing either way.
			const right = again(node['right']);
			if (node['operator'] === '&&') return right;
			return agreed(again(node['left']), right);
		}
		case 'ConditionalExpression':
			return agreed(again(node['consequent']), again(node['alternate']));
		default:
			return null;
	}
}

/** Two value positions naming the same component, or no single candidate. */
function agreed(left: string | null, right: string | null): string | null {
	if (left === null) return right;
	if (right === null) return left;
	return left === right ? left : null;
}

/**
 * Every function the source names, each standing for the one thing a derivation can ask of one.
 *
 * A component and a snippet are both functions and the derivation scope is data: the payload
 * carries no function and the carried bundle drops a component on purpose, so neither name is
 * there to read. What either is worth to a derivation is that it exists, which is what the
 * constructs that consume them ask. See spec/payload.md.
 */
function standsFor(walk: Walk): Map<string, string> {
	const stands = new Map<string, string>();
	for (const [local] of walk.site.carried) {
		if (componentImport(local, walk)) stands.set(local, 'true');
	}
	for (const [named, one] of walk.snippets) {
		if (one.declared) stands.set(named, 'true');
	}
	return stands;
}

/**
 * The one component a `<svelte:component this={...}>` the request decides can render, and the test
 * that says whether it renders it.
 *
 * **The payload carries data and no function**, which is a decision rather than a limit -- see
 * spec/payload.md -- so a component never comes off the wire and the only component `this` can
 * hold is one the source itself names. That closes what read as an open enumeration: the choice
 * has two outcomes, the component the source names and nothing at all, which is an `{#if}` with an
 * empty else. Svelte's server compiles the tag to exactly that shape, `build_inline_component`
 * writing `if (X) { BLOCK_OPEN; X($$renderer, {}); }` against `else { BLOCK_OPEN_ELSE; }`.
 *
 * A request that sends a truthy value that is not a component renders nothing either way: Svelte
 * calls it and throws, and there are no bytes to reproduce. See spec/roadmap.md.
 */
function chosenComponent(expression: unknown, walk: Walk): { name: string; test: string } | null {
	if (!mentions(settled(walk.expand(expression), walk), walk.dynamic)) return null;
	const through = new Set<string>();
	const name = candidateOf(expression, walk, through, (held) => componentImport(held, walk));
	if (name === null) return null;
	// A default this followed to a component is one the derivation scope cannot hold, so it stands
	// there for what a component is worth to a derivation and nothing more: that it exists.
	for (const one of through) walk.site.stood.add(one);
	// The test asks whether the value is something, and every component is: a function is truthy.
	// So each component the expression names stands for `true` in it, which is also what leaves it
	// evaluable -- `gather()` in the carry package drops a component from the bundle on purpose,
	// so the name is not there for a derivation to read.
	return { name, test: settled(walk.expand(expression, standsFor(walk)), walk) };
}

/**
 * Whether a test is decided by the source itself, before anything is rendered or asked.
 *
 * A test the request does not decide is answered by the render: the walk asks, and the pass after
 * it is told. One the substitution has already turned into a constant is not a question at all.
 * `{#if show}` over `let show = $state(false)` is `{#if false}` by the time the walk reads it, and
 * the branch is bytes nobody writes.
 *
 * **Asking the render instead put the walk inside that branch.** Svelte compiles a dead branch and
 * never runs it; this walk goes into every branch whatever `taken` says, which is what makes a
 * block re-materialisable per render -- so the render made to answer the question evaluated what
 * the source never evaluates. `<NonExistent />` under `{#if false}` and `object.boolean` under
 * `{#if object}` over a `$state()` holding nothing both threw there, and the sample was reported
 * as a crash in this compiler. See spec/derivation.md.
 */
function constantly(test: string): boolean | undefined {
	const held = literalOf(test);
	if (held !== undefined) return Boolean(JSON.parse(held) as unknown);
	// `undefined` is an identifier and not a literal, and it is what a rune with no argument holds:
	// `3-transform/server/visitors/VariableDeclaration.js` writes `args[0] ?? void 0` for every
	// rune but the three that fall through to the CallExpression visitor.
	return unwrapped(test) === 'undefined' ? false : undefined;
}

/**
 * Which branch of a chain the answers decide, or null where they do not decide one yet.
 *
 * A chain is tests Svelte evaluates in order until one is true, so it is decided as soon as every
 * test up to and including the first that is not false has an answer: the rest are never reached
 * and their answers cannot change the branch. Requiring all of them was what kept
 * `{#if $foo}blah{:else if bar()}` waiting on a test its own first branch makes unreachable.
 *
 * `-1` for the else, which is the branch number Svelte writes into the marker that opens it.
 */
function reached(answers: readonly (boolean | undefined)[]): number | null {
	const at = answers.findIndex((one) => one !== false);
	if (at === -1) return -1;
	return answers[at] === true ? at : null;
}

/**
 * A block whose branch is known: the tests written out as constants, and only that branch walked.
 *
 * The block stays in the source, so Svelte writes the anchors it would have written either way --
 * what is decided here is which branch is inside them, not whether there is a block.
 */
function oneBranch(
	walk: Walk,
	chain: readonly AstNode[],
	/** Each test as the walk settled it, which is where an `await` shows. See `awaited()`. */
	tests: readonly string[],
	chosen: number,
	otherwise: unknown,
	edits: Edit[],
	step: (child: unknown) => void,
): void {
	for (const [branch, one] of chain.entries()) {
		const at = span(one['test']);
		const held = tests[branch] ?? '';
		if (at !== null) {
			edits.push([at[0], at[1], awaited(held, branch === chosen ? 'true' : 'false')]);
		}
		if (branch !== chosen) buried(walk, one['consequent']);
		// A test after the one that answered is never evaluated: the chain stops at the first true.
		// One before it was evaluated and its names have to resolve, so only the later ones go --
		// `{#if $foo}blah{:else if bar()}` over a store holding `true` is that, and `bar` is a name
		// upstream's own sample never binds.
		if (chosen >= 0 && branch > chosen && at !== null) dies(walk, at);
	}
	if (chosen >= 0) step(chain[chosen]?.['consequent']);
	else if (isNode(otherwise)) step(otherwise);
	if (chosen >= 0) buried(walk, otherwise);
}

/** A fragment nothing renders, recorded by the span its own nodes cover. */
function buried(walk: Walk, fragment: unknown): void {
	if (!isNode(fragment)) return;
	const nodes = Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const spans = nodes.map((one) => span(one)).filter((one) => one !== null);
	const [first] = spans;
	const last = spans[spans.length - 1];
	if (first === undefined || last === undefined) return;
	dies(walk, [first[0], last[1]]);
}

/** One span of this file's source that no request reaches. See `Walk.dead`. */
function dies(walk: Walk, at: [number, number]): void {
	const key = relative(walk.site.root, walk.site.file);
	const held = walk.dead.get(key);
	if (held === undefined) walk.dead.set(key, [at]);
	else held.push(at);
}

function settled(expression: string, walk: Walk): string {
	// Unfolded first, because a choice the source holds the domain of is not written as a `?:` at
	// the top of the expression: a table lookup is a member access, and a read off a ternary is
	// one too. `settle` looks for a ternary and would find neither, so the domain that was in the
	// source goes unseen -- and what is left reaches components in a derivation, which is a value
	// asked for per request and has nowhere to get them. See `unfolded`.
	const held = settle(
		unfolded(expression) ?? expression,
		walk.site.decided,
		walk.dynamic,
		new Set(walk.fresh),
	);
	if (held.undecided === null) return held.text;
	// A name a block binds is decided per item, and a decision over it cannot be enumerated for
	// the page: the derivation the branch would test has no item to read.
	const scoped = new Set(
		[...walk.dynamic].filter(
			(one) => walk.site.payload?.has(one) !== true && !walk.fresh.includes(one),
		),
	);
	if (mentions(held.undecided, scoped)) {
		refuse(
			`\`${held.undecided}\` chooses between things a marker cannot stand for and reads a name ` +
				'an each block binds, so the choice is made per item and cannot be enumerated for the ' +
				'page. Write it as an `{#if}` around the markup, which is a block and is taken per item',
		);
	}
	throw new Undecided(held.undecided);
}

/** The locals a file imports from a runes module, which Svelte compiles and nothing else runs. */
function runesOf(imports: Record<string, string>, file: string): Set<string> {
	const found = new Set<string>();
	for (const [local, from] of Object.entries(imports)) {
		// The file decides, not the specifier: a bundler is asked for `x.svelte` and completes it
		// to `x.svelte.ts`, and `$lib` stands in front of either.
		const target = resolveBare(from, file) ?? from;
		if (/\.svelte\.(?:ts|js)$/.test(target)) found.add(local);
	}
	return found;
}

/**
 * Whether the request decides an expression's value: it reads a name the walk does not hold,
 * and not only inside the arguments of a call into a runes module. Such a call's value on the
 * server is decided inside a render by the library -- a query never runs there and is pending
 * whatever its key -- so the render is asked, the way it is asked about anything the request
 * does not decide. See `onlyWithin`.
 */
/**
 * Records the context keys this file sets from a value the request decides.
 *
 * `setContext(k, v)` runs while the bytes are written and stores `v` where a descendant's
 * `getContext(k)` reads it. Neither name is one the request decides, so an expression reading a
 * context looks inert and is handed to the render -- which has the neutralised value, not the
 * request's. Walked before the file's markup is, so a parent's keys are known by the time a child
 * reads one.
 */
function contextual(ast: AstNode, walk: Walk): void {
	const local = new Set(
		Object.entries(importsOf(walk.source))
			.filter(([, from]) => from === 'svelte')
			.map(([name]) => name),
	);
	const step = (one: unknown): void => {
		if (Array.isArray(one)) {
			for (const each of one) step(each);
			return;
		}
		if (!isNode(one)) return;
		if (one['type'] === 'CallExpression') {
			const callee = one['callee'];
			const name = isNode(callee) && typeof callee['name'] === 'string' ? callee['name'] : '';
			if (name === 'setContext' && local.has(name)) {
				const args = Array.isArray(one['arguments']) ? one['arguments'] : [];
				const [key, value] = args;
				let written = '';
				try {
					written = value === undefined ? '' : walk.expand(value);
				} catch {
					written = '';
				}
				if (written !== '' && varies(written, walk)) {
					const literal =
						isNode(key) && key['type'] === 'Literal' && typeof key['value'] === 'string'
							? key['value']
							: null;
					walk.site.contexts.add(literal ?? '*');
				}
			}
		}
		for (const value of Object.values(one)) step(value);
	};
	for (const block of [ast['module'], ast['instance']]) {
		if (!isNode(block)) continue;
		const content = block['content'];
		if (isNode(content)) step(content['body']);
	}
}

/**
 * The names a module exports that something in it changes, by module path.
 *
 * **The render's module instances are not the artifact's.** An expression the walk judges inert is
 * handed back for Svelte to evaluate in the render, which imports the module afresh; a derivation
 * evaluates in the carried bundle, which imported it once. Where the module holds no state the two
 * agree, which is what makes handing an inert `cn(...)` to the render right. Where it does, they
 * are two states:
 *
 * ```js
 * export const seen = [];
 * export function mark(x) { seen.push(x); return seen.length; }
 * ```
 *
 * `{mark(n)}` is a marker and runs in the bundle; `{seen.length}` looked inert and ran in the
 * render, where `mark` was a marker and never ran. Measured: `1:0`, `2:0` against Svelte's `1:1`,
 * `2:2`.
 *
 * Refused rather than moved. A derivation is a pure expression computed once per request and held,
 * and `seen.length` is neither pure nor once: read per item it would give `1:1`, `2:1` where
 * Svelte gives `1:1`, `2:2`, so there is no place in this pipeline that is right.
 *
 * Only a relative module, whose source this can read. A package's is a hole, named in
 * spec/roadmap.md.
 */
const CHANGED = new Map<string, ReadonlySet<string>>();

function changedBy(file: string): ReadonlySet<string> {
	const held = CHANGED.get(file);
	if (held !== undefined) return held;
	const found = new Set<string>();
	CHANGED.set(file, found);
	let source: string;
	try {
		source = readFileSync(file, 'utf8');
	} catch {
		return found;
	}
	let ast: AstNode;
	try {
		// A component's `<script module>` is module state too, reached by a named import of the
		// component. Its source is already markup, so it is parsed as what it is rather than
		// wrapped; everything else is a module and is wrapped to be read the same way.
		ast = parse(file.endsWith('.svelte') ? source : `<script module lang="ts">${source}</script>`, {
			modern: true,
		}) as unknown as AstNode;
	} catch {
		return found;
	}
	const block = ast['module'];
	const content = isNode(block) ? block['content'] : undefined;
	if (!isNode(content) || !Array.isArray(content['body'])) return found;
	const declared = new Set<string>();
	for (const statement of content['body']) {
		const one =
			isNode(statement) && statement['type'] === 'ExportNamedDeclaration'
				? statement['declaration']
				: statement;
		if (!isNode(one) || one['type'] !== 'VariableDeclaration') continue;
		for (const each of Array.isArray(one['declarations']) ? one['declarations'] : []) {
			if (isNode(each)) namesIn(each['id'], declared);
		}
	}
	// Every assignment, update and method call in the file, wherever it is written: a module's
	// functions are called from the artifact, so a mutation inside one of them happens.
	const rootOf = (target: unknown): string | null => {
		let at = target;
		while (isNode(at) && at['type'] === 'MemberExpression') at = at['object'];
		return isNode(at) && at['type'] === 'Identifier' && typeof at['name'] === 'string'
			? at['name']
			: null;
	};
	const hit = (target: unknown): void => {
		const name = rootOf(target);
		if (name !== null && declared.has(name)) found.add(name);
	};
	const step = (one: unknown): void => {
		if (Array.isArray(one)) {
			for (const each of one) step(each);
			return;
		}
		if (!isNode(one)) return;
		if (one['type'] === 'AssignmentExpression') hit(one['left']);
		if (one['type'] === 'UpdateExpression') hit(one['argument']);
		if (one['type'] === 'CallExpression') {
			const callee = one['callee'];
			if (isNode(callee) && callee['type'] === 'MemberExpression') hit(callee['object']);
		}
		for (const value of Object.values(one)) step(value);
	};
	step(content['body']);
	return found;
}

/** The local names this file imports that the module they come from changes. */
function unstable(walk: Walk): ReadonlySet<string> {
	const found = new Set<string>();
	for (const [local, one] of walk.site.carried) {
		if (!one.from.startsWith('.')) continue;
		// Only the default import of a component is the component; a named one is its module
		// script, whose state changes the same way any module's does.
		if (one.from.endsWith('.svelte') && one.kind === 'default') continue;
		const at = resolvePath(dirname(walk.site.file), one.from);
		const exported = one.kind === 'named' ? (one.exported ?? one.local) : null;
		if (exported === null) continue;
		if (changedBy(at).has(exported)) found.add(local);
	}
	return found;
}

/** Whether an expression reads a context, which is a channel this walk does not follow. */
const READS_CONTEXT = /\bget(?:All)?Contexts?\b/;

/**
 * A read of one of the names the server holds and the build has not, by the word.
 *
 * Not a member of something else: `a.process` is somebody's own property, and `$process` is a
 * store. The shape is `carries()`'s, which asks the same kind of question of Svelte's helpers.
 */
const SERVER_HELD = new RegExp(`(?:^|[^$\\w.])(?:${[...AT_REQUEST].join('|')})\\b`);

function varies(
	expression: string,
	walk: Walk,
	/**
	 * Set where the render is given the author's own source rather than this expansion.
	 *
	 * A test the render answers is written into the script by `asWritten`, which is the source as
	 * the author wrote it -- so `$foo` over a store this file makes is a question the render can
	 * answer, where the expansion naming `$$get` is not something it could be handed. The
	 * derivation still holds the expansion, and the carried bundle has those helpers in it.
	 */
	written = false,
): boolean {
	// One of Svelte's own functions this compiler carries is not a name the render can be handed:
	// Svelte's compiler refuses a `$`-prefixed variable in markup outright. See `carries()`.
	if (!written && carries(expression)) return outside(expression);
	// A name the server holds and the build has not -- `process.env`. Svelte reads it inside
	// `render()`, once per request, and a derivation is read once per request too, so the two
	// agree. Handed to the compile-time render instead it would read the build machine's value and
	// write that into the bytes, which is the one answer neither of them gives.
	//
	// Tested by the word rather than through `unknown()`, which is what `carries` does and for the
	// same reason: `mentions` reports an expression it cannot parse as mentioning everything, so a
	// set that is never empty made every unreadable expression vary. A class field written
	// `$derived(...)` is one of those, and it took a sample that has nothing to do with the
	// environment. See `AT_REQUEST`.
	if (SERVER_HELD.test(expression)) return outside(expression);
	// A subscription to a store the request brings. Asked here rather than only where a value is
	// handed to a component the walk could not enter: `{#if $condition}` over a prop declared
	// `writable(true)` is the same unknowable and reached the evaluator as a bare `$condition`.
	subscribing(expression, walk);
	// A context read where something in this walk set one from a value the request decides. Neither
	// `getContext` nor the key is a name the request decides, so this would be handed to the render
	// -- which holds the neutralised value the `setContext` was given there. Refused rather than
	// made a marker: a derivation is evaluated outside `render()`, where there is no context to
	// read. See `Site.contexts`.
	// A module binding something in that module changes. The render imports the module afresh and
	// the carried bundle imported it once, so an inert read is answered by the wrong one of the two
	// -- and there is no place in this pipeline that is right, a derivation being pure and held.
	// See `changedBy()`.
	const moving = unstable(walk);
	if (moving.size > 0 && mentions(expression, moving)) {
		refuse(
			`a module binding something in that module changes -- ${[...moving]
				.map((one) => `\`${one}\``)
				.join(', ')} -- read where the value has to be written into the bytes. The render ` +
				'imports the module again and the artifact imported it once, so the two hold different ' +
				'states, and a derivation is a pure expression computed once. Read it in the load ' +
				'stage and put the value in the data. See spec/refusals.md',
		);
	}
	if (walk.site.contexts.size > 0 && READS_CONTEXT.test(expression)) {
		refuse(
			'a context read where a `setContext` in this render was given a value the request ' +
				'decides. The value reaches the reader through a channel this compiler does not ' +
				'follow, and evaluating the read outside `render()` has no context to read from. ' +
				'Hand the value down as a prop. See spec/refusals.md',
		);
	}
	const names = unknown(walk);
	if (!mentions(expression, names)) return false;
	const varying = !onlyWithin(expression, names, walk.site.runes);
	if (!varying) return false;
	return outside(expression);
}

/** The node types that hold a body the expression may or may not call. */
const FUNCTIONS: ReadonlySet<string> = new Set([
	'FunctionDeclaration',
	'FunctionExpression',
	'ArrowFunctionExpression',
]);

/**
 * The first name an expression assigns to and does not itself declare, or null where there is none.
 *
 * Declarations are collected from the whole expression rather than per scope: a name declared in
 * one function and assigned in another is a shape nothing here writes, and reading the scopes
 * exactly would refuse more than the question asks. Loose in the direction of not refusing, which
 * is the safe one here -- what is missed is a derivation that throws at request time and says so,
 * not a byte written wrongly and silently.
 */
function assigns(expression: string): string | null {
	let ast: unknown;
	try {
		ast = parsed(expression);
	} catch {
		return null;
	}
	const bound = new Set<string>();
	const targets: string[] = [];
	// A bare name only. `counter.count += 1` over an imported `counter` writes into the module the
	// carried bundle holds, which is a module the derivation has: it is the rule about a module
	// binding something in that module changes, and `changedBy()` owns it. What cannot work at all
	// is a bare name nothing binds, since `reads()` never substituted it and nothing declares it.
	const root = (node: unknown): string | null =>
		isNode(node) && node['type'] === 'Identifier' && typeof node['name'] === 'string'
			? node['name']
			: null;
	// Only where the assignment can run while the expression is evaluated. A function the
	// expression holds rather than calls writes nothing: `handleClick={() => clicked = letter}` is
	// a handler handed to a component and the server calls nothing, which is the same reading
	// `losing()` makes of a name the markup only names inside a function. A function called where
	// it is written is the other case, and it is the one this is here for -- an arrow invoked at
	// once, and a generator invoked and then drained by `to_array`.
	/** What a function binds, whether or not this expression ever runs its body. */
	const binds = (node: AstNode): void => {
		if (isNode(node['id']) && typeof node['id']['name'] === 'string') bound.add(node['id']['name']);
		for (const one of Array.isArray(node['params']) ? node['params'] : []) namesIn(one, bound);
	};
	/** Walks what the expression evaluates, and nothing it only holds. */
	const step = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const one of node) step(one);
			return;
		}
		if (!isNode(node)) return;
		const type = String(node['type']);
		if (type === 'VariableDeclarator') namesIn(node['id'], bound);
		// A function this expression holds rather than calls writes nothing while the bytes are
		// written: `handleClick={() => clicked = letter}` is a handler handed to a component and the
		// server calls nothing. It is read for what it binds and no further, which is the same
		// reading `losing()` makes of a name the markup only names inside a function.
		if (FUNCTIONS.has(type)) {
			binds(node);
			return;
		}
		if (type === 'AssignmentExpression') {
			const name = root(node['left']);
			if (name !== null) targets.push(name);
		}
		if (type === 'UpdateExpression') {
			const name = root(node['argument']);
			if (name !== null) targets.push(name);
		}
		// A function written where it is called does run: an arrow invoked at once, and a generator
		// invoked and then drained by `to_array`.
		if (type === 'CallExpression') {
			const callee = node['callee'];
			if (isNode(callee) && FUNCTIONS.has(String(callee['type']))) {
				binds(callee);
				step(callee['body']);
			} else {
				step(callee);
			}
			step(node['arguments']);
			return;
		}
		for (const value of Object.values(node)) step(value);
	};
	step(ast);
	return targets.find((one) => !bound.has(one)) ?? null;
}

/**
 * What cannot survive being a derivation, asked wherever one is about to be made.
 *
 * A marker means a derivation, and a derivation is an expression evaluated outside `render()`. Two
 * things cannot make that trip, and both were reaching the evaluator and throwing there rather than
 * naming a file here. Asked at every answer `varies()` gives rather than at its last one: an
 * expansion naming one of Svelte's own helpers is a derivation before anything asks which names it
 * reads, and a context read wrapped in `$$get_store` went out that way and threw
 * `lifecycle_outside_component` at injection.
 *
 * Returns true, so it reads as the answer it guards.
 */
export function outside(
	expression: string,
	/**
	 * Set where the expression is one the artifact holds rather than one the walk is considering.
	 *
	 * `varies()` asks this of markup the walk may still fold away -- an `{#await}`'s `then` branch
	 * is walked and then not rendered, since the server writes the pending branch for a promise --
	 * and a refusal about markup nothing renders is a refusal about nothing. The two questions
	 * below hold whenever an expression is written out at all; the third is asked only of what is
	 * left at the end.
	 */
	written = false,
	/** The names substitution could not follow, with why. See `Site.changing`. */
	changing: ReadonlyMap<string, string> = new Map(),
): boolean {
	// A name substitution could not follow, left as the author wrote it and now inside an
	// expression this compiler has to write itself. The render would have evaluated it against the
	// value the script left; nothing evaluates a derivation against that, so this is where the rule
	// about a value the render changes refuses, rather than at the declaration.
	if (changing.size > 0) {
		for (const name of readsOf([expression])) {
			// `$x` is a subscription to `x`, so it is a read of `x` and stands or falls with it.
			const why =
				changing.get(name) ?? (name.startsWith('$') ? changing.get(name.slice(1)) : undefined);
			if (why !== undefined) refuse(why);
		}
	}
	// An assignment to a name the expression does not itself declare. A derivation is a pure
	// expression evaluated once per request and outside the script, so the name it writes to is
	// bound nowhere and no other read can see what it wrote. `reads()` never visits an assignment
	// target -- `(0) = 1` is not JavaScript -- so such a name is never substituted and never
	// reported as read either, and it went out as a free name: `let [one, two] = $state(test())`
	// over a generator whose body is `yield count++` reached the evaluator as `count is not
	// defined`, which names nothing an author wrote.
	const changed = written ? assigns(expression) : null;
	if (changed !== null) {
		refuse(
			`\`${changed}\` is assigned inside a value this compiler has to write itself. A derivation ` +
				'is a pure expression evaluated once per request and outside the script, so a name it ' +
				'assigns to is bound nowhere and nothing else can see what it wrote. Compute the value ' +
				'in one expression, or move what changes it out of the render. See spec/derivation.md',
		);
	}
	// A context read: `getContext` and `getAllContexts` ask the component being rendered, and there
	// is none. Handed to the render it is fine, which is the branch above.
	if (READS_CONTEXT.test(expression)) {
		refuse(
			'a context read in a value this compiler has to write itself. `getContext` asks the ' +
				'component being rendered and a derivation is evaluated outside one, so the read has ' +
				'nowhere to come from. Hand the value down as a prop, or write the read where the ' +
				'render can evaluate it. See spec/refusals.md',
		);
	}
	// A rune: `$state`, `$derived` and the rest are compiled away by Svelte and exist nowhere at
	// run time. One left in an expression -- a class field written `$state.raw([])`, which is not a
	// declaration this pass reads -- reached the evaluator as `$state is not defined`.
	const rune = RUNE.exec(expression);
	if (rune !== null) {
		refuse(
			`\`${rune[0].trim()}\` is left in a value this compiler has to write itself. A rune is ` +
				'compiled away by Svelte and is not a function anything can call, so a derivation ' +
				'reading one has nothing to call. See spec/refusals.md',
		);
	}
	return true;
}

/**
 * The name an expression settles to, where it settles to one.
 *
 * `settle` decides a path whose value the build fixed; this is the arithmetic left after it, and it
 * is only ever asked of a `{@render}`'s callee. Two shapes reach a snippet through a value:
 * `{@render (show ? foo : bar)()}`, where the test has already become a literal, and
 * `{@render state.value()}` over `$state({ value: counter })`, where the object literal is what
 * substitution left. Both are folded here rather than in `settle`, which is about the request
 * deciding a path and not about reducing an expression.
 */
/**
 * A prop bound to a reference into the walk's held list, or null where it is bound to its value.
 *
 * A value that **makes** something and reaches the tag as a read of a name is held at the call
 * site, which is where its identity belongs: the caller has one value and hands the child that
 * one, so two reads inside the child must not build two. `items.includes(item)` asked a second
 * array whether it held the first one's element, and the answer was `false` where Svelte writes
 * `true`.
 *
 * Only a read of a name. An expression written at the tag -- `options={{ a: 1 }}` -- makes its
 * value there, and there is no earlier value for the child's reads to be the same as. Already
 * held is left alone: a caller's own prop arrives holding a reference, and holding it again would
 * name the reference rather than the value.
 */
function holding(
	prop: string,
	given: string | undefined,
	byName: ReadonlySet<string>,
	walk: Walk,
): string | null {
	if (given === undefined || !byName.has(prop) || given.includes('$$hold(')) return null;
	if (!makes(given)) return null;
	return `$$hold(${String(kept(given, walk))})`;
}

/**
 * Whether an expression makes something, so that two evaluations are two values.
 *
 * An object or array literal, a `new`, or a call. A member read, a name, arithmetic or a literal is
 * not one: two evaluations of those are the same value, so substitution is exact and stays exact.
 * The same reading as `holding` in locals.ts, asked of a call site's text rather than of a
 * declaration's initialiser. See spec/derivation.md.
 */
function makes(text: string | undefined): boolean {
	if (text === undefined) return false;
	let ast: Node;
	try {
		ast = parsed(text) as unknown as Node;
	} catch {
		return false;
	}
	const fragment = (ast as unknown as AstNode)['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const [only] = nodes;
	if (nodes.length !== 1 || !isNode(only) || only['type'] !== 'ExpressionTag') return false;
	let held: unknown = only['expression'];
	while (isNode(held) && held['type'] === 'ParenthesizedExpression') held = held['expression'];
	const kind = isNode(held) ? held['type'] : undefined;
	return (
		kind === 'ObjectExpression' ||
		kind === 'ArrayExpression' ||
		kind === 'NewExpression' ||
		kind === 'CallExpression'
	);
}

/**
 * The index a held expression has in this walk's list, under the chain of the file holding it.
 *
 * The chain is the caller's, not the child's: the value is the caller's to evaluate, and a hole
 * recorded under the child would resolve its names through a file that does not declare them.
 */
function kept(expression: string, walk: Walk): number {
	const files = walk.site.stack.toReversed().map((one) => relative(walk.site.root, one));
	const key = files.join('\u0000');
	const at = walk.keeping.findIndex(
		(one) => one.expression === expression && (one.files ?? []).join('\u0000') === key,
	);
	if (at >= 0) return at;
	walk.keeping.push({ expression, files });
	return walk.keeping.length - 1;
}

function reaches(text: string): string | null {
	let ast: Node;
	try {
		ast = parsed(text) as unknown as Node;
	} catch {
		return null;
	}
	const fragment = (ast as unknown as AstNode)['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const [only] = nodes;
	if (!isNode(only) || only['type'] !== 'ExpressionTag') return null;
	const held = folded(only['expression']);
	if (!isNode(held) || held['type'] !== 'Identifier') return null;
	return typeof held['name'] === 'string' ? held['name'] : null;
}

/** The node an expression reduces to: a taken branch, a read off an object literal, or itself. */
function folded(node: unknown): unknown {
	if (!isNode(node)) return null;
	const type = node['type'];
	if (type === 'ConditionalExpression') {
		const test = node['test'];
		if (!isNode(test) || test['type'] !== 'Literal') return null;
		return folded(node[test['value'] === true || test['value'] ? 'consequent' : 'alternate']);
	}
	if (type !== 'MemberExpression') return node;
	const object = folded(node['object']);
	if (!isNode(object) || object['type'] !== 'ObjectExpression') return null;
	const property = node['property'];
	const wanted = !isNode(property)
		? null
		: node['computed'] === true
			? property['type'] === 'Literal'
				? String(property['value'])
				: null
			: typeof property['name'] === 'string'
				? property['name']
				: null;
	if (wanted === null) return null;
	for (const each of Array.isArray(object['properties']) ? object['properties'] : []) {
		if (!isNode(each) || each['type'] !== 'Property' || each['computed'] === true) continue;
		const key = each['key'];
		if (!isNode(key)) continue;
		const named =
			key['type'] === 'Literal'
				? String(key['value'])
				: typeof key['name'] === 'string'
					? key['name']
					: null;
		if (named === wanted) return folded(each['value']);
	}
	return null;
}

/** The runes, which exist at compile time and nowhere else. */
const RUNE = /(?:^|[^\w$.])\$(?:state|derived|props|effect|bindable|inspect|host)\b/;

/**
 * The names an expression may read whose value this walk does not hold: what the request
 * decides, and what a component supplies to a snippet it was passed, which is decided by the
 * component. Neither can be written out for the render to evaluate.
 */
function unknown(walk: Walk): ReadonlySet<string> {
	// `$x` reads the store `x`, so a subscription to one the request brings is one of these: what
	// `store_get` is handed decides the value, and this walk does not hold it. Without the pair the
	// read looked like a name of its own that nothing decided, so it was written out for the render
	// -- which has no store there and wrote nothing. See `stands`, which refuses it.
	const subscribed = [...walk.dynamic].map((one) => `$${one}`);
	if (walk.handed === undefined || walk.handed.size === 0) {
		return new Set([...walk.dynamic, ...subscribed]);
	}
	return new Set([...walk.dynamic, ...subscribed, ...walk.handed]);
}

/**
 * Whether every `{#snippet}` this component declares holds a body the render can write on its own.
 *
 * A `{@render}` whose callee cannot be followed is left to the render, which then calls whichever
 * snippet the value holds and writes that body's bytes. A body is walked where a render tag names
 * it and nowhere else, so one left to the render is one this pass never rewrote: `{#snippet
 * one()}<b>{data.a}</b>{/snippet}` reached Svelte's own renderer as written and read `.a` of the
 * nothing a render is given.
 *
 * **Which snippet the render will call is the question that could not be answered, so the answer
 * covers all of them.** That is Svelte's own model of a site it cannot resolve:
 * `2-analyze/visitors/RenderTag.js` writes `node.metadata.snippets = analysis.snippets` for one,
 * linking it to every snippet in the component.
 *
 * Every identifier in a body counts, one a parameter or a `{@const}` shadows included. Refusing
 * where the walk could have gone in costs a compile that names a file; the other direction costs
 * bytes nobody asked for.
 */
function inertBodies(snippets: ReadonlyMap<string, Snippet>, walk: Walk): boolean {
	const names = unknown(walk);
	if (names.size === 0) return true;
	let found = false;
	const seek = (node: unknown): void => {
		if (found) return;
		if (Array.isArray(node)) {
			for (const one of node) seek(one);
			return;
		}
		if (!isNode(node)) return;
		if (node['type'] === 'Identifier' && typeof node['name'] === 'string') {
			if (names.has(node['name'])) found = true;
			return;
		}
		for (const one of Object.values(node)) seek(one);
	};
	for (const one of snippets.values()) {
		if (!one.declared || one.node === undefined) continue;
		seek(one.node['body']);
		if (found) return false;
	}
	return true;
}

/**
 * What has to hold for the markup at this point in the walk to render at all, as one expression.
 *
 * `IfBlock.js` emits one `if`/`else if`/`else` over `metadata.flattened`, so a branch renders
 * exactly where its own test is true and every test before it was false, and the else where all of
 * them were false. Nested blocks are the conjunction of their branches.
 *
 * **An `{#each}` is not one of these and returns nothing.** What it encloses renders once per item,
 * so what a binding inside it settles is a per-item answer, and the name it settles is read once
 * for the page.
 */
function branchTest(walk: Walk): string | null {
	const parts: string[] = [];
	for (const [index, branch] of walk.within) {
		const block = walk.blocks[index];
		if (block === undefined || block.kind !== 'if') return null;
		const tests = walk.site.tested.get(index) ?? block.tests ?? [];
		for (const one of branch === -1 ? tests : tests.slice(0, Math.max(branch, 0))) {
			parts.push(`!(${one})`);
		}
		if (branch >= 0) {
			const own = tests[branch];
			if (own === undefined) return null;
			parts.push(`(${own})`);
		}
	}
	return parts.length === 0 ? 'true' : parts.join(' && ');
}

/**
 * Appends a statement per test to the end of the instance script that reports the test's value
 * to the render's caller, so that a decision the request does not make is made once. At the end
 * rather than the top, because a declaration below is not yet in scope at the top.
 *
 * **And labelled `$:` in legacy mode, because the end of the script is not the end of the body.**
 * `transform-server.js` pushes every `$:` statement onto the instance body after it has visited
 * everything else, so a statement written below one in the source runs above it in the output --
 * and `$: items = [...]` left `items` undefined where the ask read it. Labelled, the ask is a
 * reactive statement too, and `analysis.reactive_statements` keeps them in dependency order.
 */
function withAsks(
	ast: AstNode,
	asks: readonly [key: string, code: string][],
	wants: readonly [key: string, code: string][],
	edits: [number, number, string][],
): void {
	if (asks.length === 0 && wants.length === 0) return;
	// Only where the script writes one, which is the only thing that moves: a file with no `$:` has
	// nothing appended after the ask, and a file that has one is legacy by construction, since
	// `2-analyze/index.js` refuses the label in runes mode. Asking `legacyMode` instead disagreed
	// with Svelte over a file whose only rune is in its markup, and wrote a `$:` into a runes file.
	const after = reactive(ast) ? '$: ' : '';
	// Opened with a semicolon: the statement above may end without one, and a line starting
	// with `(` would continue it as a call.
	const lines = [
		...asks.map(
			([key, code]) =>
				`;${after}(globalThis.__seam_asked ??= {})[${JSON.stringify(key)}] = Boolean(${code});`,
		),
		// A value is answered only where it is data: a string, a number, a boolean, null, and
		// arrays and plain objects of those. A `URL` or a `Date` would round-trip as a string and
		// come back a different thing, so it is not answered and the expression stays.
		...wants.map(
			([key, code]) =>
				`;${after}(globalThis.__seam_asked ??= {})[${JSON.stringify(key)}] = ((v) => { const ok = (x) => ` +
				`x === null || ['string', 'number', 'boolean'].includes(typeof x) || (Array.isArray(x) ` +
				`? x.every(ok) : typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype ` +
				`&& Object.values(x).every(ok)); return ok(v) ? JSON.stringify(v) : undefined; })(${code});`,
		),
	];
	appended(ast, lines, edits);
}

/** Whether the instance script writes a `$:` statement, which the server transform moves. */
function reactive(ast: AstNode): boolean {
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	return body.some(
		(one) =>
			isNode(one) &&
			one['type'] === 'LabeledStatement' &&
			isNode(one['label']) &&
			one['label']['name'] === '$',
	);
}

/** Statements added at the end of the instance script, or in one made for them. */
function appended(ast: AstNode, lines: readonly string[], edits: [number, number, string][]): void {
	if (lines.length === 0) return;
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const at = isNode(content) ? content['end'] : undefined;
	if (typeof at === 'number') {
		edits.push([at, at, `\n${lines.join('\n')}\n`]);
		return;
	}
	edits.push([0, 0, `<script>\n${lines.join('\n')}\n</script>\n`]);
}

/**
 * The binding the runtime makes for a `$props.id()`, declared in the render too: the render is
 * handed the hole's marker as the id, so an expression written in terms of the binding evaluates
 * there to the marker, and one the request decides reads the binding at request time.
 */
function withFresh(
	ast: AstNode,
	fresh: string | null,
	ids: ReadonlySet<string>,
	edits: [number, number, string][],
): void {
	const [name] = ids;
	if (fresh === null || name === undefined) return;
	appended(ast, [`;const ${fresh} = ${name};`], edits);
}

/** An import written again, in the form it was written in: named, default, or the module. */
function restated(one: Carried): string {
	const from = JSON.stringify(one.from);
	if (one.kind === 'namespace') return `import * as ${one.local} from ${from};`;
	if (one.kind === 'default') return `import ${one.local} from ${from};`;
	const exported = one.exported ?? one.local;
	return exported === one.local
		? `import { ${one.local} } from ${from};`
		: `import { ${exported} as ${one.local} } from ${from};`;
}

/** Whether a node is a `{#snippet}` declared under the given name. */
function snippetNamed(child: unknown, name: string): child is AstNode {
	if (!isNode(child) || child['type'] !== 'SnippetBlock') return false;
	const id = child['expression'];
	return isNode(id) && id['name'] === name;
}

/**
 * What the render is given for an expression the request does not decide: the author's own
 * text where nothing the walk bound is in it, and the expansion otherwise. See `Walk.plain`.
 */
function asWritten(node: unknown, written: string, walk: Walk): string {
	const at = span(node);
	if (at === null) return written;
	const plain = walk.plain(node);
	if (plain === written) return walk.source.slice(at[0], at[1]);
	// The expansion reaches the request only inside a call into a runes module, whose value the
	// library decides without the argument's value -- a query is pending on the server whatever
	// its key. What the render evaluates is then the expression in this file's own names, which
	// the copy has in scope; the expansion names the caller's, which it does not.
	if (mentions(written, unknown(walk))) return plain;
	// The expansion goes into the render's own source, so a name substitution could not follow has
	// gone with it: `{#snippet item(id = default_arg())}` written out at each read of `id` had the
	// render call `default_arg` nine times where Svelte calls it twice. The same question the
	// finished expressions are asked, at the other place an expansion is written out.
	for (const name of readsOf([written])) {
		const why =
			walk.site.changing.get(name) ??
			(name.startsWith('$') ? walk.site.changing.get(name.slice(1)) : undefined);
		if (why !== undefined) refuse(why);
	}
	return written;
}

/**
 * The getter half of a `bind:`, as source text: what the child is handed for the prop.
 *
 * `shared/component.js` writes `get x() { return <expression> }`, and for the two-function form
 * `bind:x={(get, set)}` the getter is called, which is what `element.js` writes there too.
 */
function getterOf(node: AstNode, source: string): unknown {
	const expression = node['expression'];
	if (!isNode(expression) || expression['type'] !== 'SequenceExpression') return expression;
	const [getter] = Array.isArray(expression['expressions']) ? expression['expressions'] : [];
	const at = span(getter);
	return at === null
		? expression
		: { type: 'Identifier', name: `(${source.slice(at[0], at[1])})()`, start: at[0], end: at[1] };
}

/**
 * Text put inside a template literal, escaped the way `sanitize_template_string` escapes it.
 *
 * A backslash, a backtick and the two characters that open an interpolation are the whole of it:
 * everything else, newlines included, is written as it stands.
 */
function templated(text: string): string {
	return text.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
}

/**
 * The names a component exports readonly: `export const`, `export function`, `export class`.
 *
 * Not props -- a caller cannot pass one -- but `analysis.exports` puts them in the object
 * `$.bind_props` is given, so a caller that binds one gets the child's value back. See `descend`.
 */
/**
 * A readonly export's name and the source of what it holds, which is what `bind_props` sends up.
 *
 * `analysis.exports` carries the pair and `transform-server.js` puts `b.init(alias ?? name, id)`
 * into the object, so the value is the declaration's own initialiser read in the child's scope.
 */
function exportedValues(ast: AstNode, source: string): [string, string][] {
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	const held = new Map<string, string>();
	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'VariableDeclaration') continue;
		for (const one of Array.isArray(statement['declarations']) ? statement['declarations'] : []) {
			if (!isNode(one)) continue;
			const id = one['id'];
			const at = span(one['init']);
			if (!isNode(id) || typeof id['name'] !== 'string' || at === null) continue;
			held.set(id['name'], source.slice(at[0], at[1]));
		}
	}
	return exportedBy(ast).map((name) => [name, held.get(name) ?? exportedInit(ast, source, name)]);
}

/** The initialiser of an `export const x = 1`, whose declaration carries the export keyword. */
function exportedInit(ast: AstNode, source: string, want: string): string {
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'ExportNamedDeclaration') continue;
		const declaration = statement['declaration'];
		if (!isNode(declaration) || declaration['type'] !== 'VariableDeclaration') continue;
		for (const one of Array.isArray(declaration['declarations'])
			? declaration['declarations']
			: []) {
			if (!isNode(one)) continue;
			const id = one['id'];
			const at = span(one['init']);
			if (!isNode(id) || id['name'] !== want || at === null) continue;
			return source.slice(at[0], at[1]);
		}
	}
	return 'undefined';
}

function exportedBy(ast: AstNode): string[] {
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	const found: string[] = [];
	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'ExportNamedDeclaration') continue;
		const declaration = statement['declaration'];
		// `export let` and `export { a }` over a `let` are **props**, not readonly exports, and
		// `propsOf` has them. Only `const`, `function` and `class` are readonly, which is what
		// `bind_props` receives from `analysis.exports` beside the bindable props rather than as
		// one of them.
		if (!isNode(declaration)) continue;
		const kind = declaration['kind'];
		if (declaration['type'] === 'VariableDeclaration' && (kind === 'let' || kind === 'var')) {
			continue;
		}
		const id = declaration['id'];
		if (isNode(id) && typeof id['name'] === 'string') {
			found.push(id['name']);
			continue;
		}
		for (const one of Array.isArray(declaration['declarations'])
			? declaration['declarations']
			: []) {
			const held = isNode(one) ? one['id'] : undefined;
			if (isNode(held) && typeof held['name'] === 'string') found.push(held['name']);
		}
	}
	return found;
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
/** A literal attribute's text, or null where it is absent or not written as text. */
function attributeText(node: AstNode, name: string): string | null {
	for (const one of Array.isArray(node['attributes']) ? node['attributes'] : []) {
		if (!isNode(one) || one['type'] !== 'Attribute' || one['name'] !== name) continue;
		const parts = Array.isArray(one['value']) ? one['value'] : [one['value']];
		const [only] = parts;
		if (isNode(only) && only['type'] === 'Text' && typeof only['data'] === 'string') {
			return only['data'];
		}
	}
	return null;
}

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
/**
 * Refuses a subscription to a store the request brings.
 *
 * `$x` is `store_get($$store_subs ??= {}, '$x', x)` and reads whatever `x` holds while the bytes
 * are written, so the store itself has to be there -- and a store is an object with a `subscribe`
 * function, which is not something a payload can carry: devalue serialises data. Handed a marker
 * instead, `store_get` reads nothing, and the derivation that stood for it failed at injection
 * rather than at build. Where `x` is the component's own the read decides nothing per request, and
 * the render evaluates Svelte's own call. See spec/derivation.md.
 */
function subscribing(expression: string, walk: Walk): void {
	// A `$name` has to be written for there to be one. `mentions` answers "yes" for anything it
	// cannot parse, which is the safe answer where it decides whether a value is a marker and the
	// wrong one here: a class built from a spread is unreadable to it and holds no subscription.
	if (!/(?:^|[^\w$])\$[A-Za-z_]/.test(expression)) return;
	const subscribed = new Set([...walk.dynamic].map((one) => `$${one}`));
	if (subscribed.size === 0 || !mentions(expression, subscribed)) return;
	refuse(
		'a `$store` subscription over a value the request brings is not handled: a store is an ' +
			'object with a `subscribe` function and the payload carries data. Read the value in the ' +
			'load stage and put that in the data. See spec/derivation.md',
	);
}

function stands(expression: string, walk: Walk): string {
	subscribing(expression, walk);
	const held = settle(expression, walk.site.decided, walk.dynamic, new Set(walk.fresh));
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
	if (walk.site.payload !== null && !carries(text) && !mentions(text, walk.dynamic)) return text;
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
	// The shared, memoised parse in `ast`: the same wrapper, and read here rather than written.
	const ast = parsed(expression) as unknown as AstNode;
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
/**
 * Where a block's stamp goes: in front of the text that follows it, or right after the block.
 *
 * A stamp is text, and prefixing the author's text node changes what Svelte does with that node's
 * leading whitespace -- `clean_nodes` collapses whitespace between a block and a text node to one
 * space, and keeps whitespace *inside* a text node as written, so a stamp at the block turned
 * ` tail` into `\n\ttail`. Written in front of the first character the author wrote, the leading
 * whitespace is still leading and the node is the one Svelte would have had.
 *
 * Nothing to stand in front of -- what follows is an element, a block, one of the other tags, or
 * the end -- and the stamp goes at the block, where it is the whole of a node of its own. Measured
 * against Svelte for text, an element, a block and the end of a fragment, in both namespaces.
 *
 * **An `{expression}` counts as text here, and it was the one shape not measured.** `clean_nodes`
 * asks `next?.type !== 'ExpressionTag'` before collapsing a text node's *trailing* whitespace, so
 * an expression tag holds the whitespace in front of it as written where a block or an element
 * collapses it to one space. A stamp written at the block turned that node from whitespace into
 * `stamp` plus whitespace: no longer leading, so nothing collapsed, and `{/each}\n\n{value}` kept
 * both newlines where Svelte writes one space. In front of the tag the whitespace is leading
 * again, and it collapses the way it would have.
 */
function stamping(source: string, end: number): number {
	let at = end;
	while (at < source.length && /\s/.test(source[at] ?? '')) at += 1;
	const next = source[at];
	if (next === undefined || next === '<') return end;
	// `{` opens a tag or a block, and only `{expression}` is the one `clean_nodes` treats as text:
	// `#` and `:` and `/` are a block, `@` is `{@html}`, `{@render}` or `{@const}`, and none of
	// those is an `ExpressionTag`.
	if (next === '{') return '#:/@'.includes(source[at + 1] ?? '') ? end : at;
	return at;
}

/**
 * The stamp for a block, written where `stamping` puts it, refused where writing one would change
 * the bytes.
 */
function stamped(
	walk: Walk,
	index: number,
	source: string,
	end: number,
	close = '',
): [number, number, string] {
	const at = stamping(source, end);
	// In front of the author's text the stamp is part of a node that is not whitespace-only, so
	// the parent's whitespace rule never applies to it and text carries it wherever text is legal.
	const mark = stamps(walk, index, close, at > end);
	return [end, at, `${source.slice(end, at)}${mark}`];
}

function stamps(walk: Walk, index: number, close = '', beside = false): string {
	const tight = walk.tight && !beside;
	if (walk.siblings && elementCarrier(walk.parent, tight)) {
		refuse(
			`this block sits directly inside \`<${String(walk.parent)}>\`, where the marker saying which ` +
				'block closed has to be an element because text is not writable there -- and this ' +
				"component's stylesheet relates siblings with `+` or `~`, which that element would stand " +
				'between, so the elements it relates would lose their scoping class. Wrapping the block in ' +
				'a cell of its own, or relating those two elements without a sibling combinator, avoids it',
		);
	}
	return carrier(index, walk.parent, close, tight, tight && walk.svg);
}

/**
 * Stands a body block in the head stream as well, where a `<svelte:head>` was walked inside it.
 *
 * `$.head` runs where the component does -- once per branch taken, once per item -- so the head
 * holds one head block for every time the body ran the child, and an each that repeats the
 * child's body repeats its head block. The bytes hold no anchor for that: the head is a flat run
 * of head blocks, each a hash anchor, its content and an empty comment, and Svelte writes nothing
 * around the ones a block produced. So the render writes something. A `{@const}` at the start of
 * each branch opens the block in the head, and an expression tag beside the stamp closes it; see
 * `headOpens()` and `headCloses()` for why neither touches the body's bytes. Measured against
 * Svelte for a text-first each, an if holding one component alone, whitespace on both sides, an
 * `{:else if}` chain, an each with a fallback, and the carriers a table and a select need.
 *
 * The head half is a block of its own, bare -- the anchors are ours and go from the bytes -- and
 * it borrows the body half's alternates: both are the one if or each, and the render made with a
 * branch of one taken is the render made with that branch of the other. The assembler then reads
 * it as it reads any block in the head, and the head IR carries the if or the each the body does.
 */
function mirrored(
	walk: Walk,
	block: number,
	closer: number,
	opens: (number | null)[],
	/** The edits of the file the block sits in, which is the walk's own unless a child's. */
	edits = walk.edits,
): number {
	const { blocks } = walk;
	const body = blocks[block];
	const held = edits[closer];
	if (body === undefined || held === undefined) return -1;
	const index = blocks.length;
	blocks.push({
		...body,
		index,
		stream: 'head',
		within: [...(body.within ?? [])],
		bare: true,
		mirrors: block,
		// A fragment's head half is a fragment of its own, named after the body's, with the same
		// parameters and the same first binds; a call inside it is a call of the head half. It
		// opens with no text, so nothing is written back ahead of it.
		...(body.fragment === undefined
			? {}
			: {
					fragment: {
						name: `${body.fragment.name}h`,
						params: body.fragment.params,
						binds: body.fragment.binds,
					},
				}),
	});
	// A branch that holds nothing gets no open: the close writes the empty pair on its own. An if
	// without an `{:else}` has no branch to hold one at all, and is the same case.
	for (const at of opens) {
		if (at !== null) edits.push([at, at, headOpens(index)]);
	}
	// Whatever the edit carried ahead of the stamp stays: a fragment's closes its bare block first.
	const ahead = held[2].slice(0, held[2].length - stamps(walk, block).length);
	edits[closer] = [held[0], held[1], `${ahead}${stamps(walk, block, headCloses(index))}`];
	return index;
}

/**
 * The nodes of a fragment's root that the bare block wraps: what is written, whitespace at either
 * end aside, and none of what `clean_nodes` hoists out of the fragment -- a `<svelte:head>` and the
 * other meta elements, which cannot sit inside a block and render the same wherever they sit. One
 * written between the rest would have to be moved, and the edits inside it moved with it, so it
 * is asked to be first or last instead.
 */
/**
 * Closes the bare block a recursive fragment's body is wrapped in, after everything the walk
 * already wrote at that point.
 *
 * `apply` writes back to front, so among edits that begin at one offset the one pushed **first**
 * ends up rightmost. The wrapper's close is written after the body is walked, so it was pushed
 * last and landed to the left of the stamp of a block that ends where the body does: for
 * `{#if depth > 0}<svelte:self/>{/if}` as the whole of a component, the two stamps came out as
 * `%%b0%%%%b1%%` and only the first was read. Merged into that edit instead, which is the one
 * place that says what order the two belong in.
 *
 * @returns the index of the edit that closes the block, for `headedFragment`.
 */
function closes(edits: [number, number, string][], at: [number, number, string]): number {
	const held = edits.findIndex(([start]) => start === at[0]);
	if (held < 0) {
		edits.push(at);
		return edits.length - 1;
	}
	const one = edits[held] as [number, number, string];
	edits[held] = [one[0], one[1], `${one[2]}${at[2]}`];
	return held;
}

function wrapped(
	nodes: readonly unknown[],
	what: () => string,
): [first: [number, number], last: [number, number]] | null {
	const hoisted = new Set([
		'SvelteHead',
		'SvelteWindow',
		'SvelteBody',
		'SvelteDocument',
		'SvelteOptions',
	]);
	const written = nodes.filter(
		(one) =>
			isNode(one) &&
			!hoisted.has(String(one['type'])) &&
			!(one['type'] === 'Text' && /^\s*$/.test(String(one['data'] ?? ''))),
	);
	const first = span(written[0]);
	const last = span(written[written.length - 1]);
	if (first === null || last === null) return null;
	for (const one of nodes) {
		if (!isNode(one) || !hoisted.has(String(one['type']))) continue;
		const at = span(one);
		if (at !== null && at[0] > first[0] && at[0] < last[1]) {
			refuse(
				`${what()} renders itself and writes its \`<${String(one['name'] ?? one['type'])}>\` between ` +
					'the markup, which the block around the body cannot hold: writing it first or last ' +
					'in the file is the same component, since Svelte hoists it either way',
			);
		}
	}
	return [first, last];
}

/**
 * Stands a fragment in the head stream as well, where its component writes a `<svelte:head>`.
 *
 * The fragment is called per level of data, so its head block repeats per level the way its body
 * does, and the head IR has to carry the call: the body's block is mirrored as any block is, its
 * head half named after it, and every call of it writes a second marker into the head, read as a
 * call of the head half -- `callsHead()`, which is why the fragment has to be known headed before
 * its body is walked, where the calls are met. The open goes in two places and writes once: a
 * `{@const}` inside the bare `{#if true}` around the body, and a statement at the end of the
 * script, because `clean_nodes` hoists the head ahead of the body and the block has to be open
 * before it runs. Measured against Svelte's own recursion with a head per level and a title, the
 * deepest last level's winning as the last head block executed.
 *
 * A head that reaches the fragment from a component inside its body is refused: it is found only
 * once the body is walked, after the calls inside it were written without a head marker.
 */
function headedFragment(
	walk: Walk,
	block: number,
	edits: [number, number, string][],
	opener: number,
	closer: number,
	ast: AstNode,
): number {
	const opened = edits[opener];
	if (opened === undefined) return -1;
	const mirror = mirrored(walk, block, closer, [], edits);
	edits[opener] = [opened[0], opened[1], `${opened[2]}${headOpens(mirror)}`];
	appended(ast, [`;${headOpensWith(mirror, 'undefined')};`], edits);
	return mirror;
}

/** The refusal for a head found inside a fragment's body once the calls in it were written. */
function headFoundLate(what: string): never {
	return refuse(
		`${what} renders itself and a component inside it writes a \`<svelte:head>\`, which is not ` +
			'handled yet: the fragment would have to stand in the head stream, and that is known only ' +
			'once its body is walked, after the calls inside it were written',
	);
}

/**
 * The run of titles and whitespace one title sits in, from the whitespace before its first title
 * to the whitespace after its last, and whether any whitespace is in it outside the titles. What
 * `clean_nodes` hoists is every title in the fragment, so what a run leaves is decided by the run.
 */
function titleRun(
	source: string,
	from: number,
	to: number,
): { from: number; to: number; spaced: boolean } {
	let start = from;
	for (;;) {
		if (!source.endsWith('</title>', start)) break;
		// From inside the closing tag, or the search finds the title this run started from.
		const open = source.lastIndexOf('<title', start - '</title>'.length);
		if (open < 0) break;
		start = open;
		while (start > 0 && /\s/.test(source[start - 1] ?? '')) start -= 1;
	}
	let end = to;
	for (;;) {
		if (!source.startsWith('<title', end)) break;
		const close = source.indexOf('</title>', end);
		if (close < 0) break;
		end = close + '</title>'.length;
		while (end < source.length && /\s/.test(source[end] ?? '')) end += 1;
	}
	const outside = source.slice(start, end).replace(/<title[\s\S]*?<\/title>/g, '');
	return { from: start, to: end, spaced: /\s/.test(outside) };
}

/** Just past the `}` that closes a block's opening tag, given the span of what it ends with. */
function afterTag(source: string, ends: [number, number] | null): number | null {
	if (ends === null) return null;
	const close = source.indexOf('}', ends[1]);
	return close < 0 ? null : close + 1;
}

/**
 * Just past an `{:else}`, found from the first node it holds, or null where it holds nothing. The
 * search runs back from that node rather than forward from the block's start, because the branch
 * before it may hold an if with an else of its own.
 */
function afterElse(source: string, fragment: AstNode): number | null {
	const nodes = Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const first = span(nodes[0]);
	if (first === null) return null;
	const at = source.lastIndexOf('{:else', first[0]);
	return afterTag(source, at < 0 ? null : [at, at]);
}

/**
 * What a `{@const}` or a `{const}`/`{let}` binds, with a node it cannot read named rather than
 * skipped. `declaredBy` is the reading; this is the refusal that belongs to this pass.
 */
function declarators(node: AstNode): [unknown, unknown][] {
	const found = declaredBy(node);
	if (found.length === 0) refuse('a `{@const}` this compiler cannot read');
	return found;
}

/**
 * What a declaration in markup holds, as source, with a rune's call read through.
 *
 * `DeclarationTag.js` pushes the declaration into `init` unchanged, so its initialiser reaches the
 * same `CallExpression` visitor a script's does and the rune is compiled away the same way: the
 * value is the rune's first argument, `$derived.by`'s is that argument called, and a rune given
 * nothing holds `undefined`. See `runeHolds`.
 */
function heldValue(
	init: unknown,
	expand: Locals['rewrite'],
	bound: ReadonlyMap<string, string>,
): string {
	if (!isNode(init)) return 'undefined';
	if (init['type'] === 'CallExpression') {
		const rune = runeCalled(init['callee']);
		const reach = rune === null ? undefined : runeHolds(rune);
		if (reach !== undefined) {
			const argument = Array.isArray(init['arguments']) ? init['arguments'][0] : undefined;
			if (!isNode(argument)) return 'undefined';
			return `(${expand(argument, bound)})${reach}`;
		}
	}
	return `(${expand(init, bound)})`;
}

/**
 * The declarations a fragment hoists, in the order Svelte binds them.
 *
 * `sort_const_tags` in `3-transform/utils.js` puts a fragment's `{@const}`s in topological order and
 * ahead of everything else, so `{@const a = b}` written above `{@const b = 1}` reads the 1 and a
 * `{@const}` written below the markup that reads it still binds for it. It runs under
 * `!state.analysis.runes`, so it is legacy mode's rule alone: in runes mode the order is the source
 * order, and reading a later one is JavaScript's own temporal dead zone.
 *
 * A `{const}`/`{let}` is never sorted -- `sort_const_tags` names `ConstTag` and nothing else, and
 * `DeclarationTag.js` refuses legacy mode outright, so the two cannot meet in one file.
 *
 * A cycle is `const_tag_cycle`, Svelte's own error. This stops rather than looping, and the render
 * compiles the same source, so Svelte is the one that names it.
 */
function sorted(nodes: readonly AstNode[], walk: Walk): readonly AstNode[] {
	if (!walk.legacy || nodes.length < 2) return nodes;
	const by = new Map<string, AstNode>();
	for (const one of nodes) {
		if (one['type'] !== 'ConstTag') continue;
		const bound = new Set<string>();
		for (const [id] of declarators(one)) namesIn(id, bound);
		for (const name of bound) by.set(name, one);
	}
	if (by.size === 0) return nodes;

	const needs = new Map<AstNode, Set<string>>();
	for (const one of nodes) {
		if (one['type'] !== 'ConstTag') continue;
		const found = new Set<string>();
		for (const [, init] of declarators(one)) {
			readsIn(init, new Set<string>(), (at) => {
				const name = at['name'];
				if (typeof name === 'string' && by.has(name)) found.add(name);
			});
		}
		needs.set(one, found);
	}

	const out: AstNode[] = [];
	const seen = new Set<AstNode>();
	const add = (one: AstNode): void => {
		if (seen.has(one)) return;
		seen.add(one);
		for (const name of needs.get(one) ?? []) {
			const to = by.get(name);
			if (to !== undefined && to !== one) add(to);
		}
		out.push(one);
	};
	for (const one of nodes) if (one['type'] === 'ConstTag') add(one);
	return [...out, ...nodes.filter((one) => one['type'] !== 'ConstTag')];
}

/**
 * A fragment's children, with the declarations it hoists bound for every one of them first.
 *
 * `clean_nodes` in `3-transform/utils.js` lifts a `{@const}` and a `{const}`/`{let}` out of the
 * fragment's nodes into `hoisted`, and `ConstTag.js` and `DeclarationTag.js` push what they declare
 * into the block's `init`, which is written ahead of the template. So a declaration binds for the
 * whole fragment however late in it it was written, and it writes no bytes of its own.
 *
 * Called for a `<slot>`'s group as well as for a fragment node, because a group is a fragment of
 * the caller's that Svelte cleans the same way -- its nodes used to be walked one by one from here,
 * which sent every `{@const}` in a slot to the arm that refuses what the walk has not been taught.
 */
function held(nodes: readonly unknown[], walk: Walk, alone: unknown): void {
	const inner = hoisting(nodes, walk);
	for (const child of nodes) {
		if (inner !== null && declaring(child)) continue;
		collect(child, {
			...walk,
			...(inner === null ? {} : { expand: inner }),
			alone,
			standalone: true,
		});
	}
}

/**
 * The declarations a fragment hoists, written out, and the substitution its children then read.
 *
 * Null where it hoists none, which is most fragments. Split from `held` because the markup handed
 * to a component the walk could not enter is a fragment too -- Svelte cleans the component's
 * children the same way -- and that loop walks its nodes one at a time to keep each group's holes
 * and blocks apart, so it cannot call `held` and needs what `held` built.
 */
function hoisting(nodes: readonly unknown[], walk: Walk): Locals['rewrite'] | null {
	const { edits, expand } = walk;
	const hoisted = sorted(nodes.filter(declaring) as AstNode[], walk);
	if (hoisted.length === 0) return null;

	const bound = new Map<string, string>();
	for (const one of hoisted) {
		for (const [id, init] of declarators(one)) {
			// Expanded against what the earlier ones bound, so `{@const b = a + 1}` reaches `a`.
			const value = heldValue(init, expand, bound);
			const at = span(init);
			// The value is unused once every read of it is a marker, and evaluating it would
			// reach for data the render is not given. What stands in has to come apart the way
			// the name does.
			if (at !== null) edits.push([at[0], at[1], holdsFor(id)]);
			// The pattern stays for the render, taking the placeholder apart, so nothing in it may
			// evaluate: `{@const { [`${a}-x`]: { b } } = f()}` reads `a` and destructures a member
			// of `{}`, and both are gone before the render sees it.
			neutralise(id, edits);

			if (isNode(id) && id['type'] === 'Identifier' && typeof id['name'] === 'string') {
				bound.set(id['name'], value);
				continue;
			}
			// Taken apart the way a snippet's parameter is: a member or an index per name, a
			// default as the choice JavaScript makes, and a rest or a nesting refused by name. A
			// default may read an earlier const, so it is expanded against what those bound.
			const amid: Locals['rewrite'] = (child, more) =>
				expand(child, more === undefined ? bound : new Map([...bound, ...more]));
			for (const [name, reached] of takenApart(id as AstNode, value, amid, () => 'a `{@const}`')) {
				bound.set(name, reached);
			}
		}
	}

	return (child, more) => expand(child, more === undefined ? bound : new Map([...bound, ...more]));
}

function collect(node: unknown, walk: Walk): void {
	const { blocks, dynamic, edits, expand, holes, pending, site, snippets, source, stream, within } =
		walk;
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
			// Which node the fragment holds alone, for the children of this fragment and no deeper.
			// Reset to true for them, so a block inside an element is standalone again. See
			// `onlyChild` and `Walk.standalone`.
			held(
				Array.isArray(node['nodes']) ? node['nodes'] : [],
				walk,
				walk.standalone ? onlyChild(node) : null,
			);
			return;
		}

		case 'Text':
			return;

		case 'SvelteFragment': {
			// A wrapper that writes nothing of its own: it exists to carry a `slot=` and its `let:`
			// directives, which the caller's grouping already read. Its children are the group.
			step(node['fragment']);
			return;
		}

		case 'SlotElement': {
			// `SlotElement.js` writes `block_open`, `$.slot(...)`, `block_close`, and `$.slot` calls
			// what the caller put under this name in `$$slots` or, where the caller put nothing, the
			// element's own children as the fallback. Both anchors and the call stay in the source
			// for Svelte to render -- the caller's tag still holds its children, so the copy is
			// handed them exactly as the original would have been. What is walked here is whichever
			// of the two actually renders, in the scope it was written in.
			const named = attributeText(node, 'name') ?? 'children';
			const handed = site.given.get(named);
			if (handed === undefined) {
				// The fallback, which is this component's own markup in this component's scope.
				step(node['fragment']);
				return;
			}
			// A `let:` name is bound by the slot, not read from the caller's scope, so it shadows a
			// declaration of the same name there: `<Counter let:count>{count}</Counter>` writes what
			// the child supplies even where the caller has a `count` of its own. Bound to itself, so
			// the expansion leaves the name alone -- and nothing stands for it, because the render
			// has the real value: the caller's tag still holds this markup and Svelte passes the
			// slot props to it, so what the component supplies is the component's own bytes.
			// Each `let:` name reads what the `<slot>` passed under that prop, expanded here in this
			// component's scope -- so an each's item stays the each's item and is bound per
			// iteration rather than baked at whatever the compile-time render happened to hold.
			// A spread on the `<slot>` is merged into what it passes: `SlotElement.js` builds
			// `$.spread_props([{ ...named }, ...spreads])` -- **every written attribute in one object
			// first, then the spreads in source order**, which is not the order they were written in
			// and means a spread wins over a name beside it however they were arranged. So each
			// `let:` name is the fold that merge leaves for it, the same one a component's props go
			// through, over an object whose keys are the request's.
			const passed = new Map<string, string>();
			const order: ({ name: string } | { spread: string })[] = [];
			const spreads: { spread: string }[] = [];
			for (const one of Array.isArray(node['attributes']) ? node['attributes'] : []) {
				if (!isNode(one)) continue;
				if (one['type'] === 'SpreadAttribute') {
					spreads.push({ spread: `(${expand(one['expression'])})` });
					continue;
				}
				if (one['type'] !== 'Attribute' || typeof one['name'] !== 'string') continue;
				if (one['name'] === 'name' || one['name'] === 'slot') continue;
				const written = valueExpression(one, source, expand);
				passed.set(one['name'], written ?? 'undefined');
				order.push({ name: one['name'] });
			}
			order.push(...spreads);
			// By the prop's own name here, which `merged` folds over, and only then read out under
			// the local the `let:` bound it to. A prop the slot does not pass is `undefined`, which
			// is what a pattern destructures from an object without it.
			merged(
				order,
				[...handed.handed].map(([prop]) => ({ local: prop, prop, fallback: 'undefined' })),
				passed,
			);
			// Only the names the `let:` bound, under the locals it bound them to: the rest are this
			// component's own attribute names and shadowing the caller with them would be wrong.
			const shadow = new Map<string, string>();
			for (const [prop, local] of handed.handed) {
				const value = passed.get(prop) ?? 'undefined';
				if (typeof local === 'string') {
					shadow.set(local, value);
					continue;
				}
				// A pattern binds several names from the one prop, each reached the way a `{@const}`'s
				// pattern reaches into its initialiser.
				for (const [name, reached] of takenApart(local, value, expand, () => `\`let:${prop}\``)) {
					shadow.set(name, reached);
				}
			}
			// The group is a fragment of the caller's and Svelte reads `is_standalone` for it, so the
			// one node it holds is read here rather than inherited from the component this `<slot>`
			// sits in. `<svelte:self />` alone in a slot is the case: `is_standalone` names
			// `RenderTag` and `Component` and a `SvelteSelf` is neither, so Svelte writes the anchor
			// for it and the stand-in that replaces it -- a Component, and alone -- would not.
			const only = onlyChild({ nodes: handed.nodes });
			// A group is one span of the caller's source and a walk of it rewrites that span. A
			// component rendering the same group from a second `<slot>` -- with different props, which
			// is the only reason to -- wants a second rewrite of the same characters, and the two are
			// not the same text. It is a fragment the runtime calls twice, the way a recursive
			// component's body is, and until it is one this says so rather than letting `apply`
			// report offsets.
			// A second `<slot>` rendering the same group is walked once and no more. The markup stays
			// in the caller's tag and Svelte's `$.slot` calls it wherever a slot executes, so the
			// bytes come from the render either way; what the walk does here is rewrite the caller's
			// source and plant its holes, and doing that twice over one span is two edits on one
			// place. `component-nested-deeper` is the shape: a `<slot>` in each branch of an `{#if}`,
			// one of which renders.
			//
			// **Only where the slot binds nothing.** A `let:` name is bound by the slot, so two slots
			// passing different values want the markup rewritten two ways and one rewrite cannot
			// serve both. That stays refused, and says which of the two it is.
			if (handed.walked !== undefined) {
				if (handed.handed.size === 0 && handed.planted !== true) return;
				refuse(
					`the markup handed to this component under \`${named}\` is rendered by more than one ` +
						`\`<slot>\`, and it holds a value or binds a name of its own, so one span of the ` +
						"caller's source would be rewritten once per slot and a marker in it would belong " +
						'in two places. It is a fragment called once per slot, the way a recursive ' +
						"component's body is, which the walk does not write yet",
				);
			}
			handed.walked = named;
			const planted = holes.length;
			// Through `held` rather than one node at a time: the group is a fragment of the caller's
			// and Svelte cleans it the same way, so a `{@const}` in it is hoisted and binds for its
			// siblings. Walked flat, every one of them reached the arm that refuses what the walk has
			// not been taught. `legacy` is the caller's, because the markup is.
			held(
				handed.nodes,
				{
					...walk,
					source: handed.source,
					edits: handed.edits,
					expand:
						shadow.size === 0
							? handed.expand
							: (one, extra) =>
									handed.expand(one, extra === undefined ? shadow : new Map([...shadow, ...extra])),
					snippets: handed.snippets,
					site: handed.site,
					legacy: handed.legacy,
				},
				only,
			);
			// Whether the group put a marker in the bytes, which is what makes a second slot
			// impossible: a marker belongs in one place and the same markup at two slots puts it in
			// two. Recorded rather than reasoned about, since what the group holds is only known once
			// it is walked.
			handed.planted = holes.length > planted;
			return;
		}

		case 'SvelteSelf': {
			// A call of the fragment this component is: `SvelteSelf.js` is `build_inline_component`
			// with the component itself, and the walk entered the component as a fragment.
			if (site.fragment === undefined) {
				refuse(
					'`<svelte:self>` in a component the walk did not enter as one rendering itself, ' +
						'which cannot happen: the walk reads for it before entering',
				);
			}
			selfCall(node, walk, 'SeamSelf', site.fragment, undefined, undefined, true);
			return;
		}

		case 'SvelteHead': {
			// The other stream. Everything under it renders into the head rather than the body.
			// And written where the component runs: inside a body block, once per branch taken or
			// per item. Every if and each this sits inside has to stand in the head stream as well,
			// and is told so here, to read once its body is walked. A dynamic element is not one:
			// it decides nothing about what is inside it. See `mirrored()`.
			for (const [index] of within) {
				if (blocks[index]?.kind !== 'element') site.headed.add(index);
			}
			// A head block holding a title opens with a stand-in that says so, because which title
			// wins is decided per head block: `$.head` is hoisted ahead of its fragment, so the last
			// head block executed compares later under `set_title`, and inside one block the first
			// title executed is kept. The injector counts the blocks by this. See spec/ir.md.
			if (contains(node['fragment'], 'TitleElement')) {
				// Where the first child starts, with the whitespace before it taken out: Svelte trims
				// the whitespace that opens a fragment, and the stand-in must not turn it into a space
				// between two elements.
				const whole = span(node);
				const open = whole === null ? -1 : source.indexOf('>', whole[0]);
				if (open >= 0) {
					let first = open + 1;
					while (first < source.length && /\s/.test(source[first] ?? '')) first += 1;
					edits.push([open + 1, first, '<seam-title-open></seam-title-open>']);
				}
			}
			step(node['fragment'], 'head');
			return;
		}

		case 'ExpressionTag':
		case 'HtmlTag': {
			const at = span(node['expression']);
			if (at === null) return;
			// A literal decides nothing, so nothing has to stand for it. Written out in its expanded
			// form rather than left as it was: what it expanded from may have been a name, and the
			// declaration that name came from has been neutralised for the render.
			const written = settled(expand(node['expression']), walk);
			subscribing(written, walk);
			// Inside a class value, what is written has to be exactly as readable to Svelte's CSS
			// analysis as what the author wrote -- no less and no more. So the author's own
			// expression stays, in the branch that is never taken. See `Walk.classValue`.
			const shielded = (text: string): string =>
				awaited(
					written,
					walk.inClass === true ? `(1 ? ${text} : (${source.slice(at[0], at[1])}))` : text,
				);
			if (constant(written)) {
				edits.push([at[0], at[1], shielded(asWritten(node['expression'], written, walk))]);
				return;
			}
			// A value the request does not decide is the same bytes every request, and the render
			// is where it is computed: inside the layout's providers, with every declaration and
			// fixed path it reads written out as what it stands for. So it is written out expanded
			// for Svelte to evaluate, the same rule a prop handed to a package already follows, and
			// no hole stands for it. Planting one made it a derivation, which is a value asked for
			// per request -- and press's newsletter count is `createQuery(...).data ?? 0`, whose
			// server value is fixed by construction and whose evaluation outside a render is
			// impossible by construction: `getContext` outside `render()` has no context to read.
			// Anything ambient in it -- a clock, a random -- is refused before this by `resolved`.
			// See spec/refusals.md.
			if (
				site.payload !== null &&
				walk.opaque !== true &&
				walk.asking !== true &&
				!varies(written, walk)
			) {
				edits.push([at[0], at[1], shielded(asWritten(node['expression'], written, walk))]);
				return;
			}
			// A value going to a component the walk could not enter, which has to survive being used
			// rather than only written out. See `stands`.
			if (walk.opaque === true) {
				edits.push([at[0], at[1], awaited(written, stands(written, walk))]);
				return;
			}
			const index = holes.length;
			// The whole of a class on an element the stylesheet may scope. `to_class` writes the
			// value and the hash with a space between, the hash alone for an empty value, and
			// nothing for neither, so which bytes exist is decided by the value: a decision with
			// the value inside its non-empty outcome, the way a `class:` is one with the hash
			// inside its outcomes. The hash is read off the render, where the marker stands as the
			// whole value. See `outcomes()`.
			if (walk.classValue === true) {
				holes.push({ index, expression: clsxed(node['expression'], () => written), raw: false });
				const choice = holes.length;
				const test = `(${written}) == null || '' + (${written}) === ''`;
				holes.push({
					index: choice,
					expression: '',
					raw: false,
					choice: { tests: [test], outcomes: [] },
				});
				walk.pending.push({
					index: choice,
					tests: [test],
					kind: 'value',
					names: [],
					base: '',
					value: index,
				});
				edits.push([at[0], at[1], shielded(JSON.stringify(sentinel(choice)))]);
				return;
			}
			// Where the value lands, and therefore how it is escaped, is read off the render rather
			// than guessed here. A prop passed to a component may end up in text or in an attribute,
			// and only the component knows which.
			holes.push({ index, expression: written, raw: type === 'HtmlTag' });
			edits.push([at[0], at[1], shielded(JSON.stringify(sentinel(index)))]);
			return;
		}

		case 'SvelteElement':
		case 'RegularElement':
		case 'Component':
		case 'SvelteComponent':
		case 'TitleElement': {
			// `<svelte:component this={...}>` is `build_inline_component` with the expression as the
			// component, the same dynamic call a tag naming a rune goes through below. The
			// expression is settled the same way, and a lookup in a table of components is the
			// choice its keys spell out. See spec/refusals.md.
			// A dynamic component the walk settles to one import is that component, and is entered
			// as one where it can be -- the render keeps the dynamic call, and so the anchors. Where
			// it cannot, the settled expression is written for Svelte to evaluate, as before.
			let settledTag: {
				name: string;
				expression: [number, number] | null;
				written: () => void;
				rewritten?: (fresh: string) => void;
			} | null = null;
			/** The branch a `this` the request decides opened, popped once the tag is walked. */
			let chosenBranch: number | null = null;
			if (type === 'SvelteComponent') {
				const where = span(node['expression']);
				if (where === null) return;
				// A `this` the request decides, which the payload bounds to one candidate and
				// nothing: a block with two branches, the alternate writing no bytes. The tag itself
				// stays, so Svelte writes the anchors `build_inline_component` writes -- `<!--[-->`
				// and `<!--[!-->`, which are not the numbered pair an `{#if}` writes -- and only the
				// expression is swapped. See `chosenComponent()`.
				// A `this` the source has already settled to nothing renders `<!--[!--><!--]-->` and
				// nothing else: `build_inline_component` builds the props object **inside** the `if`,
				// so neither the attributes nor the children are evaluated, and a spread whose keys
				// this compiler cannot list never has to be listed.
				if (constantly(settled(expand(node['expression']), walk)) === false) {
					buried(walk, node['fragment']);
					return;
				}
				const only = chosenComponent(node['expression'], walk);
				if (only !== null) {
					const index = blocks.length;
					blocks.push({
						index,
						kind: 'if',
						stream,
						expression: only.test,
						tests: [only.test],
						item: null,
						counter: null,
						alternate: true,
						within: [...within],
					});
					const choice = chose(walk, edits, where[0], where[1], index, 0, only.name, 'null');
					// Which block just closed, written where the render puts it and nowhere else.
					const whole = span(node);
					if (whole !== null) edits.push(stamped(walk, index, source, whole[1]));
					// Everything the rest of this tag plants -- its attributes, and the body of the
					// component the walk enters -- belongs to the branch that renders it.
					chosenBranch = index;
					within.push([index, 0]);
					settledTag = {
						name: only.name,
						expression: where,
						written: () => {},
						rewritten: (fresh) => {
							rechose(walk, choice, fresh);
						},
					};
				} else {
					const chosen = choosing(expand(node['expression']), 'svelte:component', walk);
					const written = (): void => {
						edits.push([where[0], where[1], chosen]);
					};
					if (IDENTIFIER.test(unwrapped(chosen)) && site.carried.has(unwrapped(chosen))) {
						settledTag = { name: unwrapped(chosen), expression: where, written };
					} else {
						written();
					}
				}
			}
			try {
				// A title stays in the head stream where Svelte executed it rather than going to the
				// channel Svelte keeps it in, as a stand-in element the assembler reads as a `title`
				// node: `top` at the head block's top level, which runs at the block's init, and
				// `nested` inside a block within the head. Its children are walked as any element's.
				if (type === 'TitleElement') {
					const whole = span(node);
					const role = within.length === 0 ? 'top' : 'nested';
					const close = `</title>`;
					if (whole !== null && source.endsWith(close, whole[1])) {
						edits.push([whole[0] + 1, whole[0] + 1 + 'title'.length, `seam-title-${role}`]);
						edits.push([whole[1] - close.length, whole[1], `</seam-title-${role}>`]);
						// A title is hoisted out of its fragment by `clean_nodes`, so the whitespace around
						// it is whitespace around nothing: a run of titles and the whitespace among them
						// leaves one text node of whitespace, or nothing where there was none, and that is
						// trimmed where it opens or closes the fragment and one space where two neighbours
						// remain. The stand-ins stay in the fragment, so the whitespace is written as
						// that: gone, or one space after the last stand-in of the run. Two titles with
						// nothing between them used to get a space, which Svelte never wrote.
						let from = whole[0];
						while (from > 0 && /\s/.test(source[from - 1] ?? '')) from -= 1;
						let to = whole[1];
						while (to < source.length && /\s/.test(source[to] ?? '')) to += 1;
						const run = titleRun(source, from, to);
						const before = source.slice(0, run.from);
						const after = source.slice(run.to);
						const opens = /(<svelte:head[^>]*>|\{[#:][^}]*\})$/.test(before);
						const closes = /^(<\/svelte:head>|\{[/:])/.test(after);
						const between = !opens && !closes && run.from > 0 && run.to < source.length;
						// The head's own edit already took the whitespace after its opening tag, and the
						// title before this one took the whitespace between them.
						const already = /(<svelte:head[^>]*>|<\/title>)$/.test(source.slice(0, from));
						if (from < whole[0] && !already) edits.push([from, whole[0], '']);
						const last = !source.startsWith('<title', to);
						const left = last && between && run.spaced ? ' ' : '';
						if (to > whole[1]) edits.push([whole[1], to, left]);
						else if (left !== '') edits.push([whole[1], whole[1], left]);
					}
				}
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
					// `this="svg"` is a quoted literal, so the span sits inside the quotes and the text
					// there is the tag itself rather than an expression naming it. Expanded as one it
					// became the identifier `svg`, which the derivation could not resolve.
					const held = node['tag'];
					const quote = source[where[0] - 1];
					const literal =
						isNode(held) &&
						(held['type'] === 'Text' || held['type'] === 'Literal') &&
						(quote === '"' || quote === "'") &&
						source[where[1]] === quote;
					const tag = literal
						? JSON.stringify(source.slice(where[0], where[1]))
						: expand(node['tag']);
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
					// `this={expr}` gives a span inside the braces, where a JSON string is what belongs.
					// `this="svg"` gives one inside the quotes, and writing a quoted string there makes
					// `this=""seam-el0""` -- markup Svelte will not parse. So the quotes go with it.
					const quoted = literal ? ([where[0] - 1, where[1] + 1] as [number, number]) : where;
					edits.push([quoted[0], quoted[1], JSON.stringify(`seam-el${String(index)}`)]);
				}
				const attributes = node['attributes'];
				// The three shapes a `<select>` and an `<option>` add, and `bind:innerHTML`, each a value
				// the render cannot show where it lands. See `selection()` and `contents()`.
				const skipped = new Set<unknown>();
				const dropped = new Set<string>();
				const selecting =
					type === 'RegularElement'
						? selection(
								node,
								source,
								expand,
								holes,
								edits,
								walk.selecting,
								skipped,
								dropped,
								(text) => (site.payload !== null ? !varies(text, walk) : true),
							)
						: walk.selecting;
				const bare =
					type === 'RegularElement' ? contents(node, walk, holes, edits, skipped) : undefined;
				// The class directives are taken together with the class attribute, because that is how
				// Svelte writes them: one call producing one attribute, not one attribute plus a list of
				// additions. What is left after this is walked the ordinary way.
				// A spread takes the whole run, so the two directive passes have nothing left to decide.
				const spreads = spread(
					source,
					node,
					holes,
					edits,
					expand,
					site.spreads,
					site.copy,
					(text) => site.payload !== null && !varies(text, walk),
					skipped,
					dropped,
				);
				// `style:` before `class:`, which puts the class first in the output. Where an element
				// carries a directive and no attribute of that name, `2-analyze/index.js` appends one --
				// `create_attribute('class', ...)` when it is scoped or has a `class:`, then
				// `create_attribute('style', ...)` when it has a `style:` -- so both land after every
				// written attribute, class first. Here both are inserts at that one offset, and `apply`
				// sorts descending and writes back to front, so the one pushed *later* comes out first.
				const styled =
					spreads.size > 0
						? spreads
						: styles(
								source,
								node,
								holes,
								edits,
								expand,
								pending,
								(text) => site.payload !== null && !varies(text, walk),
							);
				const handled = spreads.size > 0 ? spreads : classes(node, holes, edits, expand, pending);
				const given = type === 'Component' || type === 'SvelteComponent';
				const tag = typeof node['name'] === 'string' ? node['name'] : '';

				// Into the child, where the child is one this walk can follow. What it plants there is
				// what the child does with the value rather than the value itself, so a prop used twice,
				// or not at all, or computed with, is the ordinary case rather than a marker that does
				// not come back. See spec/refusals.md.
				if (given && descend(node, walk, settledTag ?? undefined)) {
					return;
				}
				// A tag's name is an expression, which is `Component.js` in one line:
				// `context.visit(b.member_id(node.name))` splits it on `.` and puts the root through
				// `build_getter` like any other read. So `<C />` over a name this walk decides is
				// `<svelte:component this={C} />` written another way, and it is refused where that
				// would be. Left alone it reached the render as the marker standing for the name, and
				// Svelte called it: `C is not a function`, an error about nothing the author wrote.
				//
				// A name an `{#each}` binds is the one that can be answered rather than refused: the
				// body is written once and every item renders it, so the tag is the same component for
				// all of them or it is nothing this IR can hold. See `perItem()`.
				if (type === 'Component' && !perItem(node, tag, walk, edits)) naming(tag, walk);
				// Not entered: the dynamic call gets the settled expression after all.
				if (settledTag !== null) settledTag.written();
				// `renderer.select` keeps the select's value on `this.local`, which a child renderer
				// inherits, so an `<option>` written inside a component compares against it exactly as
				// one written here does. The value has been cut from the render by then -- taking it off
				// the tag is what stops Svelte doing the comparison a second time -- so a child whose
				// options this walk cannot see gets no ` selected=""` from anybody. Measured on
				// `select-value-component`, whose `<Option>` wraps `<option {...props}>`.
				if (given && walk.selecting !== undefined) {
					refuse(
						`<${tag} /> is under a \`<select value>\` and the walk could not enter it. ` +
							'`renderer.select` keeps the value on the renderer a child inherits, so an ' +
							'`<option>` inside this component compares against it, and the comparison is ' +
							'made here rather than by the render. See spec/refusals.md',
					);
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
						// A `?:` in it chooses which component, the way one handed to a package chooses
						// what is handed, and is enumerated the same way: the walk stops and asks, and the
						// build renders once per branch. What the taken branch leaves has to be inert.
						const chosen = choosing(written, tag, walk);
						const rewritten = (): void => {
							edits.push([at[0], at[1], `svelte:component this={${chosen}}`]);
							const close = `</${tag}>`;
							if (source.endsWith(close, whole[1])) {
								edits.push([whole[1] - close.length, whole[1], '</svelte:component>']);
							}
						};
						if (IDENTIFIER.test(unwrapped(chosen)) && site.carried.has(unwrapped(chosen))) {
							settledTag = { name: unwrapped(chosen), expression: null, written: rewritten };
						} else {
							rewritten();
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
							expanded(attr, source, walk, edits);
							continue;
						}
						// A `bind:` on a component the walk could not enter -- one it entered returned
						// above. `unbind.ts` leaves it as written so `descend` can read both halves, and
						// there is no child here to read: what the child would send back is unknowable,
						// so the setter cannot be reasoned about and the binding is written as the plain
						// attribute it used to be rewritten to. That is the getter, which is what the
						// bytes hold, and it is what this compiler did before the setter was understood.
						//
						// Not refused, though it could be. Whether anything comes back is the child's to
						// say -- `bind_props` sends a prop up only where the child declares it with a
						// default -- and a child this walk could not enter is one whose declarations it
						// has not read. Both answers are in the corpus: `component-binding-private-state`
						// binds a child whose `x` is a local rather than a prop, and
						// `dynamic-component-bindings-recreated` one whose prop has no default, so neither
						// sends anything back and both were already right; `parent-supercedes-child-c`
						// binds one that does, and stays wrong. Reading the child through a
						// `<svelte:component>` is what would tell them apart. See spec/roadmap.md.
						if (given && isNode(attr) && attr['type'] === 'BindDirective') {
							const name = typeof attr['name'] === 'string' ? attr['name'] : '';
							const whole = span(attr);
							// Where nothing in the value is the request's, both halves are left exactly
							// as written, because both are the render's to run: Svelte wraps the caller's
							// template in the settling loop, `bind_props` assigns into the value the
							// caller actually holds, and the markup after the tag reads what it left.
							// Written out as the getter expanded instead, the child fills in a copy --
							// an object literal this pass has just built -- and
							// `component-binding-blowback-d` wrote `{}` where Svelte wrote
							// `{"value":"0:0"}`. It is the same rule the prop above follows, one
							// construct along.
							if (site.payload !== null && !varies(expand(getterOf(attr, source)), walk)) {
								continue;
							}
							if (whole !== null) {
								// The getter, written as the attribute it used to be rewritten to, with a
								// marker standing in it where the request decides the value -- which is what
								// `collect` would have done had `unbind.ts` written the attribute itself.
								const before = holes.length;
								edits.push([
									whole[0],
									whole[1],
									`${name}={${stands(expand(getterOf(attr, source)), walk)}}`,
								]);
								for (const one of holes.slice(before)) one.given = `\`<${tag}>\` as \`${name}\``;
							}
							continue;
						}
						const before = holes.length;
						collect(attr, { ...walk, opaque: given, scoping: !given });
						if (!given || !isNode(attr)) continue;
						const prop = typeof attr['name'] === 'string' ? attr['name'] : '';
						for (const one of holes.slice(before)) one.given = `\`<${tag}>\` as \`${prop}\``;
					}
				}

				// From here down the walk is inside this element, which is what decides how a block's
				// stamp is carried. A component is not one: what it does with the markup, and where it
				// puts it, is the child's business.
				const encloses = type === 'RegularElement' ? tag : null;
				// `can_remove_entirely` in `clean_nodes`: the svg namespace outside a `<text>`, which a
				// `<foreignObject>` leaves, and `<datalist>` beside the elements `carrier()` already
				// knows by name. It decides what carries a stamp written under this element, and
				// nothing else. See `Walk.tight`.
				const svg =
					type !== 'RegularElement'
						? walk.svg
						: tag === 'svg'
							? true
							: tag === 'foreignObject'
								? false
								: walk.svg;
				const tight =
					type !== 'RegularElement'
						? walk.tight
						: tag === 'svg'
							? true
							: tag === 'foreignObject' || tag === 'text'
								? false
								: tag === 'datalist' || walk.tight;

				// Markup handed to a component the walk could not enter, in the groups Svelte splits it
				// into. Each group's range is kept so that a second render can say whether the component
				// writes that group at all.
				const fragment = node['fragment'];
				const inside =
					isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
				if (!given || inside.length === 0) {
					// A content binding's children are the else of the bare if it planted.
					if (bare !== undefined) within.push([bare, -1]);
					collect(fragment, {
						...walk,
						parent: encloses,
						tight,
						svg,
						selecting,
						// `RegularElement.js` does not go through `Fragment.js`, so its children read the
						// enclosing flag rather than one of their own. A component's children do.
						standalone: type === 'Component' || type === 'SvelteComponent',
					});
					if (bare !== undefined) within.pop();
					return;
				}
				const groups = handedTo(site.file, tag, inside);
				const planted = new Set<Group>();
				// Markup handed to a component is a fragment of the caller's, and `clean_nodes` cleans
				// it the same way: a `{@const}` written among the slots binds for all of them and
				// writes no bytes of its own. Walked one by one from here without that, it reached the
				// arm that refuses what the walk has not been taught -- the same fault a `<slot>`'s
				// group had, one construct along.
				const bound = hoisting(inside, walk);
				for (const child of inside) {
					if (bound !== null && declaring(child)) continue;
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
					collect(child, {
						...walk,
						...(bound === null ? {} : { expand: bound }),
						parent: encloses,
						tight,
						svg,
					});
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
			} finally {
				if (chosenBranch !== null) within.pop();
			}
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
			// Only where the expression is the whole of the value: text beside it makes the value a
			// template, which is never empty, and the shape below assumes one expression.
			const inClass = name === 'class' && walk.scoping === true;
			const classValue = inClass && parts.length === 1;
			for (const part of parts) collect(part, { ...walk, inClass, classValue });
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
			// A boundary's `failed` is Svelte's to call, with the error it caught, and it stays in the
			// rendered source for `renderer.boundary` to find. Nothing here renders it, which is what
			// the refusal below is about, so it is named apart from it.
			if (named === 'failed' && walk.boundary === true) return;
			if (one === undefined || (one.renders === 0 && one.maybe !== true)) {
				// Written inside a component's tag, so it is a prop that component receives: the child
				// decides when to call it and with what, and neither is visible from here. One with no
				// parameters has nothing to decide and already works, which is what `children` is.
				refuse(`the snippet \`${named}\` takes parameters and is never rendered`);
			}
			// Fewer arguments than parameters is a function call: the rest are `undefined`, and a
			// default is what answers to that. More is a function call too: `RenderTag.js` passes
			// every argument through and JavaScript drops the ones nothing receives, so they are
			// written out with the rest at the call and bind nothing.
			return;
		}

		case 'RenderTag': {
			const call = called(node['expression']);
			// The callee is an expression, not always a name: `{@render state.value()}` and
			// `{@render (show ? foo : bar)()}` both name a snippet through one. It is settled the way
			// a `<svelte:component this={...}>` is -- the same `choosing()`, over the same
			// substitution -- and where it settles to a snippet this file declares, that is the
			// snippet rendered. The callee is written out as the name it settled to, so the render
			// calls it too: the expression it was reads a declaration the render is handed nothing
			// for.
			let name = renders(node);
			if (name === null || snippets.get(name)?.declared !== true) {
				const callee = isNode(call) ? call['callee'] : undefined;
				// Settled, not chosen: what does not settle to a snippet this file declares is left to
				// the refusal below, which says what it is. A callee that reads the request is one of
				// those rather than a component chosen per request.
				let settledName: string | null = null;
				try {
					settledName = isNode(callee) ? reaches(settled(expand(callee), walk)) : null;
				} catch {
					settledName = null;
				}
				// `2-analyze/visitors/RenderTag.js` sets `metadata.dynamic = binding?.kind !== 'normal'`,
				// so a callee that is a plain script declaration leaves the tag static. Everything
				// else -- a prop, an import, a rune declaration, anything that is not an identifier --
				// leaves it dynamic.
				const bare =
					isNode(callee) && callee['type'] === 'Identifier' && typeof callee['name'] === 'string'
						? callee['name']
						: null;
				const moving =
					bare === null ||
					site.carried.has(bare) ||
					walk.runeOf(bare) !== undefined ||
					dynamic.has(bare) ||
					expand(callee) === bare;
				if (settledName !== null && snippets.get(settledName)?.declared === true) {
					const where = span(callee);
					if (where !== null) {
						edits.push([where[0], where[1], stillDynamic(settledName, moving)]);
					}
					name = settledName;
				} else {
					// A callee the request decides can only be the snippet the source names: the payload
					// carries data and no function, so a snippet never comes off the wire. Unlike a
					// `<svelte:component>` there is no second outcome to write a block for --
					// `RenderTag.js` emits `snippet($$renderer, ...)`, a plain call, so a value that is
					// not a function throws rather than rendering nothing. See spec/payload.md.
					const through = new Set<string>();
					const only = candidateOf(
						callee,
						walk,
						through,
						(held) => snippets.get(held)?.declared === true,
					);
					const where = only === null ? null : span(callee);
					if (only !== null && where !== null) {
						for (const held of through) site.stood.add(held);
						edits.push([where[0], where[1], stillDynamic(only, moving)]);
						name = only;
					}
				}
			}

			// Markup the caller wrote inside this component's tag. Walked here, where the child
			// renders it, in the scope it was written in.
			const handed = name === null ? undefined : site.given.get(name);
			if (handed !== undefined) {
				const given = isNode(call) && Array.isArray(call['arguments']) ? call['arguments'] : [];
				// A `{#snippet x(n)}` written inside the tag has names for them, and they are bound the
				// way a `let:` binds a slot's props -- the other way round, the component naming the
				// value and the caller naming the parameter. A group written as plain markup has no
				// name to give an argument to and stays refused.
				const parameters = handed.parameters;
				if (given.length > 0 && parameters === undefined) {
					refuse(
						`\`{@render ${name}()}\` is called with arguments, and what it renders was written ` +
							'at the call site, which has no name to give them to',
					);
				}
				// An argument that is a snippet **this component** declares has no name in the caller's
				// markup: the body would read it where nothing binds it. Refused here, inside the
				// child's walk, so the tag rolls back and Svelte renders the component as before.
				if (
					parameters !== undefined &&
					given.some((one) =>
						[...snippets].some(
							([held, what]) => what.declared && mentions(expand(one), new Set([held])),
						),
					)
				) {
					refuse(
						`\`{@render ${String(name)}()}\` passes a snippet this component declares to one ` +
							"the caller wrote, and the caller's markup has no name for it",
					);
				}
				const bound =
					parameters === undefined
						? new Map<string, string>()
						: new Map(
								parameterBinds(parameters, given, expand, () => `the snippet \`${String(name)}\``),
							);
				const inner: Locals['rewrite'] = (child, more) =>
					handed.expand(child, more === undefined ? bound : new Map([...bound, ...more]));
				for (const child of handed.nodes) {
					collect(child, {
						...walk,
						source: handed.source,
						edits: handed.edits,
						expand: bound.size === 0 ? handed.expand : inner,
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
				// A snippet is a value. `RenderTag.js` visits the callee as an expression and calls it
				// with the renderer, so `{@render foo(1)}` is `foo($$renderer, 1)` and `foo` may be
				// anything: a store read, an import from another component's module script, a prop's
				// default. Where nothing in the call is the request's, the render evaluates it and
				// writes the bytes the walk would otherwise have had to reproduce, so it is left to
				// the render -- the same answer an inert spread already gets.
				//
				// A bare name that resolves nowhere is not one of those: `{@render children()}` with
				// no `children` in scope reached Svelte's renderer and failed there with `children is
				// not a function`, which is the author's mistake reported in the wrong place.
				const callee = isNode(call) ? call['callee'] : undefined;
				const bare =
					isNode(callee) && callee['type'] === 'Identifier' && typeof callee['name'] === 'string'
						? callee['name']
						: null;
				const known = bare === null || site.carried.has(bare) || expand(callee) !== bare;
				const called = isNode(call) ? expand(call) : null;
				// Asked of what the render is given, which on this path is the author's own text: the
				// tag is left exactly as written and Svelte compiles it. Asked of the expansion, a
				// `{@render $s()}` over a store this file makes reads as the request's, because
				// `$$get_store` is a helper this walk put there and no expression naming one can go
				// back to the render. Nothing of that expansion reaches anything here, so the question
				// is the author's. See spec/derivation.md.
				//
				// And the call is not the whole of what the render is left: it writes the body of
				// whichever snippet the value holds, and a body is walked at the tag that names it or
				// nowhere. See `inertBodies`.
				if (
					called !== null &&
					known &&
					site.payload !== null &&
					inertBodies(snippets, walk) &&
					!varies(called, walk, true)
				)
					return;
				if (process.env['SEAM_TRACE'] !== undefined) {
					console.error(
						`[seam] render of ${String(name)} in ${site.file}: given ${JSON.stringify([...site.given.keys()])}, stack ${site.stack.map((one) => basename(one)).join(' > ')}`,
					);
				}
				// Two different questions wore one sentence. A name the call site supplied is composition
				// in the other direction and says so. A name this file writes and this compiler cannot
				// follow to a `{#snippet}` is not that at all: `let snippet = writable(hello)` read as
				// `{@render $snippet()}` names a snippet the file declares, through a store, and
				// `createRawSnippet(...)` names a function that is not a `{#snippet}` at all. Saying
				// either of those came from the call site was untrue about the author's own file.
				// A bare name nothing in this file binds arrived from outside, which is the call site.
				// A name the file does bind and this compiler cannot follow to a `{#snippet}` is the
				// other question, and `declared: false` does not tell them apart: the record exists
				// because a render was seen, not because anything declares it.
				if (!known) {
					refuse(
						`\`{@render ${String(name)}()}\` in ${basename(site.file)} of a snippet this ` +
							'component does not declare is not handled yet: the snippet comes from the call ' +
							'site, which is composition in the other direction',
					);
				}
				refuse(
					`\`{@render ${String(name)}()}\` in ${basename(site.file)} names no \`{#snippet}\` this ` +
						'compiler can follow it to, and the call reads something the request decides, so ' +
						'the render cannot be left to evaluate it either. `RenderTag.js` visits the callee ' +
						'as an expression, so it may be any value; what this follows is a name, a default ' +
						'and a lookup in a table the source writes out. It stands for ' +
						`\`${String(called ?? name)
							.replace(/\s+/g, ' ')
							.slice(0, 160)}\``,
				);
			}
			// A snippet that renders itself is a fragment the runtime calls: its body is walked once
			// with its parameters as names bound per call, the way an each's item is bound per
			// iteration, and every `{@render}` of it -- the one inside its body included -- is a call
			// of that fragment with the arguments as what the parameters are bound to. The body is
			// rendered once, at the first call outside it, where it is wrapped as a bare block so the
			// assembler can find it; every other call renders a stand-in snippet whose whole body is
			// the hole's marker, so that Svelte still writes what it writes around a render tag. See
			// spec/ir.md.
			if (recurses(one)) {
				const declaration = one.node;
				if (declaration === undefined) refuse(`the snippet \`${String(name)}\` has no declaration`);
				const parameters = Array.isArray(declaration['parameters'])
					? declaration['parameters']
					: [];
				const args = isNode(call) && Array.isArray(call['arguments']) ? call['arguments'] : [];
				// A parameter that is a pattern binds the names inside it, each reached from the
				// argument the way a destructured declaration is, and those names are what the
				// fragment takes: the runtime binds names, and a pattern is so many names.
				const what = (): string => `the snippet \`${String(name)}\``;
				const binds = parameterBinds(parameters, args, expand, what);
				const params = binds.map(([each]) => each);
				const whole = span(node);
				const declared = span(declaration);
				if (whole === null || declared === null) return;
				const inside = whole[0] > declared[0] && whole[1] < declared[1];
				const known = site.fragments.get(String(name));
				if (inside || known !== undefined) {
					if (known === undefined)
						refuse(`the snippet \`${String(name)}\` renders itself before anything renders it`);
					standIn(walk, whole, known, binds);
					return;
				}
				const index = blocks.length;
				const fragment = `__f${String(index)}`;
				blocks.push({
					index,
					kind: 'if',
					stream,
					expression: 'true',
					tests: ['true'],
					item: null,
					counter: null,
					alternate: false,
					within: [...within],
					bare: true,
					fragment: { name: fragment, params, binds },
				});
				site.fragments.set(String(name), fragment);
				if (opensWithText(declaration['body'])) blocks[index]!.fragment!.textFirst = true;
				// The arguments are written out: the body's expressions are markers, and a parameter
				// that destructures needs something to come apart from. What it comes apart from is
				// empty, so a default inside the pattern would be evaluated, against data the render
				// is not given; the runtime takes the default per call, so the render takes nothing.
				for (const [at, argument] of args.entries()) {
					const where = span(argument);
					if (where !== null) edits.push([where[0], where[1], one.holds[at] ?? 'null']);
				}
				for (const parameter of parameters) {
					// The parameter's own default is left alone: the runtime takes it per call, and the
					// render is handed something the pattern accepts. What is inside it is not.
					neutralise(
						isNode(parameter) && parameter['type'] === 'AssignmentPattern'
							? parameter['left']
							: parameter,
						edits,
					);
				}
				const after =
					parameters.length > 0
						? span(parameters[parameters.length - 1])
						: span(declaration['expression']);
				const open = after === null ? -1 : source.indexOf('}', after[1]) + 1;
				const close = declared[1] - '{/snippet}'.length;
				if (open <= 0 || !source.endsWith('{/snippet}', declared[1])) {
					refuse(
						`the snippet \`${String(name)}\` is written in a way this compiler cannot read the body of`,
					);
				}
				edits.push([open, open, '{#if true}']);
				const [from, to, text] = stamped(walk, index, source, close);
				edits.push([from, to, `{/if}${text}`]);
				within.push([index, 0]);
				collect(declaration['body'], { ...walk, dynamic: new Set([...dynamic, ...params]) });
				within.pop();
				// A snippet writes no head of its own, so one found inside it came from a component,
				// after the calls were written. See `headedFragment()`.
				if (site.headed.has(index)) headFoundLate(`the snippet \`${String(name)}\``);
				return;
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
			const given = isNode(call) && Array.isArray(call['arguments']) ? call['arguments'] : [];
			const bound = new Map<string, string>();
			for (const [index, parameter] of parameters.entries()) {
				if (!isNode(parameter)) refuse('a `{#snippet}` parameter this compiler cannot read');
				// The pattern stays for the render, over what the call was replaced by, so nothing in
				// it may evaluate. The parameter's own default is left alone for the reason the
				// fragment half gives.
				neutralise(
					parameter['type'] === 'AssignmentPattern' ? parameter['left'] : parameter,
					edits,
				);
				// An argument not written is `undefined`, which is what the function receives and
				// what a default answers to. This call's arguments, not the ones recorded against the
				// name written at the tag: a callee that settled names a different snippet, and the
				// record it settled to holds the calls of *its* name -- none, where nothing calls it
				// by name. `{@render snippet({ count })}` over a `$derived` of two snippets is that,
				// and the parameter came apart from `undefined`.
				const argument = index < given.length ? expand(given[index]) : 'undefined';
				for (const [each, reached] of takenApart(
					parameter,
					`(${argument})`,
					expand,
					() => `the snippet \`${String(name)}\``,
				)) {
					bound.set(each, reached);
				}
			}

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
			let asking = false;

			const expression = expand(node['expression']);
			const test = `typeof (${expression})?.then === 'function'`;
			const kind = isNode(value) ? value['type'] : undefined;
			const holds = kind === 'ObjectPattern' ? '{}' : kind === 'ArrayPattern' ? '[]' : 'null';
			// The then branch, with the value bound: `then_fn(promise)` is called with what was
			// awaited, which was never a promise on this branch, so the value substitutes the way a
			// snippet's parameter does.
			const resolved = (): Walk => {
				if (isNode(value)) neutralise(value, edits);
				const bound = isNode(value)
					? takenApart(value, `(${expression})`, expand, () => 'this await')
					: new Map<string, string>();
				const inner: Locals['rewrite'] = (child, more) =>
					expand(child, more === undefined ? bound : new Map([...bound, ...more]));
				return { ...walk, expand: inner };
			};

			// A test the request does not decide is the render's to answer, the way an if's is, and
			// the answer holds for every request rather than for this render: `{#await p}` over
			// `let p = Promise.resolve(...)` writes the pending branch always, and the then branch is
			// markup nobody reaches. Walked as a decision it was rendered anyway, against the promise
			// itself, and `cards.filter` on one threw. See spec/derivation.md.
			if (
				site.payload !== null &&
				walk.asking !== true &&
				!varies(test, walk, true) &&
				!site.mute.has(test)
			) {
				const answer = site.decided.get(test);
				if (answer === true) {
					edits.push([at[0], at[1], 'Promise.resolve()']);
					if (isNode(waiting)) step(waiting);
					buried(walk, then);
					return;
				}
				if (answer === false) {
					if (isNode(then)) collect(then, resolved());
					buried(walk, waiting);
					return;
				}
				// Asked as the author wrote it, since the expansion may name what only this walk holds.
				if (!site.asks.some(([key]) => key === test)) {
					const written = `typeof (${source.slice(at[0], at[1])})?.then === 'function'`;
					site.asks.push([test, written]);
				}
				// And the branches are walked as a decision until the answer is in, which is what
				// stops a block inside one asking a question of its own: an ask is a statement in the
				// script and runs whatever branch the render takes, so `{#each cards.filter(...)}`
				// under a `{:then}` nobody reaches was evaluated against the promise.
				asking = true;
			}

			const index = blocks.length;
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
			const opening = chose(walk, edits, at[0], at[1], index, 0, 'Promise.resolve()', holds);
			// Which block just closed, written where the render puts it and nowhere else.
			const closer = edits.length;
			edits.push(stamped(walk, index, source, whole[1]));

			if (isNode(waiting)) {
				within.push([index, 0]);
				collect(waiting, asking ? { ...walk, asking: true } : walk);
				within.pop();
			}
			if (isNode(then)) {
				within.push([index, -1]);
				collect(then, asking ? { ...resolved(), asking: true } : resolved());
				within.pop();
			}
			// The catch branch is left as written and never walked: the server never writes it, so
			// nothing planted there would come back.
			// A head inside it has the block stand in the head stream. Its pending branch is the one
			// place a `{@const}` is not allowed, so the open goes around the expression instead,
			// which runs once before either branch: both are opened by it. See `headOpensWith()`.
			if (site.headed.has(index)) {
				const mirror = mirrored(walk, index, closer, []);
				rewrapped(walk, opening, (text) => headOpensWith(mirror, text));
			}
			return;
		}

		case 'SvelteBoundary': {
			// Read out of `3-transform/server/visitors/SvelteBoundary.js`. On the server a boundary
			// is one shape, not a decision: `<!--[-->`, its children, `<!--]-->` -- or, given a
			// `pending` snippet, `<!--[!-->`, that snippet's body, `<!--]-->` and none of the
			// children, because a synchronous render is pending by definition. So there is no block
			// here. The anchors are a pair the assembler copies as bytes, the way it copies a
			// package component's own, and what is inside them is walked as anything else is.
			//
			// **The `failed` snippet is a decision where the body calls over a request value.** Svelte
			// catches what the body throws and writes that snippet instead, and a marker stands for
			// a value the request brings -- so whether it throws is the request's answer, and which
			// of the two shapes is written is not one shape. It threw at injection instead, which
			// is a refusal arriving per request: `<svelte:boundary><p>{search(query)}</p>` with
			// `search` throwing is four of Svelte's samples. Where nothing in the body is a marker
			// the render's own answer is the request's, and that stays. See spec/refusals.md.
			// `pending={p}` and `failed={f}` were written as the tag form before this walk read the
			// file, or refused there. See `boundaries()` in snippets.ts.
			const fragment = node['fragment'];
			const children =
				isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
			const pendingSnippet = children.find((child) => snippetNamed(child, 'pending'));
			// The failed snippet **stays** in the rendered source. `renderer.boundary` rethrows where
			// `props.failed` is missing, so taking it out is what let a throw the boundary exists to
			// catch escape the render -- measured, four of Svelte's samples reported the author's own
			// error message as a compile failure. It is declared with a parameter and never rendered
			// here, which the walk refuses about a body nobody writes; that refusal skips it by name
			// instead, since Svelte is the one that calls it.
			const failedSnippet = children.find((child) => snippetNamed(child, 'failed'));
			if (pendingSnippet !== undefined) {
				step(pendingSnippet['body']);
				return;
			}
			const before = holes.length;
			for (const child of children) {
				if (child === failedSnippet) continue;
				step(child);
			}
			// Walked with the boundary in scope, so the refusal about a snippet nothing renders knows
			// this one is Svelte's to call.
			if (failedSnippet !== undefined) {
				collect(failedSnippet, { ...walk, boundary: true });
			}
			// A call over a value the request brings, not any marker. `{data.a}` reads the payload and
			// cannot throw in the way the snippet is there for, and refusing it would refuse the
			// ordinary boundary; `{search(query)}` runs the author's code over what the request sent,
			// which is where the throw the snippet catches comes from.
			const throws = holes
				.slice(before)
				.some((one) => /[\w$)\]]\s*\(/.test(one.expression) && mentions(one.expression, dynamic));
			if (children.some((child) => snippetNamed(child, 'failed')) && throws) {
				refuse(
					'a `<svelte:boundary>` with a `failed` snippet, whose body calls something over a value ' +
						'the request brings. Svelte writes that snippet instead of the body where the body ' +
						"throws, so which of the two shapes reaches the bytes is the request's answer " +
						'rather than one shape. See spec/refusals.md',
				);
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
			// A `?:` in a test whose branches a marker cannot stand for -- one choosing between two
			// icon components on a payload key -- is a structure, and is enumerated the way one
			// handed to a package is: the walk stops and asks, and the build renders once per
			// branch. Told, the test is what the branch leaves, and the request may no longer
			// decide it, in which case the render does. See `stands`.
			const tests = chain.map((one) => settled(expand(one['test']), walk));

			// A test the source has already decided is not a question for anybody, and folding it
			// here is what keeps the walk out of a branch that is never written. See `constantly()`.
			const settledAt = reached(tests.map((one) => constantly(one)));
			if (settledAt !== null) {
				oneBranch(walk, chain, tests, settledAt, otherwise, edits, step);
				return;
			}

			// A block whose every test the request does not decide is decided once, by the render,
			// and is bytes: the branch it takes, between anchors the assembler copies as it copies
			// a package's own. Nothing in it is asked for per request -- which is what press's
			// newsletter needed, its branches turning on client state a library computes inside a
			// render and nowhere else. The walk is not told the answer the first time through, so
			// it asks: the render reports the value and the walk runs again told. Until then the
			// block is walked as a decision so that the render it is asked of can be made.
			let branches: Walk = walk;
			if (
				site.payload !== null &&
				walk.asking !== true &&
				tests.every((test) => !varies(test, walk, true) && !site.mute.has(test))
			) {
				const answers = tests.map((test) => site.decided.get(test));
				const at = reached(answers);
				if (at !== null) {
					oneBranch(walk, chain, tests, at, otherwise, edits, step);
					return;
				}
				// One test at a time, in source order, and never past one whose answer is not in yet.
				// A chain is a sequence of tests Svelte evaluates until one is true, so a later test
				// is only reached where every earlier one was false -- and the ask is written into the
				// script, where it runs whatever branch the render takes. Asked all at once,
				// `{#if $foo}blah{:else if bar()}` evaluated `bar()` for a chain whose first test is
				// true, and `bar` is a name that sample never binds.
				for (const [index, test] of tests.entries()) {
					if (answers[index] === false) continue;
					if (!site.asks.some(([key]) => key === test)) {
						site.asks.push([test, asWritten(chain[index]?.['test'], test, walk)]);
					}
					break;
				}
				branches = { ...walk, asking: true };
			}

			const index = blocks.length;
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
			// What a binding inside this block settles is read against the tests as they stand where
			// the block is walked, which is the pass's own source order. See `Site.tested`.
			if (site.sends.size > 0) {
				site.tested.set(
					index,
					chain.map((one, at) => expand(one['test'], new Map(site.sends)) || (tests[at] ?? '')),
				);
			}

			for (const [branch, one] of chain.entries()) {
				const at = span(one['test']);
				const held = tests[branch] ?? '';
				if (at !== null) {
					chose(
						walk,
						edits,
						at[0],
						at[1],
						index,
						branch,
						awaited(held, 'true'),
						awaited(held, 'false'),
					);
				}
			}

			// Which block just closed, written where the render puts it and nowhere else.
			const whole = span(node);
			const closer = edits.length;
			if (whole !== null) edits.push(stamped(walk, index, source, whole[1]));

			// Only the first branch is in the baseline render, so only its blocks are numbered where
			// the assembler counts them. A block in any other branch is numbered here and appears in
			// a render nobody counts, which is the two lists coming apart. See spec/refusals.md.
			for (const [branch, one] of chain.entries()) {
				within.push([index, branch]);
				collect(one['consequent'], branches);
				within.pop();
			}
			if (isNode(otherwise)) {
				within.push([index, -1]);
				collect(otherwise, branches);
				within.pop();
			}
			// A head was walked inside it, so the block stands in the head stream too, opened at
			// the start of every branch that holds anything.
			if (site.headed.has(index)) {
				mirrored(walk, index, closer, [
					...chain.map((one) => afterTag(source, span(one['test']))),
					...(isNode(otherwise) ? [afterElse(source, otherwise)] : []),
				]);
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

			const index = blocks.length;
			// A destructuring binds names out of the element rather than the element, and the block
			// binds the element under a name of its own: `$$` is Svelte's reserved prefix, so no
			// author's name is shadowed, and the block's number is on it, so no two of them collide
			// where one each sits inside another. Each name the pattern binds is then an expression
			// over that one, taken apart the way a snippet's parameter is -- so a member stays a
			// path the injector resolves per item, and everything else is a derivation over the
			// binding, which is what a derivation reading an each's name already is.
			const held = `$$item${String(index)}`;
			// What the block binds stands for itself and not for a declaration of the same name.
			// Svelte's server writes `let a = each_array[i]` inside the loop, which shadows the `let
			// a` in the instance script the way any block-scoped declaration does, and
			// `{#each a as a}` wrote the array's own initialiser at every read without it.
			const apart = new Map<string, string>();
			if (
				isNode(pattern) &&
				pattern['type'] === 'Identifier' &&
				typeof pattern['name'] === 'string'
			) {
				apart.set(pattern['name'], pattern['name']);
			}
			if (typeof node['index'] === 'string') apart.set(node['index'], node['index']);
			if (destructured && isNode(pattern)) {
				// The pattern stays in the render, over the one element it iterates, so nothing in it
				// may evaluate. A default is JavaScript's, read out of `EachBlock.js`: the server
				// writes `let { id = d } = each_array[i]`, so the name is the member where that is not
				// `undefined` and the default where it is, and `null` is not defaulted.
				neutralise(pattern, edits);
				for (const [name, reached] of takenApart(
					pattern,
					held,
					expand,
					() => "this each block's pattern",
				)) {
					apart.set(name, reached);
				}
			}

			// A source the request does not decide is iterated per request all the same, so the
			// runtime has to hold it -- as the value, never as the computation: press's counter
			// takes its digits from a query a library computes inside a render and nowhere else.
			// The render is asked for the value as JSON, and the walk runs again told, with the
			// literal where the expression was. See spec/refusals.md.
			let written = expand(node['expression']);
			// Whether it awaits is read before the render's answer replaces it: the answer is the
			// value, and the value is not a promise. What decides the anchors is the expression the
			// source held. See `awaited()`.
			const awaits = written;
			if (
				site.payload !== null &&
				walk.asking !== true &&
				!constant(written) &&
				!varies(written, walk) &&
				!site.mute.has(written)
			) {
				const held = site.told.get(written);
				if (held === undefined) {
					if (!site.wants.some(([key]) => key === written)) {
						site.wants.push([written, asWritten(node['expression'], written, walk)]);
					}
				} else {
					written = held;
				}
			}
			blocks.push({
				index,
				kind: 'each',
				within: [...within],
				stream,
				expression: written,
				// A block with no `as` still binds: `EachBlock.js` writes the `for` loop either way and
				// only skips `let <context> = each_array[i]` where there is no context to bind. So the
				// item is the block's own name, which nothing reads, rather than nothing at all --
				// the IR's `each` binds a name per iteration and has no shape for binding none.
				item: destructured || context === null ? held : source.slice(context[0], context[1]),
				counter: typeof node['index'] === 'string' ? node['index'] : null,
				alternate: fallback !== null && fallback !== undefined,
			});
			// The key's expression goes from the render and the key itself stays. Svelte's server
			// never reads a key -- `EachBlock.js` visits the expression, the context, the index, the
			// body and the fallback, and not `node.key` -- so what it holds cannot reach the bytes;
			// but the one element the render iterates is a placeholder the key would be evaluated
			// against, and `(tile.stat.lang)` on `{}` threw inside Svelte's own output.
			//
			// Removing the whole `(...)` unkeyed the block, which is not the same markup. An
			// `animate:` element must be the only child of a **keyed** each, and
			// `2-analyze/visitors/shared/element.js` asks `parent.key` for exactly that, so the
			// render's copy failed Svelte's own analysis with `animation_missing_key` -- upstream's
			// message, on upstream's own sample, which cannot be upstream's fault. A literal keeps
			// the block keyed, reads nothing, and cannot throw.
			const key = span(node['key']);
			if (key !== null) edits.push([key[0], key[1], '0']);
			// One element, because the body's own expressions are sentinels and read nothing from it.
			// An each with an `{:else}` is two shapes the way an if is: Svelte's server writes
			// `<!--[-->` and the items for a list with something in it, and `<!--[!-->` and the
			// fallback for one with nothing, so the fallback gets a render of its own, from an empty
			// list, the way an else does. See spec/refusals.md.
			chose(
				walk,
				edits,
				at[0],
				at[1],
				index,
				0,
				awaited(awaits, `[${element}]`),
				awaited(awaits, '[]'),
			);
			// Which block just closed, written where the render puts it and nowhere else.
			const whole = span(node);
			const closer = edits.length;
			if (whole !== null) edits.push(stamped(walk, index, source, whole[1]));
			// What the block binds is decided per item, so an expression reading it is a marker
			// even when nothing else in it reaches the payload.
			const inside = new Set(dynamic);
			namesIn(pattern, inside);
			inside.add(held);
			if (typeof node['index'] === 'string') inside.add(node['index']);
			const body: Locals['rewrite'] =
				apart.size === 0
					? expand
					: (child, more) =>
							expand(child, more === undefined ? apart : new Map([...apart, ...more]));
			// What this block binds, for a component tag that names it. The expression rather than the
			// render's answer: a list of components is not data and the render answers nothing for it.
			const named = destructured || context === null ? null : source.slice(context[0], context[1]);
			const bound =
				named === null || !IDENTIFIER.test(named)
					? walk.items
					: new Map([...walk.items, [named, awaits]]);
			within.push([index, 0]);
			collect(node['body'], { ...walk, dynamic: inside, expand: body, items: bound });
			within.pop();
			if (isNode(fallback)) {
				within.push([index, -1]);
				step(fallback);
				within.pop();
			}
			// A head was walked inside it, so the block stands in the head stream too: opened per
			// item, after the whole of the opening tag, and in the fallback where there is one.
			if (site.headed.has(index)) {
				const tag: [number, number] = [at[0], Math.max(at[1], context?.[1] ?? 0, key?.[1] ?? 0)];
				mirrored(walk, index, closer, [
					afterTag(source, tag),
					...(isNode(fallback) ? [afterElse(source, fallback)] : []),
				]);
			}
			return;
		}

		// A spread on a component the walk could not enter. Its keys are the child's props, and
		// `build_inline_component` merges it with `$.spread_props` in source order, so what the
		// render needs is the object itself with the request's values standing in it.
		//
		// A marker is a string and spreading a string spreads its characters, so the object has to
		// be one whose leaves can each hold one. `leaves` is the same reading an attribute's object
		// value already gets. Where the object itself is what the request decides there is nothing
		// to put a marker inside, and that is refused by name rather than written wrong.
		case 'SpreadAttribute': {
			const whole = span(node);
			if (whole === null) return;
			const grown = expand(node['expression']);
			subscribing(grown, walk);
			const varying = site.payload !== null && (carries(grown) || mentions(grown, walk.dynamic));
			const text = varying ? leaves(grown, walk) : grown;
			if (text === null) {
				refuse(
					`\`{...${grown.slice(0, 40)}}\` is a spread on a component the walk could not enter, ` +
						'over a value the request decides: its keys cannot be listed, so nothing can stand ' +
						'in the object while the bytes are written',
				);
			}
			edits.push([whole[0], whole[1], `{...${text}}`]);
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

/** The key `merged()` binds a child's rest under, which no attribute can be named. */
const REST = '...';

/**
 * What a call site's spreads leave for each prop the child declares, where a spread's keys are
 * the request's and cannot be listed.
 *
 * `spread_props` in `internal/server/index.js` merges the attributes and the spreads in order,
 * each own enumerable key of a later object overriding an earlier one's -- with `undefined` as
 * much as with a value, since it is the key's presence that decides -- and skips an object that
 * is null. The child reads the props its `$props()` names, so each of those is the fold of the
 * parts in order: an attribute naming it is its value from there on, and a spread is its own
 * value where it has the key and the value so far where it does not. A prop nothing names stays
 * unbound, so the child's default answers. The rest, where the child gathers one, is every key
 * the merge holds that the pattern does not name, which is the merge itself with those taken out.
 * Everything here is an expression over the request, evaluated per request as any derivation is.
 */
function merged(
	order: readonly ({ name: string } | { spread: string })[],
	declares: readonly { local: string; prop: string; fallback: string; rest?: true }[],
	bindings: Map<string, string>,
): void {
	const named = declares.filter((one) => one.rest !== true).map((one) => one.prop);
	for (const prop of named) {
		const key = JSON.stringify(prop);
		let value = 'undefined';
		let touched = false;
		for (const part of order) {
			if ('name' in part) {
				if (part.name === prop) value = bindings.get(prop) ?? 'undefined';
				continue;
			}
			touched = true;
			value =
				`(${part.spread} != null && Object.prototype.hasOwnProperty.call(${part.spread}, ${key}) ` +
				`? ${part.spread}[${key}] : ${value})`;
		}
		if (touched) bindings.set(prop, value);
	}
	if (!declares.some((one) => one.rest === true)) return;
	const sources = order.map((part) =>
		'spread' in part
			? part.spread
			: `({ ${JSON.stringify(part.name)}: ${bindings.get(part.name) ?? 'undefined'} })`,
	);
	const taken = named.map((prop, at) => `[${JSON.stringify(prop)}]: __seam_named_${String(at)}`);
	bindings.set(
		REST,
		`((({ ${[...taken, '...__seam_rest'].join(', ')} }) => __seam_rest)(Object.assign({}, ${sources.join(', ')})))`,
	);
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
/**
 * The literal the render is handed for a prop whose value this walk models.
 *
 * `null` for nearly all of them: the value is never written into the bytes, so it only has to
 * survive being evaluated. Where the child reads the name as the object of a member expression it
 * does not survive -- `<slot width={box.width}>` on a `null` threw, and the value it would have
 * computed is one the walk had already read for itself. An empty object survives the read and
 * answers `undefined`, which is what a marker would have stood for anyway.
 */
function standsIn(ast: AstNode, local: string | undefined): string {
	if (local === undefined) return 'null';
	let member = false;
	const step = (one: unknown): void => {
		if (member) return;
		if (Array.isArray(one)) {
			for (const each of one) step(each);
			return;
		}
		if (!isNode(one)) return;
		if (one['type'] === 'MemberExpression') {
			const object = one['object'];
			if (isNode(object) && object['type'] === 'Identifier' && object['name'] === local) {
				member = true;
				return;
			}
		}
		for (const value of Object.values(one)) step(value);
	};
	step(ast['fragment']);
	return member ? '{}' : 'null';
}

function descend(
	node: AstNode,
	walk: Walk,
	/** A dynamic component settled to one import: the import's name, and the `this` span. */
	dynamic?: {
		name: string;
		expression: [number, number] | null;
		rewritten?: (fresh: string) => void;
	},
): boolean {
	const tag = dynamic?.name ?? (typeof node['name'] === 'string' ? node['name'] : '');
	const file = componentFile(tag, walk);
	// Nothing this walk can find a file for -- a name bound some other way, a package whose chain
	// of re-exports ends in something that is not a component -- is Svelte's to render, as before.
	if (file === null) return false;
	if (walk.site.stack.includes(file)) {
		// A component rendering itself, entered as the fragment it is: this call is a call of that
		// fragment, standing in for a render that would otherwise not end. Its own file, or one up
		// the stack that renders this one -- every component on a cycle was entered as a fragment,
		// because `reachesItself` read the cycle before the walk went in. See spec/ir.md.
		const fragment = walk.site.callable.get(file);
		if (fragment !== undefined) {
			const source = file === walk.site.file ? walk.source : readFileSync(file, 'utf8');
			selfCall(node, walk, tag, fragment, source, dynamic);
			return true;
		}
		refuse(
			`<${tag} /> is part of a cycle -- ${[...walk.site.stack, file]
				.map((one) => basename(one))
				.join(' -> ')} -- and a compile-time render of one does not end`,
		);
	}

	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	const fragment = node['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	// A `{#snippet}` inside the tag arrives under its own name and is a group of the caller's like
	// any other -- `hands()` reads it that way, and the component renders it with arguments of its
	// own, which its parameters name. This used to turn the whole tag away.

	// `let:` puts the markup in `$$slots` instead, on a different path through the visitor.

	// What the call site passes, as expressions in the caller's own terms. A handler is bound to
	// null: it is never called while the bytes are written, and leaving it unbound would make the
	// child read a name nothing binds.
	const bindings = new Map<string, string>();
	/**
	 * The props the caller wrote as a bare name, which is what a hold is asked about.
	 *
	 * A name is a read of something the caller already has; an expression written at the tag makes
	 * its value there and hands the child that one. Only the first crosses the boundary as a read,
	 * and only a read of something that **makes** is held. See `held()` below and
	 * spec/derivation.md.
	 */
	const byName = new Set<string>();
	/**
	 * The props whose expression awaits, by name.
	 *
	 * Read before the render's answer replaces the expression: the answer is the value, and the
	 * value is not a promise. What decides whether Svelte wraps this tag in a `child_block` is the
	 * expression the source held. See `awaited()`.
	 */
	const awaits = new Set<string>();
	/** The props the call site binds, whose value the child may send back. See below. */
	const boundProps = new Set<string>();
	/** A binding's getter, kept until every attribute and spread has been placed. See below. */
	const delayed: [string, string][] = [];
	/** The name each binding's getter is written as, which is what its setter assigns to. */
	const boundTo = new Map<string, string>();
	// The props whose caller expression varies with nothing the request decides. The render is
	// handed these as written, so the child's script gets what Svelte's own render would give it:
	// a query client to set as context, a store, a function -- values that are not data and could
	// not be told as JSON, and that a child's markup never writes but its script may need whole.
	const inertProps = new Set<string>();
	// The call site's attributes and spreads in the order `$.spread_props` merges them, kept where
	// a spread's keys cannot be listed: a name for an attribute or a listed key, an expression for
	// a spread whose keys are the request's. See `merged()`.
	const order: ({ name: string } | { spread: string; at: [number, number] | null })[] = [];
	for (const one of attributes) {
		// An attachment is in the props and nothing on the server calls it.
		if (isNode(one) && one['type'] === 'AttachTag') continue;
		// `{...props}` is `$.spread_props`, the props merged in order, and a call site knows the
		// keys exactly when the object is written out -- which a rest gathered from a caller's own
		// attributes is, once expanded. Then it is so many props. An object the request hands over
		// whole has keys nobody can list, but the child's declaration lists which it reads, and each
		// of those is the value the merge leaves for it; the rest is the merge without them. Both
		// are decided once the child is read, below.
		if (isNode(one) && one['type'] === 'SpreadAttribute') {
			const grown = walk.expand(one['expression']);
			const entries = objectEntries(grown);
			if (entries === null) {
				order.push({ spread: `(${grown})`, at: span(one) });
				continue;
			}
			for (const [key, value] of entries) {
				bindings.set(key, key.startsWith('on') && key.length > 2 ? 'null' : `(${value})`);
				order.push({ name: key });
			}
			continue;
		}
		// A `bind:` on a component, left as written by `unbind.ts` because it is a getter and a
		// setter rather than an attribute. The getter is what the child is given, and is read the
		// way the attribute would have been; the setter is what `bound` is collected for, checked
		// against the child's own declaration once that is in hand below.
		// Not a prop: `let:` names what the component supplies to a slot, which `hands()` read off
		// the tag when it grouped the caller's markup. `build_inline_component` puts it in the slot
		// function's parameter and passes nothing for it.
		if (isNode(one) && one['type'] === 'LetDirective') continue;
		// An event listener on a component is not a prop either, and the server does nothing with
		// it: `build_inline_component`'s loop has an arm for a `let:`, a spread, an attribute, a
		// `bind:` and an attachment, and nothing else -- an `OnDirective` falls past all of them
		// and contributes no property. Leaving the walk out of the child over one was silent, and
		// it is the ordinary way a legacy component is listened to: `<Todo {todo} on:click={...} />`
		// handed the child a marker where its prop was.
		if (isNode(one) && one['type'] === 'OnDirective') continue;
		if (isNode(one) && one['type'] === 'BindDirective') {
			const name = typeof one['name'] === 'string' ? one['name'] : '';
			boundProps.add(name);
			// Held back rather than placed here. `shared/component.js` pushes a binding's getter and
			// setter with `push_prop(..., true)`, whose comment says why: "Delay prop pushes so
			// bindings come at the end, to avoid spreads overwriting them." So a spread written
			// after a binding does not win, and both the merge order and the map have to say so.
			delayed.push([name, `(${walk.expand(getterOf(one, walk.source))})`]);
			// The name as written, which is what the setter assigns to. The expansion beside it is
			// the value it holds now; the two are different things and `settles` needs both.
			const where = span(getterOf(one, walk.source));
			if (where !== null) boundTo.set(name, walk.source.slice(where[0], where[1]));
			continue;
		}
		if (!isNode(one) || one['type'] !== 'Attribute') return false;
		const name = typeof one['name'] === 'string' ? one['name'] : '';
		order.push({ name });
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
		// Text and an expression together, which `build_attribute_value` writes as a template: the
		// text goes in raw -- for a component it is not escaped -- and each expression that is not
		// statically known goes in through `$.stringify`, which is `typeof v === 'string' ? v : v ==
		// null ? '' : v + ''`. A value the analysis proves a defined string skips the call, which
		// makes no difference to what comes out, so every one of them goes through it here.
		//
		// The whole component used to be left to the render over one of these, and that is what
		// `component-data-dynamic` was: `qux='this is a {compound} string'` beside
		// `baz='{40 + x}'`, and the second is a *number* -- `value.length === 1` returns the
		// expression itself, quotes or no quotes -- so the child got a string and printed one.
		if (
			parts.length > 1 &&
			parts.every(
				(part) => isNode(part) && (part['type'] === 'Text' || part['type'] === 'ExpressionTag'),
			)
		) {
			const pieces = parts.map((part) =>
				(part as AstNode)['type'] === 'Text'
					? templated(String((part as AstNode)['data'] ?? ''))
					: `\${$$stringify(${walk.expand((part as AstNode)['expression'])})}`,
			);
			const grown = `\`${pieces.join('')}\``;
			if (walk.site.payload !== null && !varies(grown, walk)) inertProps.add(name);
			bindings.set(name, grown);
			continue;
		}
		if (parts.length !== 1 || !isNode(only) || only['type'] !== 'ExpressionTag') return false;
		if (isNode(only['expression']) && only['expression']['type'] === 'Identifier') byName.add(name);
		const grown = walk.expand(only['expression']);
		const written = `(${grown})`;
		if (walk.site.payload !== null && !varies(grown, walk)) inertProps.add(name);
		// A prop the request does not decide is bound to what the render computes for it rather
		// than to its expansion, where the render can say: the caller's script runs whole in the
		// render, so `const u = new URL(x); u.searchParams.set('q', y)` holds the query there and
		// the expansion of `u` does not. The render is asked, as it is asked for an each's source,
		// and answers with JSON where the value is data; anything else stays the expansion.
		// A literal is its own value and is not asked for; one no render could answer is not asked
		// again.
		if (
			walk.site.payload !== null &&
			walk.asking !== true &&
			!constant(grown) &&
			!walk.site.mute.has(written) &&
			!varies(grown, walk)
		) {
			const held = walk.site.told.get(written);
			if (held !== undefined) {
				if (awaiting(grown)) awaits.add(name);
				bindings.set(name, held);
				continue;
			}
			if (!walk.site.wants.some(([key]) => key === written)) {
				walk.site.wants.push([written, `(${asWritten(only['expression'], grown, walk)})`]);
			}
		}
		bindings.set(name, written);
	}

	// Last, which is where Svelte pushes them.
	for (const [name, value] of delayed) {
		order.push({ name });
		bindings.set(name, value);
	}

	// The caller's imports its expressions read, which the child's copy has to import too. A
	// prop's expression is expanded in the caller's scope and substituted into the child's, so
	// the child's rendered source and its derivations both read names the caller bound:
	// `href={URLS.site}` handed down is `URLS` inside the child, and the child never imported it.
	// A copy resolves its relative imports from where its original sits, so the caller's
	// specifier is resolved against the caller and written relative to the child. A name the
	// child binds itself to the same module is its own; to another is a collision that
	// JavaScript would not have had, and is said.
	const brought: Carried[] = [];
	const read = readsOf([
		...bindings.values(),
		...order.flatMap((part) => ('spread' in part ? [part.spread] : [])),
	]);
	for (const [local, one] of importedBy(walk.source)) {
		if (!read.has(local)) continue;
		if (!one.from.startsWith('.')) {
			brought.push(one);
			continue;
		}
		const target = resolvePath(dirname(walk.site.file), one.from);
		const moved = relative(dirname(file), target);
		brought.push({ ...one, from: moved.startsWith('.') ? moved : `./${moved}` });
	}

	// Where to roll back to. Everything below appends to lists the caller owns.
	const mark = {
		holes: walk.holes.length,
		blocks: walk.blocks.length,
		keeping: walk.keeping.length,
		edits: walk.edits.length,
		pending: walk.pending.length,
		copies: walk.site.copies.length,
		handed: walk.site.handed.length,
		spreads: walk.site.spreads.length,
		prelude: walk.site.prelude.length,
	};

	// Whether the child writes a head, which decides what a failure to enter it means below.
	let headed = false;
	try {
		const raw = inlined(unbound(readFileSync(file, 'utf8')));
		const clash = collides(raw, basename(file));
		if (clash !== null) refuse(clash);
		const ahead = parse(raw, { modern: true }) as unknown as AstNode;
		headed = contains(ahead['fragment'], 'SvelteHead');
		awaitless(ahead, `<${tag} />`);
		// Its number now, not when the tag is renamed: the walk below takes copies of its own, so
		// counting then gave a nested pair of the same component one name twice.
		const ordinal = walk.site.copies.length;
		// A `$props.id()` is a binding the runtime makes when it writes the anchor, named for this
		// copy so that two components declaring one in a page do not share it. The name is not one
		// the request decides: the render is handed the hole's marker as the id, so everything a
		// component computes from its id -- a package's state object, a derived attribute set -- is
		// inert and Svelte's to evaluate, and the marker lands in the bytes wherever the id went. A
		// derivation that reads the id all the same has the binding. See `fresh.ts`.
		const fresh = identified(ahead) ? `__i${String(ordinal + 1)}` : null;
		// The paths this render is fixed at, said in the child's own names. A prop bound to the
		// whole of one is that path inside the child; a prop bound to a prefix of one carries the
		// rest of it along. Without this a child would read `data.locale.code` as its own `data`,
		// which is a different value with the same spelling.
		// Every prop the child declares, bound to what the call site passes or to its own default.
		// A default only fires on `undefined`, which is what a prop the caller left out is.
		const declares = propsOf(ahead, raw);
		if (declares === null) return rolled(walk, mark);
		if (order.some((part) => 'spread' in part)) merged(order, declares, bindings);

		// What the child sends back up, which is the half of a binding that is not an attribute.
		// `bind_props` in `internal/server` assigns a prop back to the caller where the caller
		// passed `undefined` and its props object has a setter for the key, and the caller then
		// renders again -- so a child's default becomes the caller's value. Only a default can do
		// it: a prop the child assigns after declaring is refused where it is declared, and one
		// with nothing to send stays `undefined`, which `bind_props` skips.
		//
		// Whether it fires is `initial_value === undefined`, which is the request's answer wherever
		// the bound expression is the request's: `<Foo bind:x/>` in a component whose own `x` is a
		// prop writes the child's default for a request that sent nothing and the request's value
		// for one that did.
		//
		// **Leaving it to the render does not give the settled bytes, which was measured.** Svelte's
		// own `do { ... } while (!$$settled)` runs there and `subsume` keeps the last pass, but the
		// caller's name is substituted from this pass's model rather than read back out of those
		// bytes: `let bar; <Widget bind:bar/> {bar}` wrote nothing where Svelte wrote the child's
		// `42`. Two samples, both silent.
		//
		// **What settles it is a value rather than a structure.** After the iteration the caller's
		// name holds `expr === undefined ? <what the child sends> : expr`, which is one ternary per
		// bound prop and no second render at all. What it waits on is where the rebinding goes:
		// Svelte renders the **whole** parent template again, so it holds for reads written above
		// the tag as well, and the walk meets the tag half way through. See spec/roadmap.md.
		// A readonly export travels too. `transform-server.js` passes `analysis.exports` to
		// `$.bind_props` beside the bindable props, so `export const x = 42` in the child reaches a
		// caller that binds `x` exactly as a prop's default would -- and it is not in `propsOf`,
		// which reads `$props()` and the two legacy spellings of a prop, and not these.
		// `{children}` rather than `{@render children()}`: the prop holds the function Svelte compiled
		// the caller's markup into, and an expression tag writes its value, so what lands in the
		// bytes is that function's own source -- `($$renderer) => { $$renderer.push(...) }`, escaped.
		// That is Svelte's compiled output written out as text, which nothing here can stand for:
		// the marker would have to be the source of a function this compiler never produces.
		if (
			nodes.length > 0 &&
			declares.some((one) => one.prop === 'children') &&
			reads(ahead, 'children')
		) {
			refuse(
				`<${tag} /> reads \`children\` as a value rather than rendering it, and Svelte writes ` +
					"the function it compiled the caller's markup into -- its own source, escaped, into " +
					'the bytes. Write `{@render children()}`. See spec/refusals.md',
			);
		}
		/**
		 * Whether the caller's markup can read a name while the bytes are written.
		 *
		 * `transform-server.js` wraps only `template.body` in `do { ... } while (!$$settled)`, so
		 * what a binding sends up changes the bytes only through a read in that template. A name it
		 * does not read is a second render writing what the first wrote -- `onMount(() => { snapshot
		 * = foo() })` beside `<Two bind:foo />` is that, the only mention being in a callback the
		 * server never runs.
		 *
		 * Conservative on the script: any declaration naming it counts, function bodies included,
		 * because a markup read of that declaration writes its initialiser out and the name goes
		 * with it. The `bind:` being settled is skipped by its own span.
		 */
		const readsIt = (local: string): boolean => {
			const ast = parsedComponent(walk.source);
			const skip = (Array.isArray(node['attributes']) ? node['attributes'] : [])
				.filter((one) => isNode(one) && one['type'] === 'BindDirective')
				.map((one) => span(one as AstNode))
				.filter((one) => one !== null);
			let found = false;
			readsIn(ast['fragment'], new Set(), (at) => {
				if (at['name'] !== local) return;
				const from = at['start'];
				if (typeof from === 'number' && skip.some(([a, b]) => from >= a && from < b)) return;
				found = true;
			});
			const instance = ast['instance'];
			const content = isNode(instance) ? instance['content'] : undefined;
			for (const statement of isNode(content) && Array.isArray(content['body'])
				? content['body']
				: []) {
				if (!isNode(statement) || statement['type'] !== 'VariableDeclaration') continue;
				readsIn(statement, new Set(), (at) => {
					if (at['name'] === local) found = true;
				});
			}
			return found;
		};

		/**
		 * Records what a binding settles the caller's name to, or returns false where it cannot.
		 *
		 * The value is the child's, so it has to be one the caller can hold without the child's
		 * scope: a literal. Anything else -- a call, a name the child declares -- is the child's to
		 * evaluate and there is nothing here to write. The caller's side has to be a plain name,
		 * because that is what the setter assigns to.
		 */
		const settles = (prop: string, value: string): boolean => {
			const held = delayed.find(([bound]) => bound === prop)?.[1];
			if (held === undefined || !constant(value)) return false;
			const local = boundTo.get(prop) ?? '';
			if (!IDENTIFIER.test(local)) return false;
			// Written inside a block, which child sends back is the block's answer, so the block's
			// own test goes inside the ternary. An each is not a branch and has no such test.
			const when = branchTest(walk);
			if (when === null) return false;

			// Svelte assigns up only where the caller's value is `undefined`, and the assignment is
			// monotone -- `undefined` becomes a value and never goes back -- so the settled read is
			// this and the loop is not something the artifact repeats. Among the bindings of one
			// name the first whose branch renders is the one that reaches it, which is what the
			// chain nests in source order.
			const chain = [...(walk.site.sending.get(local) ?? []), [when, value] as const];
			walk.site.sending.set(
				local,
				chain.map(([a, b]) => [a, b]),
			);
			const nested = chain.reduceRight(
				(rest, [test, held]) =>
					test === 'true' ? `(${held})` : `((${test}) ? (${held}) : ${rest})`,
				'undefined',
			);
			walk.site.sends.set(local, `(${held} === undefined ? ${nested} : ${held})`);
			return true;
		};
		/**
		 * Whether the child's default can travel at all, which `bind_props` decides on the caller's
		 * value and which the render is the one to hold.
		 *
		 * `bind_props` assigns up only where the caller's value is `undefined`, so a caller binding
		 * something that is not is a binding that sends nothing and leaves nothing to settle.
		 * Whether it is `undefined` is the request's answer wherever the caller binds one of its own
		 * props, and the render's wherever it does not: `<Input bind:value={$value.value} />` over a
		 * store this file makes is `''`, and the loop settles on its first pass with nothing moved.
		 *
		 * Asked as the author wrote it, because the expansion of a store read names helpers the
		 * render has not got. Told nothing yet it answers no, so that the pass which collects the
		 * ask reaches the render that answers it -- the skeleton of that pass is thrown away, and
		 * the walk runs again told, the way it already does for a block's test.
		 */
		const travels = (prop: string): boolean => {
			const local = boundTo.get(prop);
			if (local === undefined || walk.site.payload === null) return true;
			const test = `(${local}) === undefined`;
			if (varies(test, walk, true) || walk.site.mute.has(test)) return true;
			const answer = walk.site.decided.get(test);
			if (answer !== undefined) return answer;
			if (!walk.site.asks.some(([key]) => key === test)) walk.site.asks.push([test, test]);
			return false;
		};

		for (const [name, value] of exportedValues(ahead, raw)) {
			if (!boundProps.has(name)) continue;
			// Already settled on an earlier pass, so the caller's reads hold the ternary and the
			// child can be entered like any other. By the name rather than by the pass: a binding
			// inside a block another binding opens is reached only once that one has settled, and a
			// whole-pass guard skipped it for ever.
			if (walk.sent.has(boundTo.get(name) ?? name)) continue;
			if (settles(name, value)) continue;
			// Nothing the child sends back reaches the bytes where the caller's template does not
			// read the name: the settling loop renders that template again and writes what it wrote.
			if (!readsIt(boundTo.get(name) ?? name)) continue;
			refuse(
				`\`bind:${name}\` on <${tag}> is a binding the child sends back: \`${name}\` is a ` +
					'readonly export, which `bind_props` assigns up to the caller where the caller ' +
					'passed nothing, and the caller then renders again with it. See spec/refusals.md',
			);
		}
		for (const one of declares) {
			if (!boundProps.has(one.prop) || one.fallback === 'undefined') continue;
			// `bind_props` reads the child's `bindable_prop` bindings and its readonly exports, and
			// nothing else. In legacy mode every `export let` is one; in runes mode only a
			// `$bindable()` is, and Svelte's own comment beside the call says the rest have "no
			// effect in runes mode other than throwing an error". So a `bind:` on a runes prop with
			// a plain default sends nothing back and there is nothing here to refuse -- measured on
			// a child declaring `let { x = 42 } = $props()`, whose caller wrote nothing either side
			// of the tag where a bindable one writes 42.
			if (one.bindable !== true) continue;
			if (walk.sent.has(boundTo.get(one.prop) ?? one.prop)) continue;
			if (settles(one.prop, one.fallback)) continue;
			// Nothing travels where the caller's value is not `undefined`, and where the caller binds
			// something of its own the render is what knows. See `travels`.
			if (!travels(one.prop)) continue;
			refuse(
				`\`bind:${one.prop}\` on <${tag}> is a binding the child sends back: it declares ` +
					`\`${one.prop}\` with a default, and Svelte's server assigns that default up to the ` +
					'caller where the caller passed nothing, then renders the caller again with it. ' +
					'Whether that happens is decided by the value the request brings, which is a ' +
					'structure rather than a value. See spec/refusals.md',
			);
		}

		// A component that renders itself -- through `<svelte:self>` or an import of its own file --
		// is a fragment the runtime calls, and is walked as one: its props are names bound per
		// call, as an each's item is per iteration, rather than substituted, its body is wrapped as
		// a bare block for the assembler to find, and the call inside it is a call of the fragment.
		// Its head could not be wrapped in a block and a rest gathers per call, so neither is taken.
		const recursion =
			contains(ahead['fragment'], 'SvelteSelf') ||
			importsItself(raw, file) ||
			reachesItself(file, raw)
				? `__f${String(walk.blocks.length)}`
				: null;
		if (recursion !== null) walk.site.callable.set(file, recursion);
		// Whether the fragment writes a head is read here, before its body -- and the calls inside
		// it -- are walked. See `headedFragment()`.
		const headedSelf = recursion !== null && contains(ahead['fragment'], 'SvelteHead');
		if (headedSelf && recursion !== null) walk.site.headedFragments.add(recursion);
		// The object the call site passed, which is what `$$props` is inside the child: every
		// attribute and every spread in the order `spread_props` merges them, with the bindings
		// last for the reason `push_prop(..., true)` gives. `sanitize_props` drops `children` and
		// `$$slots`, neither of which this carries, so it is left off; which slots the caller filled
		// is known by name here and is written out rather than read back off the object.
		const groups = hands(walk, nodes, node);
		// `$props()` bound to a name, or gathered into a rest, is the caller's object **with**
		// `children` in it: `VariableDeclaration.js` writes `let { $$slots, $$events, ...rest } =
		// $$props`, which takes out those two and keeps the slot function. `$$props` itself is
		// `sanitize_props($$props)`, which takes out `children` instead -- two objects, not one.
		// The walk composes slot content rather than passing a function for it, so the key has to be
		// put back: `Object.getOwnPropertyNames($props())` listed two names where Svelte lists three.
		//
		// **A function, not `true`.** `build_inline_component` writes the default slot as
		// `children: slot_fn`, and `attributes()` skips a value whose type is `function` -- so a
		// component spreading its whole props into an element writes no `children` attribute, and
		// anything else would. What the function does is nothing: every `{@render}` of it is markup
		// the walk composes where the call stands.
		if (filled(groups.get('children')) && !bindings.has('children')) {
			bindings.set('children', '(() => {})');
			order.push({ name: 'children' });
		}
		const passing = {
			object: `{ ${[
				...order.map((part) =>
					'spread' in part
						? `...(${part.spread})`
						: `${JSON.stringify(part.name)}: ${bindings.get(part.name) ?? 'undefined'}`,
				),
				...delayed.map(([name, value]) => `${JSON.stringify(name)}: ${value}`),
			].join(', ')} }`,
			slots: [...groups.keys()].map((one) => (one === 'children' ? 'default' : one)),
		};
		// A group the caller filled is a prop of the child's, and its value is a function -- the slot
		// or snippet Svelte passes. The scope a child's expressions read is data, so it stands for
		// the one thing a derivation can ask of a function: that it exists. Without it `{#if inner}`
		// over a `{#snippet inner}` written at the call site read `undefined` and the child rendered
		// the else, which is bytes rather than a refusal. See `standsFor()`.
		for (const named of groups.keys()) {
			if (bindings.has(named)) continue;
			if (!declares.some((one) => one.prop === named)) continue;
			bindings.set(named, 'true');
		}
		const held =
			recursion === null ? rebased(walk.site.fixed, declares, bindings) : new Map<string, string>();
		const params = declares.map((one) => one.local);
		const bound = new Map<string, string>();
		const named = new Set(
			declares.filter((one) => one.rest !== true && one.whole !== true).map((one) => one.prop),
		);
		/**
		 * What each held prop is bound to when the hold is given up, and where the list stood first.
		 *
		 * A hold is a reference this compiler resolves, and the child's **script** is handed to
		 * Svelte to evaluate. Where a declaration in that script reaches one, the reference would be
		 * written into source Svelte parses -- "`$$hold` is an illegal variable name" -- so the props
		 * are bound to their values instead and the identity this would have kept is given up. Only
		 * the script: a markup read is a hole, and a hole is an expression this compiler evaluates.
		 */
		const plain = new Map<string, string>();
		const before = walk.keeping.length;
		for (const one of declares) {
			if (recursion !== null) {
				bound.set(one.local, one.local);
				continue;
			}
			// `let props = $props()` binds the object itself, which is the one `$$props` is bound to.
			if (one.whole === true) {
				bound.set(one.local, `(${passing.object})`);
				continue;
			}
			if (one.rest === true) {
				// What `$props()` leaves in a rest: every attribute the caller wrote that the pattern
				// did not name, as an object of the caller's own expressions. Where a spread's keys
				// are the request's, `merged()` bound the rest already.
				const whole = bindings.get(REST);
				if (whole !== undefined) {
					bound.set(one.local, whole);
					continue;
				}
				const others = [...bindings]
					.filter(([prop]) => !named.has(prop))
					.map(([prop, value]) => `${JSON.stringify(prop)}: ${value}`);
				bound.set(one.local, `({ ${others.join(', ')} })`);
				continue;
			}
			// A default is JavaScript's, taken when the value is `undefined` and only then -- a prop
			// the caller passes as `undefined` takes it as much as one the caller leaves out.
			const given = bindings.get(one.prop);
			const value =
				given === undefined
					? one.fallback
					: one.fallback === 'undefined'
						? given
						: `(${given} === undefined ? (${one.fallback}) : ${given})`;
			// A value that **makes** something is held at the call site, which is where its identity
			// belongs: the caller evaluates it once and hands the child that one value, so two reads
			// inside the child must not build two. Recorded under the caller's own chain rather than
			// this child's, which is what makes the caller's reads of the same text and the child's
			// land on one derivation. See spec/derivation.md.
			const kept = holding(one.prop, given, byName, walk);
			if (kept !== null) plain.set(one.local, value);
			bound.set(one.local, kept ?? value);
		}
		// What the child imports from Kit's `$app/state`, bound the way its server module reads it:
		// `page` is the request's one object, which the root takes as its prop of that name, so the
		// child's `page` is the root's whichever level this is; the other two hold what a server
		// holds while it writes. Nothing is carried from the module. See spec/framework.md.
		for (const [local, exported] of stateImports(ahead['instance'])) {
			bound.set(local, exported === 'page' ? 'page' : (STATE_ON_SERVER[exported] ?? local));
		}

		// The child's declarations, with what each prop is bound to, so that one reading a prop the
		// caller gave a constant is left for the render to evaluate rather than neutralised.
		const inside = recursion === null ? walk.dynamic : new Set([...walk.dynamic, ...params]);
		let declared = locals(
			raw,
			held,
			fresh,
			bound,
			inside,
			// Not the sixth: that names props the payload carries, which is the entry's shape. A
			// child's are bound at its call site and arrive as `bound`, and naming them here stopped
			// them being recorded as declarations at all.
			undefined,
			// The list `rest_props` leaves out, in the order `transform-server.js` builds it: the
			// readonly exports first, then the bindable props. `export function b() {}` is one of the
			// first, and leaving it out put `b` in `$$restProps` where Svelte has three keys and we
			// wrote four.
			[
				...exportedBy(ahead),
				...declares.filter((one) => one.rest !== true && one.whole !== true).map((one) => one.prop),
			],
			passing,
			walk.keeping,
		);
		for (const [name, why] of declared.changed) walk.site.changing.set(name, why);
		// A hold the child's script reaches is given up, and every hold of this call goes with it:
		// the list is indexed, so dropping one and keeping another would need the indices renumbered
		// for the sake of a distinction nothing here measures.
		if (plain.size > 0 && declared.reading.some(([, empty]) => empty.includes('$$hold('))) {
			for (const [local, value] of plain) bound.set(local, value);
			walk.keeping.length = before;
			declared = locals(
				raw,
				held,
				fresh,
				bound,
				inside,
				undefined,
				[
					...exportedBy(ahead),
					...declares
						.filter((one) => one.rest !== true && one.whole !== true)
						.map((one) => one.prop),
				],
				passing,
				walk.keeping,
			);
		}
		if (recursion !== null) {
			walk.blocks.push({
				index: walk.blocks.length,
				kind: 'if',
				stream: walk.stream,
				expression: 'true',
				tests: ['true'],
				item: null,
				counter: null,
				alternate: false,
				within: [...walk.within],
				bare: true,
				fragment: {
					name: recursion,
					params,
					binds: propBinds(declares, bindings),
					...(opensWithText(ahead['fragment']) ? { textFirst: true as const } : {}),
				},
			});
		}
		const inner: [number, number, string][] = [];
		for (const [[from, to], empty] of declared.reading) inner.push([from, to, empty]);
		if (process.env['SEAM_TRACE'] !== undefined) {
			for (const [[from, to], empty] of declared.reading) {
				console.error(
					`[seam] ${basename(file)}: \`${raw.slice(from, to).replace(/\s+/g, ' ').slice(0, 70)}\` -> ` +
						`${empty.replace(/\s+/g, ' ').slice(0, 90)}`,
				);
			}
		}

		const ast = ahead;
		const prelude: string[] = [];
		// The child's own: a test asked inside it is answered by a statement in its script, not in
		// whichever copy happened to finish next.
		const asks: [string, string][] = [];
		const wants: [string, string][] = [];
		const own = importsOf(raw);
		for (const name of runesOf(own, file)) walk.site.runes.add(name);
		// A name the module block binds is the module block's, and `shared()` will import it there.
		// Restating it in the instance prelude is the same binding declared twice, which
		// `transform-server.js` puts in one module and Svelte answers with
		// `declaration_duplicate`.
		const exported = moduleExports(ahead).names;
		for (const one of brought) {
			if (exported.has(one.local)) continue;
			const already = own[one.local];
			if (already === one.from) continue;
			if (already !== undefined) {
				refuse(
					`\`${one.local}\` is imported by both ${basename(walk.site.file)} and ${basename(file)} ` +
						'from different modules, and a value handed from the first is read by the second ' +
						'under that name, which cannot mean both; rename one of them',
				);
			}
			prelude.push(restated(one));
		}
		const snippets = new Map<string, Snippet>();
		snippetsIn(ast['fragment'], snippets);

		// A copy per call site, so two of the same component do not write one marker twice.
		const at = resolvePath(
			dirname(walk.site.file),
			`__seam-${basename(file, '.svelte')}-${String(walk.site.copies.length)}.svelte`,
		);
		const copy: Copy = { file, at, source: '', raw, inner, within: [...walk.within] };
		walk.site.copies.push(copy);

		// The anchor's hole comes before every hole the child plants, which is where Svelte writes
		// the anchor: at the start of the component, before anything it renders.
		if (fresh !== null) {
			copy.fresh = walk.holes.length;
			walk.holes.push({ index: copy.fresh, expression: fresh, raw: false, fresh: true });
		}

		// The fragment's block encloses everything the body walks, so a head met inside marks it.
		const fragmentAt = walk.blocks.findIndex((one) => one.fragment?.name === recursion);
		const child: Walk = {
			...walk,
			source: raw,
			edits: inner,

			within: recursion === null ? walk.within : [...walk.within, [fragmentAt, 0]],
			expand: (child, extra) =>
				declared.rewrite(child, new Map([...bound, ...(extra ?? new Map())]), walk.sent),
			plain: (child, extra) => declared.rewrite(child, extra),
			runeOf: declared.rune,
			declares: declared.has,
			legacy: legacyMode(ast),
			sent: walk.sent,
			snippets,
			siblings: relatesSiblings(ast),
			dynamic: inside,
			fresh: fresh === null ? walk.fresh : [...walk.fresh, fresh],
			site: {
				file,
				root: walk.site.root,
				imports: importsOf(raw),
				carried: importedBy(raw),
				defaults: new Map(),
				stood: walk.site.stood,
				changing: walk.site.changing,
				copies: walk.site.copies,
				choices: walk.site.choices,
				stack: [...walk.site.stack, file],
				prelude,
				asks,
				wants,
				told: walk.site.told,
				mute: walk.site.mute,
				sends: walk.site.sends,
				sending: walk.site.sending,
				tested: walk.site.tested,
				runes: walk.site.runes,
				contexts: walk.site.contexts,
				...(recursion === null ? {} : { fragment: recursion }),
				fragments: new Map(),
				given: groups,
				payload: walk.site.payload,
				missed: walk.site.missed,
				headed: walk.site.headed,
				callable: walk.site.callable,
				headedFragments: walk.site.headedFragments,
				handed: walk.site.handed,
				spreads: walk.site.spreads,
				copy,
				probing: walk.site.probing,
				fixed: held,
				decided: walk.site.decided,
			},
		};
		contextual(ast, child);
		collect(ast['fragment'], child);
		// The body as the fragment: everything the root fragment writes, wrapped as the bare block
		// the fragment's block is, with the stamp that names it where the render puts it.
		if (recursion !== null) {
			const root = ast['fragment'];
			const ends = wrapped(
				isNode(root) && Array.isArray(root['nodes']) ? root['nodes'] : [],
				() => `<${tag} />`,
			);
			if (ends !== null) {
				const [first, last] = ends;
				const index = walk.blocks.findIndex((one) => one.fragment?.name === recursion);
				const opener = inner.length;
				inner.push([first[0], first[0], '{#if true}']);
				const [from, to, text] = stamped(walk, index, raw, last[1]);
				const closer = closes(inner, [from, to, `{/if}${text}`]);
				// The component's own head has the fragment stand in the head stream too; one a
				// child inside wrote is found too late. See `headedFragment()`.
				if (headedSelf) headedFragment(walk, index, inner, opener, closer, ast);
				else if (walk.site.headed.has(index)) headFoundLate(`<${tag} />`);
			}
		}
		withPrelude(raw, ast, prelude, inner);
		withAsks(ast, asks, wants, inner);
		withFresh(ast, fresh, declared.ids, inner);
		shared(ast, file, inner);
		copy.asks = asks;
		copy.wants = wants;
		copy.source = unimported(apply(raw, inner));
		if (process.env['SEAM_TRACE_SOURCE'] !== undefined) {
			console.error(`[seam] copy ${basename(copy.at)} of ${basename(file)}:\n${copy.source}\n`);
		}

		// The values stay where they were written and are handed to the render as nothing. The
		// child's markers already carry the expressions, so what the call site passes is dead --
		// and live, it would be evaluated against data the render is not given.
		//
		// Nothing, except for the paths this render is fixed at: those the compiler knows, and
		// markup the child leaves for Svelte to evaluate reads them out of its props like anything
		// else. So the prop is handed exactly them, in the shape they sit in, and nothing more.
		// A spread of the request's goes the same way, whole: every prop it decided is bound
		// inside the child, and evaluated here it would read the payload the render is not given.
		for (const part of order) {
			// A spread whose object awaits leaves an empty one behind rather than nothing: what makes
			// Svelte wrap this tag in a `child_block` is the await, and an empty spread carries no
			// key. See `awaited()`.
			if ('spread' in part && part.at !== null) {
				const held = awaiting(part.spread) ? '{...await {}}' : '';
				walk.edits.push([part.at[0], part.at[1], held]);
			}
		}
		for (const one of attributes) {
			// A `bind:` is written out as the plain attribute it used to be rewritten to. The setter
			// is not needed here: a child that could send something back was refused above, so what
			// is left is a binding whose getter is the whole of it, and the caller's tag has to be
			// something Svelte can evaluate like any other prop.
			if (isNode(one) && one['type'] === 'BindDirective') {
				const name = typeof one['name'] === 'string' ? one['name'] : '';
				const local = declares.find((each) => each.prop === name)?.local;
				const known = local === undefined ? undefined : partial(held, local);
				const whole = span(one);
				if (whole !== null && !(known === undefined && inertProps.has(name))) {
					const placed = known === undefined ? standsIn(ahead, local) : JSON.stringify(known);
					// Written last, not where it stood. `push_prop(..., true)` delays a binding's
					// pair so it comes after the spreads -- "to avoid spreads overwriting them" --
					// and the fold this walk makes says so, so the render has to say so too.
					// `<Button bind:value {...props} />` with `value` in the spread wrote the
					// spread's where Svelte wrote the binding's.
					walk.edits.push([whole[0], whole[1], '']);
					const shut = closing(walk.source, node);
					// Before the slash of a self-closing tag, which is part of how it closes.
					const close = walk.source[shut - 1] === '/' ? shut - 1 : shut;
					walk.edits.push([close, close, ` ${name}={${placed}} `]);
				}
				continue;
			}
			if (!isNode(one) || one['type'] !== 'Attribute') continue;
			const value = one['value'];
			const parts = value === true ? [] : Array.isArray(value) ? value : [value];
			const whole = span(one);
			// A `--x` is not a prop. `build_inline_component` collects it into `custom_css_props` and
			// `$.css_props` writes `<svelte-css-wrapper style="display: contents; ${styles}">`, where
			// `style_object_to_string` escapes each value the way an attribute is escaped. So the
			// value is written into the bytes and takes a marker, where it was being neutralised to
			// `null` and dropped: measured on `css-vars-escape`, whose whole point is the escaping.
			//
			// What stays open is the presence half: that helper drops a key whose value is null or
			// the empty string, and a marker is neither, so a request that sends nothing gets
			// `--color: ;` where Svelte writes no declaration at all. See spec/roadmap.md.
			if (typeof one['name'] === 'string' && one['name'].startsWith('--')) {
				const [only] = parts;
				if (whole === null || parts.length !== 1 || !isNode(only)) continue;
				if (only['type'] !== 'ExpressionTag') continue;
				const written = stands(walk.expand(only['expression']), walk);
				walk.edits.push([whole[0], whole[1], `${one['name']}={${written}}`]);
				continue;
			}
			// `{p}` is `p={p}`, and the short form's braces hold a bare name and nothing else, so
			// the whole attribute is written out rather than its value replaced. The same thing a
			// marker planted in one costs, met again.
			const name = typeof one['name'] === 'string' ? one['name'] : '';
			const local = declares.find((each) => each.prop === name)?.local;
			const known = local === undefined ? undefined : partial(held, local);
			// Left as written where the value varies with nothing the request decides: Svelte
			// evaluates the caller's expression and hands the child the value itself.
			if (known === undefined && inertProps.has(name)) continue;
			const stood = known === undefined ? standsIn(ahead, local) : JSON.stringify(known);
			const placed = awaits.has(name) ? `await ${stood}` : stood;
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
		rename(walk, node, tag, at, ordinal, dynamic);

		// Every hole and block this child planted and no deeper child has claimed is written
		// across this file and its callers, innermost first. The deeper ones finished first, so
		// what is unclaimed here is this component's own.
		const chain = [file, ...walk.site.stack.toReversed()].map((one) =>
			relative(walk.site.root, one),
		);
		for (const hole of walk.holes.slice(mark.holes)) hole.files ??= chain;
		for (const block of walk.blocks.slice(mark.blocks)) block.files ??= chain;
		for (const one of walk.keeping.slice(mark.keeping)) one.files ??= chain;
		return true;
	} catch (error) {
		// Rolled back, and the component is rendered by Svelte the way it was before this tried.
		// A refusal from inside a child is a refusal about a file the author did not ask to
		// compile, so it is not theirs to see.
		rolled(walk, mark);
		// The walk asking for a second render is not the walk failing, and it is answered above.
		if (error instanceof Undecided) throw error;
		if (String((error as Error).message).includes('is part of a cycle')) throw error;
		// Left to Svelte, a child writing a head inside a block would render one head block where a
		// request renders one per branch or per item, and nothing downstream could tell. So this
		// one is the author's to see, with why the walk could not enter -- and so is a block found
		// deeper that cannot stand in the head stream, which says so itself.
		const reason = String((error as Error).message);
		// Nothing in the pass that asks the render is final: a branch the request never takes is
		// walked in it too, and a refusal inside one is about markup that never renders.
		if (walk.asking !== true && reason.includes('stand in the head stream')) throw error;
		// Left to Svelte, an `await` in markup would not compile at all: it is the author's to see.
		if (walk.asking !== true && reason.includes('async Svelte')) throw error;
		// Left to Svelte, a binding the child sends back writes the caller's markup a second time
		// and this compiler would keep the first pass, which is bytes nobody asked for rather than
		// a component it could not read. So it is the author's to see too.
		//
		// **Past one catch rather than all of them.** The binding is written in the markup of the
		// component this walk is in, not in the child that declares the prop, so that component is
		// the one to leave to Svelte: `bind_props` then runs inside Svelte's own render of it and
		// whatever it settled is there for the caller above to read. Rolling back only the child
		// leaves the binding in a copy this pass rewrote, where the value it fills in is a
		// placeholder's -- `component-binding-blowback-d` wrote `{}` where Svelte wrote
		// `{"value":"0:0"}`. Where there is no catch outside this one the entry holds the binding
		// and there is nothing to leave, so it reaches the author as before.
		if (walk.asking !== true && reason.includes('a binding the child sends back')) {
			const carried = error as { past?: true };
			if (carried.past !== true) {
				carried.past = true;
				throw error;
			}
		}
		// Left to Svelte, a child that changes a value is handed the marker standing for it and
		// computes with that: `export let value; value += 1` over a marker wrote `%%s0%%1`, which is
		// the marker back with a digit on it, so nothing downstream could tell. The author's to see.
		if (walk.asking !== true && reason.includes('is a prop this component changes')) throw error;

		// Left to Svelte, a context read is evaluated in the render -- where the `setContext` above
		// it was handed the literal standing in for a request value, so the child bakes that. The
		// refusal has to reach the author rather than turn into a component rendered as it was.
		if (walk.asking !== true && reason.includes('a context read where a `setContext`')) {
			throw error;
		}
		// The same: left to Svelte, the read is evaluated against the render's own copy of the
		// module, which is not the one the artifact calls into. See `changedBy()`.
		if (walk.asking !== true && reason.includes('a module binding something in that module')) {
			throw error;
		}
		// Async Svelte is out of scope by the scope line rather than a component this walk could not
		// read, so leaving it to the render is not the answer it is for a gap -- and the render does
		// not take it either: Svelte's own compiler answers `Cannot use \`await\` in deriveds and
		// template expressions`, which is upstream's words for our decision and puts 25 samples in
		// the gap list they do not belong in. See spec/conformance.md.
		if (walk.asking !== true && reason.includes('which is async Svelte')) throw error;
		if (walk.asking !== true && headed && walk.within.length > 0) {
			refuse(
				`<${tag} /> writes a \`<svelte:head>\` inside a block, so the block has to stand in the ` +
					`head stream, and the walk could not enter it: ${reason.replace(/\. See spec\/refusals\.md$/, '')}`,
			);
		}
		if (process.env['SEAM_TRACE'] !== undefined) {
			console.error(
				`[seam] could not enter ${basename(file)}: ${reason.replace(/\s+/g, ' ').slice(0, 240)}`,
			);
		}
		walk.site.missed.push({ file, reason });
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
	told: ReadonlyMap<string, string> = new Map(),
	mute: ReadonlySet<string> = new Set(),
	sent: ReadonlyMap<string, string> = new Map(),
): Rewritten {
	const ast = parsedComponent(source) as unknown as AstNode;
	awaitless(ast, 'the entry');
	const holes: Hole[] = [];
	const blocks: Block[] = [];
	const edits: [number, number, string][] = [];
	const pending: PendingChoice[] = [];
	// The entry's own id, where it declares one, named apart from every copy's. See `descend()`.
	const fresh = identified(ast) ? '__i0' : null;
	// Before `locals`, because the entry's props are the payload and have to be kept out of the
	// declarations: `export let x = 1` reaches that pass as an ordinary one. See `declared` there.
	const entryProps = propsOf(ast, source);
	/** Every held declaration's initialiser, one list for the entry and every copy it enters. */
	const keeping: { expression: string; files?: string[] }[] = [];
	/** Every file's names substitution cannot follow, unioned. See `Site.changing`. */
	const changing = new Map<string, string>();
	const declared = locals(
		source,
		fixed,
		fresh,
		undefined,
		undefined,
		// `whole` is left out: the entry binding `$props()` to a name binds the payload object, which
		// the rune branch in `declared` records under `GIVEN`. Naming it here as a prop the payload
		// carries stopped that branch being reached at all.
		new Set(
			(entryProps ?? [])
				.filter((one) => one.rest !== true && one.whole !== true)
				.map((one) => one.local),
		),
		// The names the caller passes, which is what `$$restProps` leaves out: a prop's own name
		// rather than the local it was destructured into.
		(entryProps ?? [])
			.filter((one) => one.rest !== true && one.whole !== true)
			.map((one) => one.prop),
		undefined,
		keeping,
	);

	for (const [name, why] of declared.changed) changing.set(name, why);

	// A render is given no data, so a declaration reading a prop would evaluate against nothing
	// and crash inside Svelte's own renderer. It has already been substituted into every
	// expression that used it, which leaves it dead here, so the render is handed a literal in
	// its place rather than the expression it stood for.
	for (const [[from, to], empty] of declared.reading) edits.push([from, to, empty]);

	const snippets = new Map<string, Snippet>();
	snippetsIn(ast['fragment'], snippets);
	const copies: Copy[] = [];
	const choices: Choice[] = [];
	const prelude: string[] = [];
	const asks: [string, string][] = [];
	const wants: [string, string][] = [];
	const sends = new Map<string, string>();
	const sending = new Map<string, [when: string, value: string][]>();
	const tested = new Map<number, string[]>();
	const declares = entryProps;
	// The entry's `page` from `$app/state` is the payload's `page`, under that name and no other:
	// a child's rename is bound at its call, and the entry has no call to bind it at.
	const state = stateImports(ast['instance']);
	for (const [local, exported] of state) {
		if (exported === 'page' && local !== 'page') {
			refuse(
				`\`import { page as ${local} }\` from $app/state in the entry: the entry's \`page\` is ` +
					"the payload's and arrives under its own name. See spec/refusals.md",
			);
		}
	}
	// The payload's keys are the **props**, not the names the entry destructured them into:
	// `let { foo: bar } = $props()` reads the request's `foo` and calls it `bar`, so `bar` in the
	// markup is the path `foo`. They are the same word in nearly every component, which is why this
	// went unnoticed.
	const payload =
		declares === null
			? null
			: new Set([
					// A `whole` binding names no key: it is the payload object itself. `GIVEN` is what
					// reads it, and putting its local here made every read of it the path `''`.
					...declares
						.filter((one) => one.whole !== true)
						.map((one) => (one.rest === true ? one.local : one.prop)),
					...[...state].filter(([, exported]) => exported === 'page').map(([local]) => local),
				]);
	/**
	 * A prop read under a name that is not the request's for it, which is a substitution like any
	 * other -- and one whose replacement is a bare name, so a read of it stays a path rather than
	 * becoming a derivation.
	 */
	const renamed = new Map(
		(declares ?? [])
			.filter((one) => one.rest !== true && one.whole !== true && one.local !== one.prop)
			.map((one): [string, string] => [one.local, one.prop]),
	);
	// A rest on the entry is every key the request brought that the pattern did not name, and the
	// payload itself is what it is gathered from: `GIVEN` names that object, which the rune branch
	// in `declared` already binds for a `$props()` given a name rather than destructured. Left
	// alone the rest read as a path of its own -- `others.bar` against a payload whose `bar` is at
	// the top -- and wrote nothing.
	//
	// `$$slots` and `$$events` are excluded with the named props, and only where there is a rest:
	// `3-transform/server/visitors/VariableDeclaration.js` splices them into the object pattern
	// ahead of the rest element for exactly that reason, and leaves a pattern without one alone.
	// A prop whose name is not an identifier can only be written as a string --
	// `let { 'kebab-case': x } = $props()` -- and no expression can read it by that name, where
	// `kebab-case` is a subtraction. The payload object can, and `GIVEN` names it, so the read is a
	// member of that object rather than a name in scope.
	//
	// The default is folded in here rather than left to the prop derivation, which stands over the
	// payload's key **under a name**, and a name is the one thing this prop has not got. `GIVEN`
	// holds what the request brought, before any default was applied.
	for (const one of declares ?? []) {
		if (one.rest === true || one.whole === true) continue;
		if (/^[A-Za-z_$][\w$]*$/.test(one.prop)) continue;
		const at = `${GIVEN}[${JSON.stringify(one.prop)}]`;
		const held = one.at === undefined ? null : declared.rewrite(one.at);
		renamed.set(one.local, held === null ? at : `(${at} === undefined ? (${held}) : ${at})`);
	}
	const rest = (declares ?? []).find((one) => one.rest === true);
	if (rest !== undefined) {
		const named = (declares ?? [])
			.filter((one) => one.rest !== true && one.whole !== true)
			.map((one) => JSON.stringify(one.prop));
		const excluded = [...named, '"$$slots"', '"$$events"'].join(', ');
		renamed.set(rest.local, `$$exclude_from_object(${GIVEN}, [${excluded}])`);
	}
	/**
	 * The same defaults as the AST nodes they were written as, for the walk to read a component out
	 * of. A prop's default is the value the request did not send, and the request cannot send a
	 * component, so a default naming one is the only component that name can hold.
	 */
	const propDefaultNodes = new Map(
		(declares ?? [])
			.filter((one) => one.rest !== true && one.whole !== true && one.at !== undefined)
			.map((one): [string, unknown] => [one.local, one.at]),
	);
	/** Filled by the walk, read by the defaults below, which is why they are built after it. */
	const stood = new Set<string>();
	/** The markup no request reaches, by file, for the name check to leave alone. */
	const dead = new Map<string, [number, number][]>();
	const missed: { file: string; reason: string }[] = [];
	const handed: Handed[] = [];
	const spreads: PendingSpread[] = [];
	const headed = new Set<number>();
	const callable = new Map<string, string>();
	const headedFragments = new Set<string>();
	if (fresh !== null) holes.push({ index: 0, expression: fresh, raw: false, fresh: true });
	// The entry rendering itself through `<svelte:self>` is a fragment the way a child is, walked
	// the way `descend()` walks one: its props are the parameters, and what the first call binds
	// them to is the payload's own paths, since the entry's props are the payload. Its body is
	// wrapped as a bare block below, once walked, for the assembler to find.
	const recursion = contains(ast['fragment'], 'SvelteSelf') ? `__f${String(blocks.length)}` : null;
	const headedEntry = recursion !== null && contains(ast['fragment'], 'SvelteHead');
	if (recursion !== null && headedEntry) headedFragments.add(recursion);
	if (recursion !== null) {
		if (declares === null) {
			refuse(
				'the entry renders itself through `<svelte:self>` and this compiler cannot read its props',
			);
		}
		blocks.push({
			index: blocks.length,
			kind: 'if',
			stream: 'body',
			expression: 'true',
			tests: ['true'],
			item: null,
			counter: null,
			alternate: false,
			within: [],
			bare: true,
			fragment: {
				name: recursion,
				params: declares.map((one) => one.local),
				binds: propBinds(declares, new Map(declares.map((one) => [one.prop, one.prop]))),
				...(opensWithText(ast['fragment']) ? { textFirst: true as const } : {}),
			},
		});
		callable.set(file, recursion);
	}
	const walk: Walk = {
		source,
		holes,
		edits,
		blocks,
		taken,
		stream: 'body',
		expand:
			renamed.size === 0 && sent.size === 0
				? declared.rewrite
				: (node, extra) =>
						declared.rewrite(node, new Map([...renamed, ...(extra ?? new Map())]), sent),
		plain: declared.rewrite,
		runeOf: declared.rune,
		declares: declared.has,
		items: new Map(),
		legacy: legacyMode(ast),
		sent,
		snippets,
		pending,
		dead,
		keeping,
		within: recursion === null ? [] : [[0, 0]],
		site: {
			file,
			root,
			imports: importsOf(source),
			carried: importedBy(source),
			defaults: propDefaultNodes,
			stood,
			changing,
			copies,
			choices,
			stack: [file],
			prelude,
			asks,
			wants,
			told,
			mute,
			sends,
			sending,
			tested,
			runes: runesOf(importsOf(source), file),
			contexts: new Set<string>(),
			...(recursion === null ? {} : { fragment: recursion }),
			fragments: new Map(),
			given: new Map(),
			payload,
			missed,
			headed,
			callable,
			headedFragments,
			handed,
			spreads,
			copy: null,
			probing,
			fixed,
			decided,
		},
		dynamic: payload ?? new Set(),
		fresh: fresh === null ? [] : [fresh],
		parent: null,
		tight: false,
		svg: false,
		siblings: relatesSiblings(ast),
		alone: null,
		standalone: true,
	};
	contextual(ast, walk);
	collect(ast['fragment'], walk);
	/**
	 * A default on the entry's own props, which nothing else was applying.
	 *
	 * A child's default is applied where its call site binds the prop -- `propBinds`, and this is
	 * the same rule. The entry has no call site: its props are the payload, so the default stands
	 * over the payload's key and is computed once, before anything reads it. See `Skeleton.defaults`
	 * for what rewriting the reads instead cost, and spec/derivation.md.
	 *
	 * **On `undefined` and on nothing else.** `$props()` destructures the props object, so Svelte's
	 * default fires exactly where a JavaScript destructuring default does; `??` would fire on null
	 * too and write the default over a value the request sent.
	 *
	 * **`typeof`, not `=== undefined`, and the difference is the whole case this handles.** A
	 * derivation reads its scope through `with`, which binds a name only where the scope says it
	 * has one -- so a prop the request did not send is not a name at all, and `foo === undefined`
	 * is a ReferenceError on exactly the payload the default exists for. `typeof` reads an unbound
	 * name without throwing, and answers `'undefined'` for a key that is absent and for one that is
	 * present holding `undefined`, which is the two cases a destructuring default fires on.
	 * `propBinds` writes the plain comparison because a child's prop is bound to an expression at
	 * its call site and is always there to evaluate.
	 *
	 * A rest is left out: `...rest` gathers what the pattern did not name, and for the entry that
	 * is a question about the payload's other keys rather than a default.
	 *
	 * press cannot reach the bug this fixes -- Kit's root receives `data_0 .. data_n`, `page` and
	 * `form` on every request -- and it does reach this code, since that root declares each
	 * `data_n = null`. See spec/suite.md.
	 */
	// Every prop the entry declares, not only the ones with a default. `$props()` destructures, so
	// a key the request does not send is `undefined` -- and a derivation reads its scope through
	// `with`, which asks the payload whether it has the name and falls through to the globals for
	// one it has not got. `class:unused` over a prop nobody sent threw `unused is not defined` at
	// request time, where Svelte writes no class. Standing the name over the payload's key with
	// `undefined` for its value is what puts it in scope. See `Derivation.prop`.
	const propDefaults = (declares ?? [])
		// A `whole` binding names no prop: it is the payload object itself, which the rune branch in
		// `declared` records. There is no key for a default to stand over.
		.filter((one) => one.rest !== true && one.whole !== true)
		.map((one) => ({
			name: one.prop,
			// The default alone, without a test around it. `$props()` destructures, so Svelte's own
			// answer is JavaScript's: the default is taken where the **property** is `undefined`,
			// which is a question about the payload rather than about what the name resolves to.
			// Written as `typeof x === 'undefined' ? d : x` it was neither -- `export let Math = {...}`
			// found the global and never took the default. See `Derivation.prop`.
			//
			// Expanded, like every other expression the walk records. A default is the author's own
			// source and may call what only its file has -- `export let foo = get()`, or a function
			// the script below it declares -- and a derivation is evaluated with the carried bundle
			// in scope rather than with the component's body.
			//
			// A default the walk followed to a component stands there for what a component is worth
			// to a derivation and nothing more: that it exists. The scope is data -- the payload
			// carries no function, and `gather()` in the carry package drops a component from the
			// bundle on purpose -- so the name is not there to evaluate, and the one construct that
			// consumes the value asks only whether there is one. See `chosenComponent()`.
			expression:
				one.at === undefined
					? one.fallback
					: declared.rewrite(one.at, stood.has(one.local) ? standsFor(walk) : undefined),
			files: [relative(root, file)],
		}));
	if (recursion !== null) {
		// The body as a bare block, once the walk has been through it and everything it marked
		// is where it is: the whitespace at either end is trimmed either way, so the block wraps
		// what is written. See `descend()`.
		const nodes =
			isNode(ast['fragment']) && Array.isArray(ast['fragment']['nodes'])
				? ast['fragment']['nodes']
				: [];
		const ends = wrapped(nodes, () => 'the entry');
		if (ends !== null) {
			const [first, last] = ends;
			const opener = edits.length;
			edits.push([first[0], first[0], '{#if true}']);
			const closer = closes(edits, [last[1], last[1], `{/if}${carrier(0, null)}`]);
			if (headedEntry) headedFragment(walk, 0, edits, opener, closer, ast);
			else if (headed.has(0)) headFoundLate('the entry');
		}
	}
	withPrelude(source, ast, prelude, edits);
	withAsks(ast, asks, wants, edits);
	withFresh(ast, fresh, declared.ids, edits);
	const own = [relative(root, file)];
	for (const hole of holes) hole.files ??= own;
	for (const block of blocks) block.files ??= own;
	// A held initialiser is the declaration's, so it resolves through the file that declared it --
	// which is this one for anything a child did not claim.
	for (const one of keeping) one.files ??= own;

	return {
		rewritten: unimported(apply(source, edits)),
		// Kept beside the bytes they made, so a render that takes other branches is the same walk
		// with a handful of edits written the other way. See `rechosen`.
		source,
		edits,
		choices,
		dead,
		keeping,
		changing,
		sends,
		holes,
		blocks,
		pending,
		copies,
		missed,
		handed,
		spreads,
		payload: payload === null ? null : [...payload],
		defaults: propDefaults,
		// The entry's own and every surviving copy's: a copy rolled back takes its asks with it,
		// and a test only a discarded render would have answered is not one to wait on.
		asks: [...new Set([...asks, ...copies.flatMap((copy) => copy.asks ?? [])].map(([key]) => key))],
		wants: [
			...new Set([...wants, ...copies.flatMap((copy) => copy.wants ?? [])].map(([key]) => key)),
		],
		...(fresh === null ? {} : { fresh: 0 }),
	};
}
