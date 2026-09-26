/**
 * The walk over an expression tag, a render tag and a snippet: where a value goes into the bytes,
 * and where a snippet's body is rendered at each call. Cases of `collect()` in collect.ts. See
 * spec/pipeline.md.
 */
import { basename } from 'node:path';
import { constant, type Locals, mentions } from 'ast';
import { clsxed } from './attributes.ts';
import { called, isNode, refuse, renders, span } from './node.ts';
import { sentinel } from './sentinel.ts';
import { supplied } from './snippets.ts';
import { blocking, waitsOn } from './awaits.ts';
import { rawSnippet } from './boundary.ts';
import { settled } from './branches.ts';
import {
	candidateOf,
	opensWithText,
	parameterBinds,
	recurses,
	standIn,
	stillDynamic,
} from './components.ts';
import { rendersOnly, varies } from './dynamic.ts';
import { neutralise, takenApart } from './selection.ts';
import { headFoundLate, inertBodies, stamped } from './stamps.ts';
import type { Walk } from './walk-types.ts';
import { asWritten, parameterNames, reaches, stands } from './written.ts';
import type { AstNode } from './node.ts';
import { collect } from './collect.ts';

export function collectTag(node: AstNode, type: string, walk: Walk): void {
	const { edits, expand, holes, site, source } = walk;
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
		edits.push([at[0], at[1], waitsOn(node['expression'], written, stands(written, walk), walk)]);
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

export function collectSnippet(node: AstNode, walk: Walk): void {
	const { snippets } = walk;
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

export function collectRender(node: AstNode, walk: Walk): void {
	const { blocks, dynamic, edits, expand, site, snippets, source, stream, within } = walk;
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
		const expanded = isNode(call) ? expand(call) : null;
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
			expanded !== null &&
			known &&
			site.payload !== null &&
			inertBodies(snippets, walk) &&
			!varies(expanded, walk, true)
		)
			return;
		if (process.env['SEAM_TRACE'] !== undefined) {
			console.error(
				`[seam] render of ${String(name)} in ${site.file}: given ${JSON.stringify([...site.given.keys()])}, stack ${site.stack.map((file) => basename(file)).join(' > ')}`,
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
		if (expanded !== null && rawSnippet(call, name, walk)) return;
		refuse(
			`\`{@render ${String(name)}()}\` in ${basename(site.file)} names no \`{#snippet}\` this ` +
				'compiler can follow it to, and the call reads something the request decides, so ' +
				'the render cannot be left to evaluate it either. `RenderTag.js` visits the callee ' +
				'as an expression, so it may be any value; what this follows is a name, a default ' +
				'and a lookup in a table the source writes out. It stands for ' +
				`\`${String(expanded ?? name)
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
		const parameters = Array.isArray(declaration['parameters']) ? declaration['parameters'] : [];
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
		neutralise(parameter['type'] === 'AssignmentPattern' ? parameter['left'] : parameter, edits);
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
