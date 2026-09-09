import { basename } from 'node:path';
import { literalOf, type Locals, mentions, pathOf, reduce } from 'ast';
import { type AstNode, isNode, refuse, span } from './node.ts';
import { type Snippet, snippetsIn } from './snippets.ts';
import type { Given, Walk } from './walk.ts';

/**
 * Everything composition needs except the descent itself.
 *
 * A component compiles to a plain call, so entering one is a matter of reading what its `$props()`
 * declares, binding each name to what the call site passes, and pointing the tag at the copy the
 * walk rewrites. Those readings are here; `descend` in `walk.ts` is what puts them together, and
 * it is there because it and the walk call each other.
 */

/**
 * What a component's `$props()` binds: the name the markup uses, the prop it arrives as, and what
 * it holds when the call site passes nothing.
 *
 * A prop the caller leaves out is its default, and where there is no default it is `undefined` --
 * which is what Svelte's own output does, since `$props()` destructures the props object. Missing
 * this wrote the wrong bytes rather than refusing, and only the comparison against Svelte said so.
 *
 * A rest element, `...rest`, gathers whatever the caller passed and the pattern did not name, and
 * at a call site that is known: it is the object of the caller's other attributes, which is what
 * `$props()` destructuring leaves in it. It comes back with `rest` set and `descend` builds the
 * object. Null where the pattern is one this cannot read.
 */
