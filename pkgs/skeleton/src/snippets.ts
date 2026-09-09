import { parse } from 'svelte/compiler';
import { apply, bySource } from 'ast';
import { type AstNode, called, isNode, namesIn, refuse, renders, span } from './node.ts';

/**
 * What the markup declares under `{#snippet}`, and the one rewrite that makes a snippet ordinary.
 *
 * A snippet is a function: `{#snippet a(v)}` compiles to `function a($$renderer, v)` and
 * `{@render a(x)}` to `a($$renderer, x)`. So the two things this file answers are what each name
 * is -- declared here, or arrived as a prop, or passed on to a child -- and how many times it is
 * rendered, because a body that stands in two places cannot hold markers that stand in one.
 */

/** What a component declares under one snippet name, and how many times it renders it. */
export interface Snippet {
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
	/** Every `{@render}` that calls it, so a call inside its own body can be told from one outside. */
	calls: AstNode[];
	/**
	 * Whether some site in this component may render it without naming it unambiguously.
	 *
	 * Svelte's own model, read out of `2-analyze`: `analysis.snippet_renderers` maps each **site**
	 * -- a render tag, and a component tag, both of which render snippets -- to whether it resolves
	 * to a particular declaration, and `index.js` then writes `node.metadata.snippets =
	 * analysis.snippets` for one that does not. `is_resolved_snippet` is the test: a binding that
	 * is an import, a prop, or a `{#snippet}` resolves, and anything else -- a `$derived` holding
	 * one of two snippets -- does not.
	 *
	 * A component tag resolves through its attributes: `shared/component.js` adds the snippet a
	 * `foo={bar}` names to the tag's set, and a spread or a `bind:` makes the tag unresolved.
	 *
	 * This compiler counted only the render tags whose callee is a name it declares, so a snippet
	 * handed over as `<Kid {foo} />`, or reached through a `$derived`, read as one nobody renders.
	 */
	maybe?: true;
	/**
	 * The declaration, so its body can be walked where it is rendered rather than where it sits.
	 *
	 * Svelte declares a snippet as a function and inlines nothing: the body writes its bytes at the
	 * `{@render}` that calls it. Walking it at the declaration numbered its blocks against the
	 * branches enclosing *that*, so a snippet declared at the top of a component and rendered inside
	 * an `{:else if}` had blocks no render ever held -- which the assembler then went looking for.
	 */
	node?: AstNode;
}

/**
 * Whether every name a passed snippet's parameters bind is only ever rendered, never read.
 *
 * A `{#snippet}` written inside a component's tag is a prop that component receives, and the
 * component decides what to call it with. Where a parameter's value is *written* -- into a class,
 * into a test -- there is nothing this compiler can put there, and it is refused.
 *
 * Where the parameter is itself a snippet and the body only renders it, there is nothing to put
 * there either, and nothing needs to be: `{#snippet link({ children })}<a>{@render children?.()}</a>`
 * is asking the component for the markup it holds, and the component supplies it during the render
 * like any other component writing its own bytes. Read out of the server transform: a snippet is a
 * plain function declaration and `{@render x()}` is `x?.($$renderer)`, so a parameter that is only
 * a callee is a function the render already has.
 *
 * Measured on paraglide, which is the shape this is for: the markup part its message wraps is
 * `String(i?.language)`, so what comes back through it is the marker the caller put in `inputs` --
 * a hole, resolved per request, rather than bytes baked in.
 *
 * @returns the names the component supplies, or null where one of them is read.
 */
export function supplied(node: AstNode): ReadonlySet<string> | null {
	const parameters = Array.isArray(node['parameters']) ? node['parameters'] : [];
	const names = new Set<string>();
	for (const parameter of parameters) namesIn(parameter, names);
	if (names.size === 0) return names;

	// Every identifier the body reads, and separately every one that is a `{@render}`'s callee.
	const callees = new Set<unknown>();
	const read: AstNode[] = [];
	const walk = (at: unknown): void => {
		if (Array.isArray(at)) {
			for (const one of at) walk(one);
			return;
		}
		if (!isNode(at)) return;
		if (at['type'] === 'RenderTag') {
			const callee = called(at['expression'])?.['callee'];
			if (isNode(callee)) callees.add(callee);
		}
		if (at['type'] === 'Identifier') read.push(at);
		for (const value of Object.values(at)) walk(value);
	};
	walk(node['body']);

	for (const one of read) {
		const name = one['name'];
		if (typeof name === 'string' && names.has(name) && !callees.has(one)) return null;
	}
	return names;
}

