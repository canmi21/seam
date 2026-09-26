/**
 * The copy a child is walked as -- the walk handed to its body, with the child's own names,
 * site and snippets -- and the call site rewritten around it once the body is walked. See
 * spec/derivation.md.
 */
/**
 * Entering a child component at a call site: what the tag passes, what the child's script
 * declares and changes, what a binding sends back, and the copy the child is walked as. See
 * spec/derivation.md.
 */
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { importsOf as importedBy, locals } from 'ast';
import { hands, importsOf, legacyMode, partial, propsOf } from './compose.ts';
import { type AstNode, isNode, relatesSiblings, span } from './node.ts';
import { type Snippet, snippetsIn } from './snippets.ts';
import { awaiting, blockedBy, blocking, movedBy } from './awaits.ts';
import { sentFor } from './branches.ts';
import { callSite, standsIn } from './call-site.ts';
import { hostedIn, placed, varies } from './dynamic.ts';
import { closing } from './handed.ts';
import { type Copy, type Walk } from './walk-types.ts';
import { stands } from './written.ts';

type Declares = NonNullable<ReturnType<typeof propsOf>>;
type Site = NonNullable<ReturnType<typeof callSite>>;

/** The child's copy and the walk over it. See `descend`. */
export function childOf(
	walk: Walk,
	file: string,
	raw: string,
	ast: AstNode,
	inner: [number, number, string][],
	declares: Declares,
	declared: ReturnType<typeof locals>,
	{
		held,
		bound,
		ranBy,
		inside,
		inertProps,
		fresh,
		recursion,
		groups,
		prelude,
		asks,
		wants,
	}: {
		held: ReadonlyMap<string, string>;
		bound: Map<string, string>;
		ranBy: Map<string, string>;
		inside: ReadonlySet<string>;
		inertProps: Site['inertProps'];
		fresh: string | null;
		recursion: string | null;
		groups: ReturnType<typeof hands>;
		prelude: string[];
		asks: [string, string][];
		wants: [string, string][];
	},
): { copy: Copy; child: Walk; fragmentAt: number } {
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
	// This copy's own settled names, and none of the caller's. See `sentFor`.
	const ownSent = sentFor(walk.site.sent, copy);
	const child: Walk = {
		...walk,
		source: raw,
		edits: inner,

		within: walk.within,
		expand: (expression, extra, given) => {
			const text = placed(
				declared.rewrite(
					expression,
					new Map([...bound, ...ranBy, ...(extra ?? new Map())]),
					given ?? ownSent,
				),
				expression,
				file,
			);
			return walk.trying === undefined ? text : walk.trying(text);
		},
		plain: (expression, extra) => declared.rewrite(expression, extra),
		runeOf: declared.rune,
		declares: declared.has,
		handedAsWritten: new Set(
			declares.filter((one) => inertProps.has(one.prop)).map((one) => one.local),
		),
		legacy: legacyMode(ast, file),
		sent: ownSent,
		snippets,
		siblings: relatesSiblings(ast),
		dynamic: inside,
		fresh: fresh === null ? walk.fresh : [...walk.fresh, fresh],
		site: {
			file,
			root: walk.site.root,
			blocked: blockedBy(ast),
			moved: movedBy(ast, inside),
			hosted: hostedIn(raw, file),
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
			sent: walk.site.sent,
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
	return { copy, child, fragmentAt };
}

/**
 * The call site's attributes written for the render: a spread emptied, a listed one kept to what
 * the request does not decide, a binding written last, and every other value stood in for.
 */
export function rewrittenCallSite(
	walk: Walk,
	node: AstNode,
	ahead: AstNode,
	attributes: unknown[],
	declares: Declares,
	held: ReadonlyMap<string, string>,
	site: Site,
): void {
	const { order, listed, inertProps, awaits } = site;
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
		// key. See `waitsOn()`.
		if ('spread' in part && part.at !== null) {
			const leftover = awaiting(part.spread) ? '{...await {}}' : '';
			walk.edits.push([part.at[0], part.at[1], leftover]);
		}
	}
	// A listed spread keeps what the request does not decide, which the render is handed as
	// written the way any such prop is, and loses what it does -- which the child's markers carry,
	// and which evaluated here would read the payload the render is not given.
	for (const one of listed) {
		if (one.at === null || walk.site.payload === null) continue;
		const kept = one.entries.filter(([, value]) => !varies(value, walk));
		if (kept.length === one.entries.length) continue;
		const text =
			kept.length > 0
				? `{...{ ${kept.map(([key, value]) => `${JSON.stringify(key)}: ${value}`).join(', ')} }}`
				: awaiting(one.grown)
					? '{...await {}}'
					: '';
		walk.edits.push([one.at[0], one.at[1], text]);
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
				const blocked = blocking(
					one['expression'],
					known === undefined ? standsIn(ahead, local) : JSON.stringify(known),
					walk,
				);
				// Written last, not where it stood. `push_prop(..., true)` delays a binding's
				// pair so it comes after the spreads -- "to avoid spreads overwriting them" --
				// and the fold this walk makes says so, so the render has to say so too.
				// `<Button bind:value {...props} />` with `value` in the spread wrote the
				// spread's where Svelte wrote the binding's.
				walk.edits.push([whole[0], whole[1], '']);
				const shut = closing(walk.source, node);
				// Before the slash of a self-closing tag, which is part of how it closes.
				const close = walk.source[shut - 1] === '/' ? shut - 1 : shut;
				walk.edits.push([close, close, ` ${name}={${blocked}} `]);
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
		// Still reading what the caller's expression read that Svelte's async mode makes wait, so
		// the tag is wrapped where Svelte wraps it. See `blocking()`.
		const blocked = blocking(
			parts.map((part) => (isNode(part) ? part['expression'] : undefined)),
			stood,
			walk,
		);
		const awaited = awaits.has(name) ? `await ${blocked}` : blocked;
		if (whole !== null && walk.source[whole[0]] === '{') {
			walk.edits.push([whole[0], whole[1], `${name}={${awaited}}`]);
			continue;
		}
		for (const part of parts) {
			if (!isNode(part) || part['type'] !== 'ExpressionTag') continue;
			const where = span(part['expression']);
			if (where !== null) walk.edits.push([where[0], where[1], awaited]);
		}
	}
}