export function propsOf(
	ast: AstNode,
	source: string,
):
	| {
			local: string;
			prop: string;
			fallback: string;
			at?: unknown;
			rest?: true;
			bindable?: true;
			/** `let props = $props()`: the whole object the call site passed, bound under one name. */
			whole?: true;
	  }[]
	| null {
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	// `bindable` is what `bind_props` looks for: `binding.kind === 'bindable_prop'`. In legacy mode
	// every `export let` is one; in runes mode only a `$bindable()` is, and Svelte's own comment
	// beside the call says the rest have "no effect in runes mode other than throwing an error".
	// So a `bind:` on a runes prop with a plain default sends nothing back at all -- measured.
	const found: {
		local: string;
		prop: string;
		fallback: string;
		at?: unknown;
		rest?: true;
		bindable?: true;
		/** `let props = $props()`: the whole object the call site passed, bound under one name. */
		whole?: true;
	}[] = [];
	// `export let` and `export { a }` are props **in legacy mode only**. In runes mode `export let`
	// is an error and `export { a }` is a readonly export of whatever the name holds -- a `$state`,
	// say -- which `analysis.exports` carries to `bind_props` beside the bindable props rather than
	// as one of them. Read the way `2-analyze/index.js` reads it: a file is runes where anything in
	// its scripts references a rune, and legacy otherwise.
	const legacy = !usesRunes(body);

	for (const statement of body) {
		// `export let` is Svelte 4's spelling of a prop and Svelte 5 still compiles it. Read here
		// rather than rewritten into `$props()`, because `$props()` puts the file in runes mode and
		// `analysis.runes` decides far more than how props are declared. See spec/roadmap.md.
		if (legacy && isNode(statement) && statement['type'] === 'ExportNamedDeclaration') {
			const held = statement['declaration'];
			const kind = isNode(held) ? held['kind'] : undefined;
			// `export { a, b as c }` with no declaration of its own: the other legacy spelling, and
			// the only one that can give a prop a name the local does not have. Svelte's
			// `analysis.exports` carries the pair, and `prop_alias` is what the exported name is.
			// The default is the local's own initialiser, wherever it was declared.
			if (!isNode(held)) {
				for (const one of Array.isArray(statement['specifiers']) ? statement['specifiers'] : []) {
					if (!isNode(one)) continue;
					const from = one['local'];
					const to = one['exported'];
					if (!isNode(from) || typeof from['name'] !== 'string') continue;
					if (!isNode(to) || typeof to['name'] !== 'string') continue;
					const how = declaredAs(body, from['name']);
					// Not a prop: a readonly export, which `exportedBy` in walk.ts reads instead.
					if (how === null || how.kind === 'readonly') continue;
					if (how.kind === 'pattern') {
						refuse(
							`\`export { ${from['name']} }\` names something a pattern binds, whose value is ` +
								"not an initialiser this compiler can read as the prop's default. Declare it " +
								'on its own. See spec/refusals.md',
						);
					}
					const at = span(how.init);
					found.push({
						local: from['name'],
						prop: to['name'],
						fallback: at === null ? 'undefined' : source.slice(at[0], at[1]),
						bindable: true,
						...(isNode(how.init) ? { at: how.init } : {}),
					});
				}
				continue;
			}
			if (held['type'] !== 'VariableDeclaration') continue;
			// `export const`, `export function` and `export class` are readonly exports rather than
			// props: a caller cannot pass one. See `exportedBy` in walk.ts.
			if (kind !== 'let' && kind !== 'var') continue;
			for (const one of Array.isArray(held['declarations']) ? held['declarations'] : []) {
				if (!isNode(one)) continue;
				const id = one['id'];
				if (!isNode(id) || id['type'] !== 'Identifier' || typeof id['name'] !== 'string') {
					refuse('`export let` of a pattern is not a prop this compiler can name');
				}
				const init = span(one['init']);
				found.push({
					local: id['name'],
					prop: id['name'],
					fallback: init === null ? 'undefined' : source.slice(init[0], init[1]),
					bindable: true,
					...(isNode(one['init']) ? { at: one['init'] } : {}),
				});
			}
			continue;
		}
		if (!isNode(statement) || statement['type'] !== 'VariableDeclaration') continue;
		const declarations = Array.isArray(statement['declarations']) ? statement['declarations'] : [];
		for (const one of declarations) {
			if (!isNode(one)) continue;
			const init = one['init'];
			const callee = isNode(init) ? init['callee'] : undefined;
			if (!isNode(callee) || callee['name'] !== '$props') continue;
			const id = one['id'];
			// `let props = $props()` binds the whole object the call site passed rather than
			// destructuring it. `transform-server.js` says which object -- `sanitize_props($$props)`
			// -- and the walk has it: the same one `$$props` is bound to. Not a rest, which gathers
			// what a pattern did not name; there is no pattern.
			if (isNode(id) && id['type'] === 'Identifier' && typeof id['name'] === 'string') {
				found.push({ local: id['name'], prop: '', fallback: '{}', whole: true });
				continue;
			}
			if (!isNode(id) || id['type'] !== 'ObjectPattern') return null;
			for (const property of Array.isArray(id['properties']) ? id['properties'] : []) {
				if (isNode(property) && property['type'] === 'RestElement') {
					const argument = property['argument'];
					if (!isNode(argument) || typeof argument['name'] !== 'string') return null;
					found.push({ local: argument['name'], prop: '', fallback: '{}', rest: true });
					continue;
				}
				if (!isNode(property) || property['type'] !== 'Property') return null;
				const key = property['key'];
				const value = property['value'];
				// A key is an identifier or a string, and a prop whose name is not an identifier can
				// only be written as one: `const { 'kebab-case': x } = $props()`. `property.computed`
				// is a key nobody can read at compile time and is left null.
				const named =
					isNode(key) && property['computed'] !== true
						? typeof key['name'] === 'string'
							? key['name']
							: key['type'] === 'Literal' && typeof key['value'] === 'string'
								? key['value']
								: null
						: null;
				if (named === null || !isNode(value)) return null;
				if (value['type'] === 'Identifier' && typeof value['name'] === 'string') {
					found.push({ local: value['name'], prop: named, fallback: 'undefined' });
					continue;
				}
				// `p = 1`, which is the default, and it is the only other shape this reads. A
				// `$bindable(x)` default is `x`: the rune marks the prop as one a parent may bind and
				// may only be written inside `$props()`, so what stands for the default elsewhere is
				// its argument, or `undefined` where it has none.
				const left = value['type'] === 'AssignmentPattern' ? value['left'] : undefined;
				const given = value['type'] === 'AssignmentPattern' ? value['right'] : undefined;
				const right = span(given);
				if (!isNode(left) || typeof left['name'] !== 'string' || right === null) return null;
				let fallback = source.slice(right[0], right[1]);
				// The node it was sliced from, so a caller that has to read it in the component's own
				// scope can expand it rather than take the text as written. The entry's does: a
				// default may call a function the script declares, which no bundle carries.
				let at: unknown = given;
				let bindable = false;
				const called = isNode(given) ? given['callee'] : undefined;
				if (
					isNode(given) &&
					given['type'] === 'CallExpression' &&
					isNode(called) &&
					called['name'] === '$bindable'
				) {
					const [initial] = Array.isArray(given['arguments']) ? given['arguments'] : [];
					const inner = span(initial);
					fallback = inner === null ? 'undefined' : source.slice(inner[0], inner[1]);
					at = inner === null ? undefined : initial;
					bindable = true;
				}
				found.push({
					local: left['name'],
					prop: named,
					fallback,
					at,
					...(bindable ? { bindable: true } : {}),
				});
			}
		}
	}
	return found;
}

