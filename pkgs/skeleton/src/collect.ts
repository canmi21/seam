/**
 * The walk over one file's markup: one pass that plants a marker wherever a value goes and
 * follows a block into its branches, a tag into the child it names, and a render tag into its
 * snippet. See spec/pipeline.md.
 */
import { basename } from 'node:path';
import { constant, type Locals, mentions, declaring } from 'ast';
import { classes, clsxed, spread, styles } from './attributes.ts';
import { carries, inert } from './compose.ts';
import { called, elseIf, isNode, namesIn, refuse, renders, span } from './node.ts';
import { OMITTED_IN_SSR } from './omitted.ts';
import { headOpensWith, sentinel } from './sentinel.ts';
import type { Stream } from './shape.ts';
import { supplied } from './snippets.ts';
import { RAW_TEXT_ELEMENTS, VALID_TAG_NAME, VOID_ELEMENTS } from './tags.ts';
import { awaiting, awaitsAtTop, blockedRead, blocking, waitsOn, waitsThrough } from './awaits.ts';
import { boundary, rawSnippet } from './boundary.ts';
import {
	buried,
	chose,
	constantly,
	keyed,
	oneBranch,
	perItem,
	reached,
	rechose,
	rewrapped,
	sentFor,
	settled,
	spanOfFragment,
} from './branches.ts';
import {
	candidateOf,
	choosing,
	chosenComponent,
	contains,
	IDENTIFIER,
	naming,
	onlyChild,
	opensWithText,
	parameterBinds,
	recurses,
	refusingUnnamed,
	runChosen,
	selfCall,
	standIn,
	stillDynamic,
	unwrapped,
} from './components.ts';
import { descend, merged } from './descend.ts';
import { rendersOnly, varies } from './dynamic.ts';
import {
	contents,
	expanded,
	handedTo,
	INERT,
	neutralise,
	REFUSED,
	selection,
	takenApart,
	valueExpression,
} from './selection.ts';
import {
	afterElse,
	afterTag,
	headFoundLate,
	held,
	hoisting,
	inertBodies,
	mirrored,
	stamped,
	titleRun,
} from './stamps.ts';
import { type Group, type Handed, type Walk } from './walk-types.ts';
import {
	asWritten,
	attributeText,
	handed,
	kept,
	leaves,
	parameterNames,
	reaches,
	reading,
	snippetNamed,
	stands,
} from './written.ts';

