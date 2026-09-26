/**
 * The walk into an element, a component tag and a slot: what the tag's attributes select, which
 * child it names and whether the walk enters it, and what the caller's markup is handed as.
 * Cases of `collect()` in collect.ts. See spec/pipeline.md.
 */
import { type Locals, mentions, declaring } from 'ast';
import { classes, spread, styles } from './attributes.ts';
import { inert } from './compose.ts';
import { isNode, refuse, span } from './node.ts';
import { RAW_TEXT_ELEMENTS, VALID_TAG_NAME, VOID_ELEMENTS } from './tags.ts';
import { waitsThrough } from './awaits.ts';
import { buried, chose, constantly, perItem, rechose, settled } from './branches.ts';
import {
	choosing,
	chosenComponent,
	IDENTIFIER,
	naming,
	onlyChild,
	refusingUnnamed,
	runChosen,
	unwrapped,
} from './components.ts';
import { merged } from './call-site.ts';
import { descend } from './descend.ts';
import { varies } from './dynamic.ts';
import {
	contents,
	expanded,
	handedTo,
	selection,
	takenApart,
	valueExpression,
} from './selection.ts';
import { held, hoisting, stamped, titleRun } from './stamps.ts';
import type { Group, Handed, Walk } from './walk-types.ts';
import { attributeText, handed, reading, stands } from './written.ts';
import type { AstNode } from './node.ts';
import { collect, type Stepper } from './collect.ts';

