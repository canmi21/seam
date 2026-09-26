/**
 * The shapes the walk carries: the site every file of one walk shares, the walk over one
 * file, a copy of a child, what a caller hands a child, and the choices a render decides. See
 * spec/pipeline.md.
 */
import { type Carried, type Edit, type Locals } from 'ast';
import { type PendingChoice, type PendingSpread } from './attributes.ts';
import { type AstNode } from './node.ts';
import type { Block, Hole, Stream } from './shape.ts';
import { type Snippet } from './snippets.ts';

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
	/**
	 * The names in this file's instance script that Svelte's async mode gives a blocker. See
	 * `blockedBy()`.
	 */
	blocked: ReadonlySet<string>;
	/** The names a top-level statement reading the request assigns. See `movedBy()`. */
	moved: ReadonlySet<string>;
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
	 * The names this file reads that no script in it writes: a host's globals, read per request and
	 * never by the build. See `hostedIn()`, and spec/derivation.md, "Ambient input is read at request
	 * time, never at the build".
	 */
	hosted: RegExp | null;
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
	 * What a component `bind:` met on this pass settles a name to, by the caller's local **keyed
	 * to the caller's copy** (`keyed()`), since a copy and its caller may declare one name -- a
	 * `<Parent value>` binding a `<Child bind:value>` -- and the settled one is the caller's alone.
	 * Empty on a pass that was already told them, which is how the walk knows it has settled. See
	 * `Walk.sent`.
	 */
	sends: Map<string, string>;
	/** Every settled name the walk was told, keyed the way `sends` is; `Walk.sent` is one file's view. */
	sent: ReadonlyMap<string, string>;
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
	 * The locals of a copy whose value the render hands it as the caller wrote the tag -- a prop
	 * that varies with nothing the request decides and that no render could tell as a value, a
	 * promise or a function -- so that a read of one in the copy's own name is the caller's one
	 * value. Empty for the entry, and for slotted markup, whose names are the caller's. See
	 * `asWritten`.
	 */
	handedAsWritten: ReadonlySet<string>;
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
	/**
	 * Set inside the children of a `<svelte:boundary>` with a `failed` snippet: what guards a value
	 * there, so that nothing computing it throws anywhere but in the boundary's own catch. A child
	 * copy builds its substitution afresh and guards through this. See `boundary()`.
	 */
	trying?: (text: string) => string;
	/**
	 * Set inside both branches of a `<svelte:boundary>` with a `failed` snippet: every value is a
	 * hole, even one the request does not decide. Whether it throws is asked per request -- by the
	 * boundary's run in the children, by the request's `transformError` choosing a branch in the
	 * snippet -- and the render made at the build would throw it there instead, for every request.
	 * A derivation is computed only where it is read, so one in a branch no request takes throws
	 * for none. A context read stays the render's, having nowhere else to be read. See `boundary()`.
	 */
	holding?: true;
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
	/** The entry's own names substitution cannot follow, which its script run answers. */
	ran: ReadonlySet<string>;
	/** Whether the markup changes what the run holds while the bytes are written. See `ran()`. */
	live: boolean;
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
	/** The entry's own `hydratable` calls, as the derivations that make them. See `Skeleton.eager`. */
	eager: { expression: string; files: string[] }[];
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
export interface Group {
	/** Where the literal goes: the head of the group, in the source. */
	at: number;
	probe: string;
	/** The component and the name, as a refusal says it. */
	what: string;
}