export function collect(node: unknown, walk: Walk): void {
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
					handedAsWritten: new Set(),
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
			// Inside a class value, what is written has to be exactly as readable to Svelte's CSS
			// analysis as what the author wrote -- no less and no more. So the author's own
			// expression stays, in the branch that is never taken. See `Walk.classValue`.
			const shielded = (text: string): string =>
				waitsOn(
					node['expression'],
					written,
					walk.inClass === true ? `(1 ? ${text} : (${source.slice(at[0], at[1])}))` : text,
					walk,
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
			// Inside a boundary that catches, whether the value throws is the request's question too.
			// See `Walk.holding`.
			if (
				site.payload !== null &&
				walk.opaque !== true &&
				walk.asking !== true &&
				(walk.holding !== true || rendersOnly(written, walk)) &&
				!varies(written, walk)
			) {
				edits.push([at[0], at[1], shielded(asWritten(node['expression'], written, walk))]);
				return;
			}
			// A value going to a component the walk could not enter, which has to survive being used
			// rather than only written out. See `stands`.
			if (walk.opaque === true) {
				edits.push([
					at[0],
					at[1],
					waitsOn(node['expression'], written, stands(written, walk), walk),
				]);
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
				// A `this` the script's run answers is a chain over the components the file imports,
				// each compared with the value inside the run's own module. See `runChosen`.
				const byRun = runChosen(node['expression'], walk);
				const expand: Locals['rewrite'] =
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
				} else if (
					!refusingUnnamed &&
					mentions(settled(expand(node['expression']), walk), walk.dynamic)
				) {
					// A component the request hands in that the source names none of. Svelte renders
					// whatever it is handed; this renders what it can hold, which is nothing for a
					// value that is nothing, and throws per request for anything else. Refused at the
					// build instead where the project asks for that. See spec/payload.md.
					const test = `$$unnamed(${expand(node['expression'])})`;
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
				} else if (!waitsThrough(node['expression'], expand(node['expression']), walk)) {
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
				// A raw snippet whose bytes the request decides is a raw hole over the author's own
				// function. See `rawSnippet()`.
				if (called !== null && rawSnippet(call, name, walk)) return;
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

			// Still reading what the argument read that Svelte's async mode makes wait, which is what
			// wraps the render tag in `$$renderer.async`. See `blocking()`.
			for (const [index, argument] of given.entries()) {
				const at = span(argument);
				if (at !== null) {
					edits.push([at[0], at[1], blocking(argument, one.holds[index] ?? 'null', walk)]);
				}
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
				// A key that changes something as it is evaluated is held, by place, since two keys
				// written alike are two evaluations; and every value in the branch reads the holds
				// first, in order, because Svelte takes the pattern apart as the branch opens.
				const keys: string[] = [];
				const bound = isNode(value)
					? takenApart(
							value,
							`(${expression})`,
							expand,
							() => 'this await',
							(text, place) => {
								const key = `$$hold(${String(kept(`${text} /*@key:${String(place)} */`, walk))})`;
								keys.push(key);
								return key;
							},
						)
					: new Map<string, string>();
				const inner: Locals['rewrite'] = (child, more) => {
					const text = expand(child, more === undefined ? bound : new Map([...bound, ...more]));
					return keys.length === 0 ? text : `(${keys.join(', ')}, ${text})`;
				};
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
				!site.mute.has(keyed(walk, test))
			) {
				const answer = site.decided.get(keyed(walk, test));
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
				if (!site.asks.some(([key]) => key === keyed(walk, test))) {
					const written = `typeof (${source.slice(at[0], at[1])})?.then === 'function'`;
					site.asks.push([keyed(walk, test), written]);
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
			// Read out of `3-transform/server/visitors/SvelteBoundary.js`. Given a `pending` snippet a
			// synchronous render is pending by definition: `<!--[!-->`, that body, `<!--]-->`, one
			// shape. Given a `failed` one, whether the children throw and what `transformError` made
			// of it are the request's, and that is a block, in `boundary()`. Given neither, the
			// anchors are a pair the assembler copies as bytes. `pending={p}` and `failed={f}` were
			// written as the tag form first; see `boundaries()` in snippets.ts.
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
			// A `failed` snippet makes a block: whether the children threw and what `transformError`
			// made of it are the request's. See `boundary()`.
			if (failedSnippet !== undefined) {
				boundary(
					node,
					children.filter((child) => child !== failedSnippet),
					failedSnippet,
					walk,
					fragment,
				);
				return;
			}
			// As a fragment, so a `{@const}` or `{const}` written straight inside the boundary binds
			// for the whole of it -- `clean_nodes` hoists them from the boundary's fragment as from
			// any other.
			held(children, walk, walk.standalone && isNode(fragment) ? onlyChild(fragment) : null);
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
			// **Up to the first test the request decides.** A later test is reached only where every
			// earlier one was false, so a chain whose render-decided prefix holds a true one is decided
			// whatever comes after: `{#if $foo}blah{:else if bar()}` over a `bar` the host holds is
			// the first branch for every request, and `bar()` is never called.
			const deciding = tests.findIndex(
				(test) => varies(test, walk, true) || site.mute.has(keyed(walk, test)),
			);
			const prefix = deciding === -1 ? tests : tests.slice(0, deciding);
			const heard = reached(prefix.map((test) => site.decided.get(keyed(walk, test))));
			if (
				site.payload !== null &&
				walk.asking !== true &&
				deciding !== -1 &&
				heard !== null &&
				heard >= 0
			) {
				oneBranch(walk, chain, tests, heard, otherwise, edits, step);
				return;
			}
			if (
				site.payload !== null &&
				walk.asking !== true &&
				deciding !== 0 &&
				(deciding === -1 || heard === null)
			) {
				const answers = prefix.map((test) => site.decided.get(keyed(walk, test)));
				const at = reached(answers);
				if (at !== null && deciding === -1) {
					oneBranch(walk, chain, tests, at, otherwise, edits, step);
					return;
				}
				// One test at a time, in source order, and never past one whose answer is not in yet.
				// A chain is a sequence of tests Svelte evaluates until one is true, so a later test
				// is only reached where every earlier one was false -- and the ask is written into the
				// script, where it runs whatever branch the render takes. Asked all at once,
				// `{#if $foo}blah{:else if bar()}` evaluated `bar()` for a chain whose first test is
				// true, and `bar` is a name that sample never binds.
				for (const [index, test] of prefix.entries()) {
					if (answers[index] === false) continue;
					if (!site.asks.some(([key]) => key === keyed(walk, test))) {
						site.asks.push([keyed(walk, test), asWritten(chain[index]?.['test'], test, walk)]);
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
				// `IfBlock.js` wraps the chain on its head's `has_await`, the first test's, and on the
				// blockers its test reads, which is `async_block` around the same pair.
				...(awaiting(tests[0] ?? '') || blockedRead(chain[0]?.['test'], walk)
					? { wrapped: true as const }
					: {}),
			});
			// What a binding inside this block settles is read against the tests as they stand where
			// the block is walked, which is the pass's own source order. See `Site.tested`.
			const settledHere = sentFor(site.sends, site.copy);
			if (settledHere.size > 0) {
				site.tested.set(
					index,
					chain.map((one, at) => expand(one['test'], new Map(settledHere)) || (tests[at] ?? '')),
				);
			}

			// A chain no test of which the request decides is the render's to answer, and it is
			// asked above: the tests are written as the author wrote them, so the render takes the
			// branch it would take and evaluates nothing in the others. Forced to its first branch
			// instead, the render evaluated a body written for a request that never comes -- an
			// `await` of a promise nothing on the server resolves -- and never settled. The answer
			// decides the branch on the next pass, so the render's own choice here costs nothing.
			// See spec/pipeline.md, "A test the render answers is not forced".
			const answered = site.payload !== null && deciding === -1;
			for (const [branch, one] of chain.entries()) {
				const at = span(one['test']);
				const held = tests[branch] ?? '';
				if (at !== null) {
					// The author's test carries its own await and reads its own names, so it is not
					// wrapped the way a constant standing for it is.
					const written = answered ? asWritten(one['test'], held, walk) : null;
					chose(
						walk,
						edits,
						at[0],
						at[1],
						index,
						branch,
						written ?? waitsOn(one['test'], held, 'true', walk),
						written ?? waitsOn(one['test'], held, 'false', walk),
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
			// source held. See `waitsOn()`.
			const awaits = written;
			if (
				site.payload !== null &&
				walk.asking !== true &&
				!constant(written) &&
				!varies(written, walk) &&
				!site.mute.has(keyed(walk, written))
			) {
				const held = site.told.get(keyed(walk, written));
				if (held === undefined) {
					if (!site.wants.some(([key]) => key === keyed(walk, written))) {
						site.wants.push([keyed(walk, written), asWritten(node['expression'], written, walk)]);
					}
					// This render is only asked the value and is thrown away, and a body that awaits,
					// run over a placeholder item, runs what Svelte may never run: over an empty list it
					// does not, and `{await Promise.reject(...)}` in one threw here. So that body is left
					// out of it, and not walked, since an edit inside it would outlive the one that cuts
					// it. The next walk is told. A body that awaits nothing is walked as ever: what it
					// asks and binds is read in this pass.
					const inner = spanOfFragment(node['body']);
					if (inner !== null && awaitsAtTop(node['body'])) {
						edits.push([inner[0], inner[1], '']);
						if (isNode(fallback)) step(fallback);
						return;
					}
				} else {
					written = held;
				}
			}
			// **A source the build knows is empty never renders its body**, so the body is not
			// rendered here either, and the block is the bytes of its fallback: the render writes
			// `<!--[!-->`, the fallback and `<!--]-->` from the source as written. Rendered over a
			// placeholder item instead it ran what Svelte never runs -- `async-each-fallback-hoisting`
			// rejects in there on purpose.
			if (/^\[\s*\]$/.test(unwrapped(written)) && !constant(awaits)) {
				buried(walk, node['body']);
				const inner = spanOfFragment(node['body']);
				if (inner !== null) edits.push([inner[0], inner[1], '']);
				if (isNode(fallback)) step(fallback);
				return;
			}
			blocks.push({
				index,
				kind: 'each',
				within: [...within],
				stream,
				expression: written,
				...(awaiting(awaits) || blockedRead(node['expression'], walk)
					? { wrapped: true as const }
					: {}),
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
				waitsOn(node['expression'], awaits, `[${element}]`, walk, true),
				waitsOn(node['expression'], awaits, '[]', walk, true),
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
