import { relative } from 'node:path';
import { apply, importsOf as importedBy, GIVEN, locals, parsedComponent, stateImports } from 'ast';
import type { PendingChoice, PendingSpread } from './attributes.ts';
import { importsOf, legacyMode, propsOf, withPrelude } from './compose.ts';
import { type AstNode, identified, isNode, refuse, relatesSiblings } from './node.ts';
import { carrier } from './sentinel.ts';
import type { Block, Hole } from './shape.ts';
import { type Snippet, snippetsIn } from './snippets.ts';
import { awaitless, blockedBy, hydratableCalls, liveIn, movedBy } from './awaits.ts';
import { sentFor } from './branches.ts';
import { collect } from './collect.ts';
import { contains, opensWithText, propBinds, standsFor, unimported } from './components.ts';
import { contextual, hostedIn, placed, runesOf } from './dynamic.ts';
import { closes, headedFragment, headFoundLate, wrapped } from './stamps.ts';
import { type Choice, type Copy, type Handed, type Rewritten, type Walk } from './walk-types.ts';
import { withAsks, withFresh } from './written.ts';

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
		// The entry's script runs as Svelte compiled it where a read cannot be substituted, so a
		// name that cannot be followed is recorded rather than refused. See `ran()` in skeleton.ts.
		'run',
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
	// The entry's own settled names: the ones filed under no copy. See `sentFor`.
	const ownSent = sentFor(sent, null);
	const walk: Walk = {
		source,
		holes,
		edits,
		blocks,
		taken,
		stream: 'body',
		expand: (node, extra, given) => {
			const settling = given ?? ownSent;
			return placed(
				renamed.size === 0 && settling.size === 0
					? declared.rewrite(node, extra)
					: declared.rewrite(node, new Map([...renamed, ...(extra ?? new Map())]), settling),
				node,
				file,
			);
		},
		plain: declared.rewrite,
		runeOf: declared.rune,
		declares: declared.has,
		handedAsWritten: new Set(),
		items: new Map(),
		legacy: legacyMode(ast, file),
		sent: ownSent,
		snippets,
		pending,
		dead,
		keeping,
		within: recursion === null ? [] : [[0, 0]],
		site: {
			file,
			root,
			blocked: blockedBy(ast),
			moved: new Set([...movedBy(ast, payload ?? new Set()), ...liveIn(declared.changed)]),
			hosted: hostedIn(source, file),
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
			sent,
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
		// What a statement reading the request changes is the request's, and every position that asks
		// `dynamic` rather than `varies()` has to see it so: with the entry's script run where a read
		// cannot be substituted, nothing refuses such a name any more, and a position that took it for
		// the render's baked the value a neutralised `$:` left. See `movedBy()`.
		dynamic: new Set([
			...(payload ?? []),
			...movedBy(ast, payload ?? new Set()),
			...liveIn(declared.changed),
		]),
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
			// Through `renamed`, as `walk.expand` is: a default naming another prop's local names that
			// prop's key -- `let vi1 = v2; export { v2 as a2, vi1 as a3 }` defaults `a3` to `a2`, and
			// `v2` is bound nowhere a derivation reads.
			expression:
				one.at === undefined
					? one.fallback
					: declared.rewrite(
							one.at,
							new Map([...renamed, ...(stood.has(one.local) ? standsFor(walk) : new Map())]),
						),
			files: [relative(root, file)],
		}));
	const eager = hydratableCalls(ast).map((call) => ({
		expression: walk.expand(call),
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
		// Everything substitution cannot follow, what the markup changes while the bytes are written
		// included: the run's bindings are live, so a function the markup calls changes the run's own
		// state and a read after it sees the change. See `ran()` in skeleton.ts.
		ran: new Set([...declared.changed].map(([name]) => name)),
		live: liveIn(declared.changed).length > 0,
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
		eager,
		// The entry's own and every surviving copy's: a copy rolled back takes its asks with it,
		// and a test only a discarded render would have answered is not one to wait on.
		asks: [...new Set([...asks, ...copies.flatMap((copy) => copy.asks ?? [])].map(([key]) => key))],
		wants: [
			...new Set([...wants, ...copies.flatMap((copy) => copy.wants ?? [])].map(([key]) => key)),
		],
		...(fresh === null ? {} : { fresh: 0 }),
	};
}