/** The runes, by the name a script references. `analysis.runes` is true where any of them is. */
const RUNES: ReadonlySet<string> = new Set([
	'$state',
	'$derived',
	'$props',
	'$bindable',
	'$effect',
	'$inspect',
	'$host',
]);

/**
 * Whether a component is in legacy mode, which is what `2-analyze/index.js` decides in one line:
 * `runes_option ?? ... some(is_rune)`. `<svelte:options runes={...}>` is that option and wins over
 * the scripts, which is the only way a file with no rune in it can still be in runes mode.
 *
 * It decides more than one thing, and the two that are read here are far apart: whether
 * `export let` is a prop, and whether a fragment's `{@const}`s are sorted into topological order.
 */
export function legacyMode(ast: AstNode): boolean {
	for (const one of optionAttributes(ast)) {
		if (!isNode(one) || one['name'] !== 'runes') continue;
		const value = one['value'];
		const held = isNode(value) ? value['expression'] : undefined;
		// `<svelte:options runes />` with no value is `true`, which the parser writes as `true`
		// rather than an expression; anything but a literal is not an option Svelte accepts.
		if (value === true) return false;
		if (isNode(held) && held['type'] === 'Literal') return held['value'] === false;
		return false;
	}
	const instance = ast['instance'];
	const module = ast['module'];
	for (const block of [instance, module]) {
		const content = isNode(block) ? block['content'] : undefined;
		const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
		if (usesRunes(body)) return false;
	}
	return true;
}

/** The attributes written on `<svelte:options>`, which the parser lifts onto the root. */
function optionAttributes(ast: AstNode): readonly unknown[] {
	const options = ast['options'];
	if (!isNode(options)) return [];
	return Array.isArray(options['attributes']) ? options['attributes'] : [];
}

/** Whether anything in these statements references a rune, which is what puts a file in runes mode. */
function usesRunes(body: readonly unknown[]): boolean {
	let found = false;
	const look = (node: unknown): void => {
		if (found) return;
		if (Array.isArray(node)) {
			for (const one of node) look(one);
			return;
		}
		if (!isNode(node)) return;
		if (node['type'] === 'Identifier' && typeof node['name'] === 'string') {
			// `$state.raw` and the rest are a member off the rune's own name, so the root is enough.
			if (RUNES.has(node['name'])) found = true;
			return;
		}
		for (const one of Object.values(node)) look(one);
	};
	look(body);
	return found;
}

/**
 * How a name is declared in this body, for a specifier in an `export { ... }`.
 *
 * Only a `let` or a `var` bound to a plain name is a prop: `export { x }` over a `const` is a
 * readonly export, which `analysis.exports` carries to `bind_props` rather than declaring as a
 * bindable prop, and one over a destructuring binds a name whose value comes out of a pattern,
 * which is not an initialiser this can name.
 */
