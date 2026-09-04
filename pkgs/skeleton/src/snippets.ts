import { parse } from 'svelte/compiler';
import { apply } from 'ast';
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
			one.node = node;
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
export function inlined(source: string): string {
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
		const body = (to: string) => text.slice(0, id[0] - at[0]) + to + text.slice(id[1] - at[0]);
		edits.push([at[0], at[1], names.map(body).join('')]);
		for (const [index, site] of sites.entries()) {
			const where = span(site);
			const to = names[index];
			if (where !== null && to !== undefined) edits.push([where[0], where[1], to]);
		}
	}

	return apply(source, edits);
}