/**
 * Every snippet the markup declares, and every `{@render}` that names one.
 *
 * Collected before the walk rather than during it, because a render tag may be written above the
 * snippet it names -- which is legal, and which the compiler handles: a marker carries its own
 * index, so where it comes back is not where it was written.
 */
export function snippetsIn(node: unknown, into: Map<string, Snippet>, inside = false): void {
	const sites = { unresolved: false, named: new Set<string>(), rendered: new Set<string>() };
	collecting(node, into, inside, sites);
	// A render tag naming something this file does not declare as a snippet resolves only where the
	// binding is an import or a prop, which `is_resolved_snippet` reads off Svelte's scope and this
	// does not have. Svelte's own answer for what it cannot tell is that the site is unresolved, so
	// that is the answer here too: it links more snippets, which only relaxes.
	for (const named of sites.rendered) {
		if (into.get(named)?.declared !== true) sites.unresolved = true;
	}
	// A site that names no particular declaration renders any of them, which is what
	// `analysis.snippets` on an unresolved renderer says. A name a component tag was handed renders
	// that one. Either way the snippet is not one nobody renders. See `Snippet.maybe`.
	for (const [named, one] of into) {
		if (!one.declared) continue;
		if (sites.unresolved || sites.named.has(named)) one.maybe = true;
	}
}

function collecting(
	node: unknown,
	into: Map<string, Snippet>,
	inside: boolean,
	sites: { unresolved: boolean; named: Set<string>; rendered: Set<string> },
): void {
	if (Array.isArray(node)) {
		for (const one of node) collecting(one, into, inside, sites);
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
				calls: [],
			};
			const parameters = Array.isArray(node['parameters']) ? node['parameters'] : [];
			one.declared = true;
			one.node = node;
			one.parameters = parameters.length;
			one.passed = inside;
			one.holds = parameters.map((parameter) => {
				// A default wraps the pattern, and what is handed has to suit the pattern inside.
				const inner =
					isNode(parameter) && parameter['type'] === 'AssignmentPattern'
						? parameter['left']
						: parameter;
				const kind = isNode(inner) ? inner['type'] : undefined;
				return kind === 'ObjectPattern' ? '{}' : kind === 'ArrayPattern' ? '[]' : 'null';
			});
			into.set(id['name'], one);
		}
	}
	if (node['type'] === 'RenderTag') {
		const call = called(node['expression']);
		const name = renders(node);
		// `is_resolved_snippet` in `2-analyze/visitors/shared/snippets.js`: a callee that is not a
		// plain reference names no particular declaration, and neither does one whose name nothing
		// here declares -- a `$derived` holding one of two snippets is that. Svelte then links the
		// site to every snippet in the component, and so does this. See `Snippet.maybe`.
		if (name === null) sites.unresolved = true;
		else {
			sites.named.add(name);
			sites.rendered.add(name);
		}
		if (call !== null && name !== null) {
			const one = into.get(name) ?? {
				declared: false,
				parameters: 0,
				renders: 0,
				passed: false,
				holds: [],
				args: [],
				calls: [],
			};
			one.renders += 1;
			one.args = Array.isArray(call['arguments']) ? call['arguments'] : [];
			one.calls.push(node);
			into.set(name, one);
		}
	}
	// A component tag renders snippets too: `shared/component.js` adds the one a `foo={bar}` names
	// to the tag's set, and a spread or a `bind:` leaves the tag naming none in particular.
	if (node['type'] === 'Component' || node['type'] === 'SvelteComponent') {
		for (const attribute of Array.isArray(node['attributes']) ? node['attributes'] : []) {
			if (!isNode(attribute)) continue;
			if (attribute['type'] === 'SpreadAttribute' || attribute['type'] === 'BindDirective') {
				sites.unresolved = true;
				continue;
			}
			const held = attributeName(attribute);
			if (held !== null) sites.named.add(held);
		}
	}
	// Inside a component's tag, a snippet is a prop rather than something this component renders.
	const within = inside || node['type'] === 'Component' || node['type'] === 'SvelteComponent';
	for (const value of Object.values(node)) collecting(value, into, within, sites);
}