function declaredAs(
	body: readonly unknown[],
	name: string,
): { kind: 'prop'; init: unknown } | { kind: 'readonly' } | { kind: 'pattern' } | null {
	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'VariableDeclaration') continue;
		const writable = statement['kind'] === 'let' || statement['kind'] === 'var';
		for (const one of Array.isArray(statement['declarations']) ? statement['declarations'] : []) {
			const id = isNode(one) ? one['id'] : undefined;
			if (!isNode(id)) continue;
			if (id['name'] === name) {
				if (!writable) return { kind: 'readonly' };
				return { kind: 'prop', init: one['init'] };
			}
			// A name the pattern binds rather than the declarator's own.
			const names = new Set<string>();
			namesOf(id, names);
			if (names.has(name)) return writable ? { kind: 'pattern' } : { kind: 'readonly' };
		}
	}
	return null;
}

/** Every name a binding pattern binds. */
function namesOf(node: unknown, into: Set<string>): void {
	if (Array.isArray(node)) {
		for (const one of node) namesOf(one, into);
		return;
	}
	if (!isNode(node)) return;
	if (node['type'] === 'Identifier' && typeof node['name'] === 'string') {
		into.add(node['name']);
		return;
	}
	for (const [key, value] of Object.entries(node)) {
		if (key === 'key' || key === 'init') continue;
		namesOf(value, into);
	}
}

/**
 * The values a render is fixed at, as the shape they sit in, for one name.
 *
 * A render is given no data, so a child's props are handed null and the entry's are handed
 * nothing. That is right for everything a marker stands for and wrong for the one thing a marker
 * does not: a path this render is fixed at is a value the compiler knows, and markup left for
 * Svelte to evaluate reads it out of the props like anything else. `<Modal title={m['x']({}, {
 * locale })}>` is that -- inert, because nothing in it varies per request once the locale is fixed,
 * and evaluated against a `data` that was null.
 *
 * So the render is given exactly those paths and nothing else. `data.locale.code` fixed at `"en"`
 * becomes `{ locale: { code: 'en' } }`, and every other field of `data` is still absent, which is
 * what keeps a marker the only way to read one.
 */
/** The property names that reach an object's prototype rather than a field of it. */
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);

export function partial(fixed: ReadonlyMap<string, string>, root: string): unknown {
	let found: Record<string, unknown> | undefined;
	for (const [path, literal] of fixed) {
		const names = path.split('.');
		if (names[0] !== root) continue;
		// A segment that names the prototype machinery is not a field: on an ordinary object,
		// `at["__proto__"] ??= {}` leaves the inherited prototype where it is, the walk steps into
		// `Object.prototype`, and the last assignment writes onto every object in the process while
		// `found` stays empty. The paths come from the build's own configuration, so nobody hostile
		// writes one -- but a name that is not a name is refused by name rather than compiled into a
		// wrong result. Refused rather than built without a prototype, because the refusal is the
		// shape a static analyser can read and a null-prototype object is not.
		const reserved = names.find((name) => RESERVED.has(name));
		if (reserved !== undefined) {
			throw new Error(
				`\`${path}\` names \`${reserved}\`, which is the prototype rather than a field of the ` +
					'payload; a fixed path has to be spelled with the names the data actually carries',
			);
		}
		const value: unknown = JSON.parse(literal);
		if (names.length === 1) return value;
		found ??= {};
		let at = found;
		for (const name of names.slice(1, -1)) {
			at[name] ??= {};
			at = at[name] as Record<string, unknown>;
		}
		at[names[names.length - 1] as string] = value;
	}
	return found;
}

/**
 * The paths a render is fixed at, in both spellings a child needs.
 *
 * They are rooted at the payload, and there are two ways a child meets one. An expression that has
 * been expanded says it the payload's way, because substitution has already put the call site's
 * words in -- `locale.code` inside the child comes out as `((data)).locale.code`. A declaration
 * read before any of that says it the child's way, because its own props are still its own names.
 *
 * So both are carried. Each payload-rooted path is also translated through the props: a prop bound
 * to the whole of one *is* that path inside the child, and a prop bound to a prefix carries the
 * rest along. Keeping only the translation is what left `<LanguageSwitcher code={locale.code}>`
 * unbound on a real route -- the expansion spelled it `data.locale.code` and the map held only
 * `locale.code`.
 */