export function collectSlot(node: AstNode, walk: Walk, step: Stepper): void {
	const { expand, holes, site, source } = walk;
	// `SlotElement.js` writes `block_open`, `$.slot(...)`, `block_close`, and `$.slot` calls
	// what the caller put under this name in `$$slots` or, where the caller put nothing, the
	// element's own children as the fallback. Both anchors and the call stay in the source
	// for Svelte to render -- the caller's tag still holds its children, so the copy is
	// handed them exactly as the original would have been. What is walked here is whichever
	// of the two actually renders, in the scope it was written in.
	const named = attributeText(node, 'name') ?? 'children';
	const filled = site.given.get(named);
	if (filled === undefined) {
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
		[...filled.handed].map(([prop]) => ({ local: prop, prop, fallback: 'undefined' })),
		passed,
	);
	// Only the names the `let:` bound, under the locals it bound them to: the rest are this
	// component's own attribute names and shadowing the caller with them would be wrong.
	const shadow = new Map<string, string>();
	for (const [prop, local] of filled.handed) {
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
	const only = onlyChild({ nodes: filled.nodes });
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
	if (filled.walked !== undefined) {
		if (filled.handed.size === 0 && filled.planted !== true) return;
		refuse(
			`the markup filled to this component under \`${named}\` is rendered by more than one ` +
				`\`<slot>\`, and it holds a value or binds a name of its own, so one span of the ` +
				"caller's source would be rewritten once per slot and a marker in it would belong " +
				'in two places. It is a fragment called once per slot, the way a recursive ' +
				"component's body is, which the walk does not write yet",
		);
	}
	filled.walked = named;
	const planted = holes.length;
	// Through `held` rather than one node at a time: the group is a fragment of the caller's
	// and Svelte cleans it the same way, so a `{@const}` in it is hoisted and binds for its
	// siblings. Walked flat, every one of them reached the arm that refuses what the walk has
	// not been taught. `legacy` is the caller's, because the markup is.
	held(
		filled.nodes,
		{
			...walk,
			source: filled.source,
			edits: filled.edits,
			expand:
				shadow.size === 0
					? filled.expand
					: (one, extra) =>
							filled.expand(one, extra === undefined ? shadow : new Map([...shadow, ...extra])),
			snippets: filled.snippets,
			site: filled.site,
			legacy: filled.legacy,
			handedAsWritten: new Set(),
		},
		only,
	);
	// Whether the group put a marker in the bytes, which is what makes a second slot
	// impossible: a marker belongs in one place and the same markup at two slots puts it in
	// two. Recorded rather than reasoned about, since what the group holds is only known once
	// it is walked.
	filled.planted = holes.length > planted;
	return;
}

export function collectElement(node: AstNode, type: string, walk: Walk): void {
	const { blocks, dynamic, edits, expand, holes, pending, site, source, stream, within } = walk;
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
		// A `this` the script's run answers is a chain over the components the file imports,
		// each compared with the value inside the run's own module. See `runChosen`.
		const byRun = runChosen(node['expression'], walk);
		const expanding: Locals['rewrite'] =
			byRun === null
				? walk.expand
				: (one, extra, given) =>
						one === node['expression'] ? byRun : walk.expand(one, extra, given);
		// A `this` the request decides, which the payload bounds to one candidate and
		// nothing: a block with two branches, the alternate writing no bytes. The tag itself
		// stays, so Svelte writes the anchors `build_inline_component` writes -- `<!--[-->`
		// and `<!--[!-->`, which are not the numbered pair an `{#if}` writes -- and only the
		// expression is swapped. See `chosenComponent()`.
		// A `this` the source has already settled to nothing renders `<!--[!--><!--]-->` and
		// nothing else: `build_inline_component` builds the props object **inside** the `if`,
		// so neither the attributes nor the children are evaluated, and a spread whose keys
		// this compiler cannot list never has to be listed.
		if (constantly(settled(expanding(node['expression']), walk)) === false) {
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
		} else if (
			!refusingUnnamed &&
			mentions(settled(expanding(node['expression']), walk), walk.dynamic)
		) {
			// A component the request hands in that the source names none of. Svelte renders
			// whatever it is handed; this renders what it can hold, which is nothing for a
			// value that is nothing, and throws per request for anything else. Refused at the
			// build instead where the project asks for that. See spec/payload.md.
			const test = `$$unnamed(${expanding(node['expression'])})`;
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
			chose(walk, edits, where[0], where[1], index, 0, 'null', 'null');
			const whole = span(node);
			if (whole !== null) edits.push(stamped(walk, index, source, whole[1]));
			buried(walk, node['fragment']);
			return;
		} else if (!waitsThrough(node['expression'], expanding(node['expression']), walk)) {
			const chosen = choosing(expanding(node['expression']), 'svelte:component', walk);
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
			const tagNode = node['tag'];
			const quote = source[where[0] - 1];
			const literal =
				isNode(tagNode) &&
				(tagNode['type'] === 'Text' || tagNode['type'] === 'Literal') &&
				(quote === '"' || quote === "'") &&
				source[where[1]] === quote;
			const tag = literal ? JSON.stringify(source.slice(where[0], where[1])) : expand(node['tag']);
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
				? selection(node, source, expand, holes, edits, walk.selecting, skipped, dropped, (text) =>
						site.payload !== null ? !varies(text, walk) : true,
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
						// The class run's question, asked the same way: nothing of the expansion is
						// written anywhere on that answer. See spec/derivation.md.
						(text) => site.payload !== null && !varies(text, walk, true),
					);
		const handled =
			spreads.size > 0
				? spreads
				: classes(
						node,
						holes,
						edits,
						expand,
						pending,
						// Asked with the expansion's own helpers allowed, because nothing of that
						// expansion is written anywhere on this answer: the run is left exactly as
						// the author wrote it and Svelte builds it. See spec/derivation.md.
						(text) => site.payload !== null && !varies(text, walk, true),
					);
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
			const at: [number, number] | null =
				whole === null ? null : [whole[0] + 1, whole[0] + 1 + tag.length];
			const name = { type: 'Identifier', name: tag, start: at?.[0], end: at?.[1] };
			if (whole !== null && at !== null && !waitsThrough(name, expand(name), walk)) {
				const written = expand(name);
				// A component the request hands in that the source names none of, as on
				// `<svelte:component>`: nothing for a value that is nothing, a throw per request
				// for anything else. See `refusingUnnamed`.
				if (!refusingUnnamed && mentions(settled(written, walk), walk.dynamic)) {
					const test = `$$unnamed(${written})`;
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
					const opened = 'svelte:component this={null}';
					chose(walk, edits, at[0], at[1], index, 0, opened, opened);
					const close = `</${tag}>`;
					if (source.endsWith(close, whole[1])) {
						edits.push([whole[1] - close.length, whole[1], '</svelte:component>']);
					}
					edits.push(stamped(walk, index, source, whole[1]));
					buried(walk, node['fragment']);
					return;
				}
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
					if (site.payload !== null && !varies(handed(attr, expand), walk)) {
						continue;
					}
					if (whole !== null) {
						// The getter, written as the attribute it used to be rewritten to, with a
						// marker standing in it where the request decides the value -- which is what
						// `collect` would have done had `unbind.ts` written the attribute itself.
						const before = holes.length;
						edits.push([whole[0], whole[1], `${name}={${stands(handed(attr, expand), walk)}}`]);
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
		const inside = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
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