/** The bare name an attribute's value is, where it is one: `{foo}` or `bar={foo}`. */
function attributeName(attribute: AstNode): string | null {
	if (attribute['type'] !== 'Attribute') return null;
	const parts = Array.isArray(attribute['value']) ? attribute['value'] : [attribute['value']];
	if (parts.length !== 1) return null;
	const [only] = parts;
	if (!isNode(only) || only['type'] !== 'ExpressionTag') return null;
	const held = only['expression'];
	if (!isNode(held) || held['type'] !== 'Identifier') return null;
	return typeof held['name'] === 'string' ? held['name'] : null;
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
export const inlined: (given: string) => string = bySource((given) => {
	const source = boundaries(given);
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
		// A snippet that renders itself is not copied: it is a fragment the runtime calls, with the
		// call inside its body a call of the same fragment, and the walk takes it as one. See
		// spec/ir.md.
		if (
			sites.some((site) => {
				const where = span(site);
				return where !== null && where[0] > at[0] && where[1] < at[1];
			})
		) {
			continue;
		}
		const text = source.slice(at[0], at[1]);
		const names = sites.map((_, index) => naming(name, index));
		const body = (to: string) => text.slice(0, id[0] - at[0]) + to + text.slice(id[1] - at[0]);
		edits.push([at[0], at[1], names.map(body).join('')]);
		for (const [index, site] of sites.entries()) {
			const where = span(site);
			const to = names[index];
			if (where !== null && to !== undefined) edits.push([where[0], where[1], to]);
		}
	}

	return apply(source, edits);
});

/**
 * A boundary's `pending` and `failed` handed as attributes, written the way the tag form is.
 *
 * `SvelteBoundary.js` reads both the same way once it has them: `pending={p}` calls `p` between
 * `<!--[!-->` and `<!--]-->` and writes none of the children, exactly as `{#snippet pending()}`
 * inside the tag does, and `failed` goes into the props of `$$renderer.boundary`, which writes
 * nothing for it during a render that does not throw. So a `pending` naming a snippet this file
 * declares with no parameters becomes that snippet, copied inside the tag, and a `failed` goes
 * from the tag; the walk then sees the shape it already takes.
 *
 * What stays refused is a `pending` that is not such a name. Svelte's scope cannot then prove it
 * defined and writes `if (p) { pending } else { children }`, a choice per request over a snippet
 * that arrived as a value -- the same refusal as a `{@render}` of a snippet from a prop.
 */