export function rebased(
	fixed: ReadonlyMap<string, string>,
	declares: readonly { local: string; prop: string; rest?: true }[],
	bindings: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
	const found = new Map<string, string>(fixed);
	for (const one of declares) {
		if (one.rest === true) continue;
		const given = bindings.get(one.prop);
		if (given === undefined) continue;
		// The call site may have handed over a value rather than a path -- expanding an expression
		// writes a fixed path out as its literal, so `locale={data.locale.code}` arrives as `"en"`
		// and the spelling that would have matched is gone. A literal is worth carrying whatever it
		// came from: it reads nothing, so the child can be handed it rather than the null every
		// other prop gets, and an inert expression over it evaluates to what it should.
		const value = literalOf(given);
		if (value !== undefined) {
			found.set(one.local, value);
			continue;
		}
		const base = pathOf(given);
		if (base === null) continue;
		for (const [path, literal] of fixed) {
			if (path === base) found.set(one.local, literal);
			else if (path.startsWith(`${base}.`)) found.set(one.local + path.slice(base.length), literal);
		}
	}
	return found;
}

/**
 * Whether an expansion names one of Svelte's own functions this compiler carries.
 *
 * They are reached under a `$$` name, which nothing an author writes can shadow. Svelte's own
 * compiler refuses that name in markup -- a leading `$` is a store subscription there, and
 * `$$exclude_from_object` came back as "is an illegal variable name" -- so an expansion naming one
 * is never handed back for Svelte to evaluate, however little of the request it reads. It stays a
 * marker, and the derivation calls the function where the carried bundle has it.
 */
export const CARRIED = [
	'attr_class',
	'attributes',
	'clsx',
	'exclude_from_object',
	'get_store',
	'given',
	'rest_props',
	'sanitize_props',
	'sanitize_slots',
	'stringify',
	'to_array',
] as const;

/**
 * By name rather than by the prefix: `$$props`, `$$restProps` and `$$slots` wear it too, and those
 * are Svelte's own, written by the render rather than carried. See `helpers()` in `skeleton.ts`.
 */
const CARRIES = new RegExp(`(?:^|[^$\\w.])\\$\\$(?:${CARRIED.join('|')})\\b`);

export function carries(text: string): boolean {
	return CARRIES.test(text);
}

/**
 * Whether a prop's value is the same every request, so that nothing has to stand in for it.
 *
 * Only asked of a component the walk did not enter. Inside one, an expression is walked and its
 * value is a marker like any other; outside, the value is handed to somebody else's code, and a
 * marker is a string wherever that code expected something else.
 */
export function inert(
	attr: unknown,
	expand: Locals['rewrite'],
	dynamic: ReadonlySet<string>,
): boolean {
	if (!isNode(attr) || attr['type'] !== 'Attribute') return false;
	const value = attr['value'];
	if (value === true) return false;
	const parts = Array.isArray(value) ? value : [value];
	return parts.every((part) => {
		if (!isNode(part)) return false;
		if (part['type'] === 'Text') return true;
		if (part['type'] !== 'ExpressionTag') return false;
		const text = expand(part['expression']);
		return !carries(text) && !mentions(text, dynamic);
	});
}

/** Every import a file declares, by the name it binds, read the way `reduce` reads them. */
export function importsOf(source: string): Record<string, string> {
	return reduce(source).imports;
}

/**
 * A name for one place in one file, stable however the walk reaches it.
 *
 * Short and hexadecimal, because it is written into markup and has to survive being rendered.
 */
export function identity(file: string, at: number): string {
	let hash = 0x811c9dc5;
	for (const c of `${file}:${String(at)}`) {
		hash = Math.imul(hash ^ c.codePointAt(0)!, 0x01000193) >>> 0;
	}
	return hash.toString(16);
}

/**
 * What the caller hands the child: its markup, grouped the way `build_inline_component` groups it.
 *
 * A child carrying a literal `slot="x"` goes to the group `x`, everything else to the default one
 * -- which is `children` here, the name `{@render children()}` reads and the name a `<slot>` with
 * no `name` looks up. Svelte passes the default group as the `children` prop and the named ones as
 * `$$slots`, and `$.slot` reaches both.
 *
 * Each group also carries the names `let:` binds on it: the directives written on the component's
 * own tag belong to the default group, and those on a child with `slot="x"` to that one. Their
 * values are the component's, supplied when it renders the slot. See `Given.handed`.
 */
