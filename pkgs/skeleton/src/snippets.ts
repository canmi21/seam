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
	/** Every `{@render}` that calls it, so a call inside its own body can be told from one outside. */
	calls: AstNode[];
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
export function inlined(given: string): string {
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
}

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
				// Never written, so it goes; and a declaration nothing else renders would be a
				// refusal about a body nobody writes.
				edits.push([where[0], where[1], '']);
				if (named !== null && declared !== undefined && (snippets.get(named)?.renders ?? 0) === 0) {
					cut.add(named);
				}
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