function boundaries(source: string): string {
	if (!source.includes('<svelte:boundary')) return source;
	const ast = parse(source, { modern: true }) as unknown as AstNode;
	const snippets = new Map<string, Snippet>();
	snippetsIn(ast['fragment'], snippets);

	const declarations = new Map<string, AstNode>();
	const found: AstNode[] = [];
	const find = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const one of node) find(one);
			return;
		}
		if (!isNode(node)) return;
		if (node['type'] === 'SnippetBlock') {
			const id = node['expression'];
			if (isNode(id) && typeof id['name'] === 'string') declarations.set(id['name'], node);
		}
		if (node['type'] === 'SvelteBoundary') found.push(node);
		for (const value of Object.values(node)) find(value);
	};
	find(ast['fragment']);
	if (found.length === 0) return source;

	/** The parameter list of a declaration, `(e)` or `()`, as written. */
	const paramsOf = (block: AstNode): string | null => {
		const at = span(block);
		const id = span(block['expression']);
		if (at === null || id === null) return null;
		const close = source.indexOf('}', id[1]);
		return close < 0 ? null : source.slice(id[1], close);
	};

	/** The text between `{#snippet name()}` and `{/snippet}` of a declaration. */
	const bodyOf = (block: AstNode): string | null => {
		const at = span(block);
		const id = span(block['expression']);
		if (at === null || id === null) return null;
		const text = source.slice(at[0], at[1]);
		const open = text.indexOf('}', id[1] - at[0]);
		const close = text.lastIndexOf('{/snippet}');
		if (open < 0 || close < 0 || close <= open) return null;
		return text.slice(open + 1, close);
	};

	const edits: [number, number, string][] = [];
	const cut = new Set<string>();
	for (const boundary of found) {
		const attributes = Array.isArray(boundary['attributes']) ? boundary['attributes'] : [];
		let after = span(boundary)?.[0] ?? 0;
		for (const attribute of attributes) {
			const where = span(attribute);
			if (where !== null) after = Math.max(after, where[1]);
		}
		const opening = source.indexOf('>', after);
		for (const attribute of attributes) {
			if (!isNode(attribute) || attribute['type'] !== 'Attribute') continue;
			const name = attribute['name'];
			if (name !== 'pending' && name !== 'failed') continue;
			const where = span(attribute);
			if (where === null) continue;
			const value = attribute['value'];
			const [only] = Array.isArray(value) ? value : [value];
			const expression =
				isNode(only) && only['type'] === 'ExpressionTag' ? only['expression'] : null;
			const named =
				isNode(expression) &&
				expression['type'] === 'Identifier' &&
				typeof expression['name'] === 'string'
					? expression['name']
					: null;
			const declared = named === null ? undefined : declarations.get(named);
			if (name === 'failed') {
				// **Not "never written".** `renderer.boundary` rethrows where `props.failed` is
				// missing, so taking it off the tag stopped the boundary catching at all and the
				// author's own error came back as a compile failure -- four of Svelte's samples.
				// Copied inside the tag instead, the way `pending` is, and with its parameter kept:
				// `SvelteBoundary.js` finds a `{#snippet failed}` in the fragment and puts the
				// function in the props, which is the same place the attribute would have gone.
				const at = declared === undefined ? null : span(declared);
				if (named === null || declared === undefined || at === null) {
					refuse(
						'`<svelte:boundary failed={...}>` given anything but a snippet this file declares ' +
							'is not handled yet: `renderer.boundary` calls it with the error it caught, and a ' +
							'snippet arriving as a value is one this compiler cannot see the body of',
					);
				}
				if ((snippets.get(named)?.renders ?? 0) > 0) {
					refuse(
						`\`${named}\` is a boundary's \`failed\` snippet and is rendered elsewhere as well, ` +
							'so copying it inside the tag would declare the name twice',
					);
				}
				// Renamed to `failed`, which is the name `SvelteBoundary.js` looks for in the fragment,
				// and with its parameters kept: the snippet is called with the error the boundary
				// caught. Copied the way `pending` is, since the attribute form and the tag form are
				// the same thing to that visitor.
				const body = bodyOf(declared);
				const parameters = paramsOf(declared);
				if (body === null || parameters === null) {
					refuse(
						'`<svelte:boundary failed={...}>` naming a snippet this compiler cannot read the ' +
							'body of is not handled yet',
					);
				}
				edits.push([where[0], where[1], '']);
				if (opening >= 0) {
					edits.push([opening + 1, opening + 1, `{#snippet failed${parameters}}${body}{/snippet}`]);
				}
				cut.add(named);
				continue;
			}
			const body = declared === undefined ? null : bodyOf(declared);
			if (
				named === null ||
				declared === undefined ||
				body === null ||
				snippets.get(named)?.parameters !== 0
			) {
				refuse(
					'`<svelte:boundary pending={...}>` given anything but a snippet this file declares ' +
						'with no parameters is not handled yet: Svelte then chooses per request between the ' +
						'snippet and the children by whether the value is nullish, which is a snippet ' +
						'arriving as a value',
				);
			}
			edits.push([where[0], where[1], '']);
			if (opening >= 0)
				edits.push([opening + 1, opening + 1, `{#snippet pending()}${body}{/snippet}`]);
		}
	}
	for (const name of cut) {
		const at = span(declarations.get(name));
		if (at !== null) edits.push([at[0], at[1], '']);
	}
	return edits.length === 0 ? source : apply(source, edits);
}