export function hands(
	walk: Walk,
	nodes: readonly unknown[],
	tag?: AstNode,
): ReadonlyMap<string, Given> {
	if (nodes.length === 0) return new Map();
	const grouped = new Map<string, unknown[]>();
	const lets = new Map<string, Map<string, string | AstNode>>();
	const bind = (name: string, node: AstNode): void => {
		const held = lets.get(name) ?? new Map<string, string | AstNode>();
		for (const one of Array.isArray(node['attributes']) ? node['attributes'] : []) {
			if (!isNode(one) || one['type'] !== 'LetDirective') continue;
			const prop = typeof one['name'] === 'string' ? one['name'] : '';
			if (prop === '') continue;
			// `let:x` binds `x` to the slot prop `x`; `let:x={y}` binds `y` to the slot prop `x`.
			// `build_inline_component` writes the same pair into the slot function's parameter,
			// `{ x: y }`, so what the caller reads is what the component passed under that name.
			if (!isNode(one['expression'])) {
				held.set(prop, prop);
				continue;
			}
			const to = one['expression'];
			// A pattern rather than a name: `let:box={{ width, height }}`. `build_inline_component`
			// writes it straight into the slot function's parameter, `{ box: { width, height } }`, so
			// each name in it reaches the slot prop the way a `{@const}`'s does -- and `takenApart`,
			// which is Svelte's own `_extract_paths` read forward, is what says how. Kept as the node
			// for the walk to take apart against what the `<slot>` passed.
			if (to['type'] === 'Identifier' && typeof to['name'] === 'string') {
				held.set(prop, to['name']);
				continue;
			}
			held.set(prop, to);
			// And taken out of the render, where it is dead: every name it binds is a marker in the
			// rewritten markup by the time the render sees it, and the render is handed nothing for
			// the value the pattern would come apart from. Destructuring that threw where binding the
			// whole of it under a name nobody reads does not.
			const at = span(to);
			if (at !== null) walk.edits.push([at[0], at[1], `$$seam_let${String(at[0])}`]);
		}
		lets.set(name, held);
	};
	// A component carrying `slot=` is a named slot inside another one, and its `let:` scope is that
	// slot's rather than its own: `slot_scope_applies_to_itself` in `build_inline_component` says
	// so, and the directives are then left out of `lets.default`. `<Inner slot="foo" let:thing={d}>`
	// reads `d` from the enclosing `<slot name="foo" {thing}/>`, in its own attributes and in its
	// children, and `Inner`'s own `<slot />` passes nothing for it.
	if (tag !== undefined && slotName(tag) === null) bind('children', tag);
	for (const child of nodes) {
		const named = isNode(child) ? (slotName(child) ?? 'children') : 'children';
		const held = grouped.get(named) ?? [];
		held.push(child);
		grouped.set(named, held);
		if (isNode(child) && named !== 'children') bind(named, child);
		// A `<svelte:fragment>` with no `slot=` carries `let:` for the default group.
		if (isNode(child) && named === 'children' && child['type'] === 'SvelteFragment') {
			bind('children', child);
		}
	}
	const found = new Map<string, Given>();
	for (const [named, held] of grouped) {
		const here = new Map<string, Snippet>();
		snippetsIn(held, here);
		found.set(named, {
			source: walk.source,
			nodes: held,
			expand: walk.expand,
			edits: walk.edits,
			snippets: here,
			site: walk.site,
			handed: lets.get(named) ?? new Map<string, string | AstNode>(),
			legacy: walk.legacy,
		});
	}
	return found;
}

/** A literal `slot="x"` on a child, which is what puts it in that group. */
function slotName(node: AstNode): string | null {
	for (const one of Array.isArray(node['attributes']) ? node['attributes'] : []) {
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
 * How long every list the walk appends to was before a descent, so the descent can be undone.
 *
 * Named rather than a bag of counts, because two of these were missing and nothing said so. A
 * descent that stopped left its `handed` records and its spreads behind, pointing at holes that had
 * been rolled back -- so a group inside a component the walk never entered was still asked whether
 * its markup came back, over a range that by then belonged to somebody else. `missed` is the one
 * list that stays: it is the record of why the descent stopped, and it is wanted precisely because
 * the descent did not finish.
 */
interface Marks {
	holes: number;
	blocks: number;
	edits: number;
	pending: number;
	copies: number;
	handed: number;
	spreads: number;
}

/** Puts back what a walk that did not finish appended, and says it did not take the component. */
export function rolled(walk: Walk, mark: Marks): false {
	walk.holes.length = mark.holes;
	walk.blocks.length = mark.blocks;
	walk.edits.length = mark.edits;
	walk.pending.length = mark.pending;
	walk.site.copies.length = mark.copies;
	walk.site.handed.length = mark.handed;
	walk.site.spreads.length = mark.spreads;
	return false;
}

/**
 * The imports a rewritten source needs that its author did not write, put where imports go.
 *
 * Into the instance script, or into one made for the purpose. A module script would not do: what
 * it declares is shared by every instance, and these are per call site.
 */
export function withPrelude(
	source: string,
	ast: AstNode,
	prelude: readonly string[],
	edits: [number, number, string][],
): void {
	if (prelude.length === 0) return;
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const at = isNode(content) ? content['start'] : undefined;
	if (typeof at === 'number') {
		edits.push([at, at, `\n${prelude.join('\n')}\n`]);
		return;
	}
	edits.push([0, 0, `<script>\n${prelude.join('\n')}\n</script>\n`]);
}

/**
 * Points one component tag at a copy of its own: the name where it opens and closes, and an import.
 */
export function rename(
	walk: Walk,
	node: AstNode,
	tag: string,
	at: string,
	ordinal: number,
	/**
	 * Set where the tag is a dynamic component the walk settled to one import: the tag of a rune
	 * declaration, or `<svelte:component this={...}>` itself, whose `this` span is given. Either
	 * stays dynamic in the render, so the anchors Svelte writes around one stay too.
	 */
	dynamic?: {
		expression: [number, number] | null;
		/**
		 * Set where the `this` span is an edit somebody else owns: a choice, whose taken text is the
		 * copy's name and whose other branch renders nothing. Two edits over the same characters is
		 * a mistake rather than a case to resolve, so the name goes through this instead of beside
		 * it. See `rechose()` in walk.ts.
		 */
		rewritten?: (fresh: string) => void;
	},
): void {
	const [from, to] = [node['start'], node['end']];
	if (typeof from !== 'number' || typeof to !== 'number') return;
	const fresh = `${tag.replaceAll('.', '_')}$${String(ordinal)}`;
	const text = walk.source.slice(from, to);
	if (dynamic?.rewritten !== undefined) {
		dynamic.rewritten(fresh);
	} else if (dynamic?.expression) {
		walk.edits.push([dynamic.expression[0], dynamic.expression[1], fresh]);
	} else {
		// A member tag, `Kit.Root`, is one name once it is a copy's import -- and it stays a
		// dynamic component: `2-analyze/visitors/Component.js` marks a tag with a `.` in it
		// dynamic, and the server then writes `<!--[-->` and `<!--]-->` around what it renders, so
		// the copy is written as `<svelte:component this={...}>`, the same dynamic call, and keeps
		// the anchors. So does a tag naming a rune declaration, for the same reason.
		const member = tag.includes('.') || dynamic !== undefined;
		const name = typeof node['name'] === 'string' ? node['name'] : tag;
		walk.edits.push([
			from + 1,
			from + 1 + name.length,
			member ? `svelte:component this={${fresh}}` : fresh,
		]);
		if (text.endsWith(`</${name}>`)) {
			walk.edits.push([to - 1 - name.length, to - 1, member ? 'svelte:component' : fresh]);
		}
	}
	const relative = `./${basename(at)}`;
	walk.site.prelude.push(`import ${fresh} from '${relative}';`);
}
