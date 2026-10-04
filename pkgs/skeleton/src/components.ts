/**
 * Which component a tag names, and how: the file an import resolves to, a component that renders
 * itself, a `this` the request decides and the one candidate it can be, and what stands in for a
 * component in an expression. See spec/pipeline.md and spec/payload.md.
 */
import { dirname, relative } from 'node:path';
import { type Carried, mentions, resolveBare, RUN_NAME, isComponentFile } from '@seam-js/ast';
import { isNode, refuse } from './node.ts';
import { settled } from './branches.ts';
import { type Walk, changedWhy } from './walk-types.ts';

/** One plain name, which is what a settled dynamic component is when it is one import. */
export const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Refuses a component tag whose name this walk decides, saying which of the two questions it is.
 *
 * The name is `member_id(node.name)` visited, so only its root is a read; the members are property
 * accesses off whatever that is. A root the walk binds per item is a component chosen per item,
 * which a block can express and a page-wide enumeration cannot. A root the request decides is a
 * component off the wire, which the payload does not carry.
 */
export function naming(tag: string, walk: Walk): void {
	const head = tag.split('.')[0] ?? '';
	if (head === '' || !walk.dynamic.has(head)) return;
	// A name a block binds, told apart from one the payload carries the way `stands()` tells them
	// apart: the decision is made per item and there is no page-wide domain to enumerate.
	if (walk.site.payload?.has(head) !== true && !walk.fresh.includes(head)) {
		refuse(
			`\`<${tag} />\` names a component through \`${head}\`, which a block binds, so which ` +
				'component it is is decided per item and cannot be enumerated for the page. Write the ' +
				'choice as an `{#if}` around each component, which is a block and is taken per item. ' +
				'See spec/derivation.md',
		);
	}
	choosing(head, tag, walk);
}

/**
 * Whether a component the request hands in, which the source names none of, is refused at the build
 * rather than rendered as nothing and thrown on per request. Off unless the project asks. See
 * spec/payload.md.
 */
export let refusingUnnamed = false;

export function configureUnnamedComponents(enabled: boolean): void {
	refusingUnnamed = enabled;
}

/** A component a route's universal `load` imports: its file, and the key the request names it by. */
export interface Loaded {
	/** Absolute, which is what a synthetic import is written relative from. */
	file: string;
	/** Relative to the project root, which is what the dispatcher hands it under. */
	key: string;
}

/**
 * The components each route's universal loads import, by the route's root file. See
 * spec/framework.md, "A component a `load` returns".
 */
let loadedBy: ReadonlyMap<string, readonly Loaded[]> = new Map();

export function configureLoadedComponents(
	given: ReadonlyMap<string, readonly Loaded[]> | null,
): void {
	loadedBy = given ?? new Map();
}

/**
 * A `this` the request decides and the source names no component for, written as a chain over
 * the components the route's universal loads import: `(($$loaded(x) === "a.svelte") ? A : x)`,
 * one test per component, the value itself last. A `load` that returns a component hands the page
 * the module Kit's server build imported, and `$$loaded` names it by that identity, which the
 * dispatcher -- bundled by the same build -- holds. Each test is the request's, so the build
 * renders once per component, as it does any `?:` between components; the last branch is a value
 * none of them is, the unnamed rule's as before. Each component is imported into the file under a
 * name of its own, relative to the file as an author would write it. See spec/framework.md, "A
 * component a `load` returns".
 */
export function loadedChosen(expression: unknown, walk: Walk): string | null {
	const entry = walk.site.stack[0];
	const candidates = entry === undefined ? undefined : loadedBy.get(entry);
	if (candidates === undefined || candidates.length === 0) return null;
	const written = walk.expand(expression);
	// The tests read the value bare of a boundary's guard: a guard puts it inside a function, and a
	// read inside one is not a read `settle` counts, so the test was taken for the build's to decide.
	const bare = walk.untried?.(written) ?? written;
	if (!mentions(settled(bare, walk), walk.dynamic)) return null;
	const named = candidateOf(expression, walk, new Set(), (held) => componentImport(held, walk));
	if (named !== null) return null;
	const carried = walk.site.carried as Map<string, Carried>;
	const locals = candidates.map(({ file }, at) => {
		const local = `__seam_loaded_${String(at)}`;
		if (!carried.has(local)) {
			const rel = relative(dirname(walk.site.file), file).split('\\').join('/');
			const from = rel.startsWith('.') ? rel : `./${rel}`;
			carried.set(local, { local, from, kind: 'default' });
			walk.site.prelude.push(`import ${local} from '${from}';`);
		}
		return local;
	});
	return candidates.reduceRight(
		(rest, { key }, at) =>
			`(($$loaded(${bare}) === ${JSON.stringify(key)}) ? ${locals[at] ?? 'null'} : ${rest})`,
		written,
	);
}

export function choosing(written: string, tag: string, walk: Walk): string {
	const chosen = settled(written, walk);
	if (mentions(chosen, walk.dynamic)) {
		refuse(
			`\`<${tag}>\` is handed a component the request decides, and the source names none it ` +
				'could be. An artifact holds bytes for the components the source names and none for ' +
				'one the request sends, and this project asked to be told at the build ' +
				'(`refuseUnnamedComponents`) rather than to render nothing or throw per request. Name ' +
				"it in the source -- as the prop's default, or beside the value in the expression -- " +
				'or choose it in the load stage. It stands for ' +
				`\`${chosen.replace(/\s+/g, ' ').slice(0, 200)}\`. See spec/payload.md`,
		);
	}
	return chosen;
}

/**
 * An expression with the parentheses that wrap the whole of it taken off.
 *
 * They say nothing about what it is. `expand` puts a pair around every name it substitutes, so a
 * `this` that settles to one import comes back as `(Foo)` and an identifier test read it as an
 * expression: the tag was written out for Svelte and the child never entered, which left `bind:x`
 * with no declaration to read.
 */
export function unwrapped(text: string): string {
	let held = text.trim();
	while (held.startsWith('(') && held.endsWith(')')) {
		let depth = 0;
		let wraps = true;
		for (const [at, c] of [...held].entries()) {
			if (c === '(') depth += 1;
			else if (c === ')') depth -= 1;
			if (depth === 0 && at < held.length - 1) {
				wraps = false;
				break;
			}
		}
		if (!wraps) break;
		held = held.slice(1, -1).trim();
	}
	return held;
}

/**
 * A snippet name written so the render tag stays the dynamic one it was.
 *
 * `2-analyze/visitors/RenderTag.js` sets `metadata.dynamic = binding?.kind !== 'normal'`, and
 * `is_standalone` in `3-transform/utils.js` wants a `RenderTag` that is **not** dynamic before it
 * lets the parent block's anchor stand for the tag's own. A callee this walk settles was dynamic --
 * a prop, a member expression, anything but a plain reference to a declared snippet -- so writing
 * the settled name bare made the tag static and dropped the `<!---->` Svelte writes after it.
 * `(0, name)` is not an identifier, so the binding is not looked up and the tag stays dynamic;
 * the call is the same call. Measured.
 *
 * **Only where the tag was dynamic.** A callee that is a plain script declaration is `normal`, so
 * the tag is static and the parent block's anchor stands for it -- wrapping that one wrote a
 * `<!---->` Svelte does not. A prop, an import, a rune declaration and anything that is not an
 * identifier are the other side.
 */
export function stillDynamic(name: string, dynamic: boolean): string {
	return dynamic ? `(0, ${name})` : name;
}

/** Whether a local name is a component: the default import of a `.svelte` file. See `Carried`. */
export function componentImport(local: string, walk: Walk): boolean {
	const held = walk.site.carried.get(local);
	if (held === undefined || held.kind !== 'default') return false;
	return isComponentFile(resolveBare(held.from, walk.site.file) ?? held.from);
}

/**
 * The one component a value position can hold, following the branches an expression may take.
 *
 * Only the positions whose value is the expression's own value: the right of an `&&`, either side
 * of a `||`, a `??` or a `?:`. A component named anywhere else -- an argument, a property -- is
 * not what the expression evaluates to. Two positions naming different components is a choice
 * wider than one candidate and is not one of these.
 */
export function candidateOf(
	node: unknown,
	walk: Walk,
	through: Set<string>,
	/** What counts as the thing being named: a component this file imports, or a snippet it holds. */
	names: (held: string) => boolean,
): string | null {
	if (!isNode(node)) return null;
	const again = (child: unknown): string | null => candidateOf(child, walk, through, names);
	switch (node['type']) {
		case 'Identifier': {
			const name = typeof node['name'] === 'string' ? node['name'] : '';
			// The name itself, and not a nearer binding of it: `{:then { Component }}` beside
			// `import Component from './Component.svelte'` is one name and two things, and the walk
			// already knows which -- a name something binds is substituted, and a prop or an import
			// is left as written. Measured on `await-with-update-2`, which named the import it had
			// shadowed.
			if (unwrapped(walk.expand(node)) !== name) return null;
			if (names(name)) return name;
			// A prop's default is the value the request did not send, and the request cannot send a
			// function, so a default naming one is the only function this name can hold.
			const held = walk.site.defaults.get(name);
			if (held === undefined || through.has(name)) return null;
			through.add(name);
			return again(held);
		}
		case 'ParenthesizedExpression':
			return again(node['expression']);
		case 'SequenceExpression': {
			const parts = Array.isArray(node['expressions']) ? node['expressions'] : [];
			return again(parts[parts.length - 1]);
		}
		case 'LogicalExpression': {
			// `&&` is its right side or something falsy, which renders nothing either way.
			const right = again(node['right']);
			if (node['operator'] === '&&') return right;
			return agreed(again(node['left']), right);
		}
		case 'ConditionalExpression':
			return agreed(again(node['consequent']), again(node['alternate']));
		default:
			return null;
	}
}

/** Two value positions naming the same component, or no single candidate. */
function agreed(left: string | null, right: string | null): string | null {
	if (left === null) return right;
	if (right === null) return left;
	return left === right ? left : null;
}

/**
 * Every function the source names, each standing for the one thing a derivation can ask of one.
 *
 * A component and a snippet are both functions and the derivation scope is data: the payload
 * carries no function and the carried bundle drops a component on purpose, so neither name is
 * there to read. What either is worth to a derivation is that it exists, which is what the
 * constructs that consume them ask. See spec/payload.md.
 */
export function standsFor(walk: Walk): Map<string, string> {
	const stands = new Map<string, string>();
	for (const [local] of walk.site.carried) {
		if (componentImport(local, walk)) stands.set(local, 'true');
	}
	for (const [named, one] of walk.snippets) {
		if (one.declared) stands.set(named, 'true');
	}
	return stands;
}

/**
 * The one component a `<svelte:component this={...}>` the request decides can render, and the test
 * that says whether it renders it.
 *
 * **The payload carries data and no function**, which is a decision rather than a limit -- see
 * spec/payload.md -- so a component never comes off the wire and the only component `this` can
 * hold is one the source itself names. That closes what read as an open enumeration: the choice
 * has two outcomes, the component the source names and nothing at all, which is an `{#if}` with an
 * empty else. Svelte's server compiles the tag to exactly that shape, `build_inline_component`
 * writing `if (X) { BLOCK_OPEN; X($$renderer, {}); }` against `else { BLOCK_OPEN_ELSE; }`.
 *
 * A request that sends a truthy value that is not a component renders nothing either way: Svelte
 * calls it and throws, and there are no bytes to reproduce. See spec/readings.md.
 */
/**
 * A `this` the entry's script run answers, as a chain over the components the file imports.
 *
 * `let component; $: component = componentName === 'Sub' ? Sub : other` is a name the run holds,
 * and which component it holds is decided by identity -- and the run's `Sub` and the walk's are
 * two module instances, so no comparison outside the run can tell. The run captures the imports
 * beside the declarations, so the chain compares inside it:
 * `((component === Sub) ? Sub : component)`, one test per import in source order, the value
 * itself last. Each test is one the request decides, so the walk enumerates it as it does any
 * `?:` between components, the named branch renders that component's bytes, and the last branch
 * is a value the source names none of -- nothing for nothing, a throw per request otherwise, as
 * spec/payload.md has it. `ran()` in skeleton.ts writes both sides of each test as fields of the
 * run. The entry's only: a copy's run is written at each read, and a component reaching a
 * derivation is what `composed()` refuses. See spec/derivation.md, "A component the run chose is
 * compared inside the run".
 */
export function runChosen(expression: unknown, walk: Walk): string | null {
	if (walk.site.copy !== null && walk.site.copy !== undefined) return null;
	if (!isNode(expression) || expression['type'] !== 'Identifier') return null;
	const name = expression['name'];
	if (typeof name !== 'string' || !walk.dynamic.has(name)) return null;
	const chain = walk.site.stack.toReversed().map((one) => relative(walk.site.root, one));
	if (changedWhy(walk.site.changing, chain, name) === undefined) return null;
	const imports = [...walk.site.carried.keys()].filter((local) => componentImport(local, walk));
	if (imports.length === 0) return null;
	return imports.reduceRight(
		(rest, local) => `((${name} === ${local}) ? ${local} : ${rest})`,
		name,
	);
}

export function chosenComponent(
	expression: unknown,
	walk: Walk,
): { name: string; test: string } | null {
	// A component the script run chose is compared by identity, and the run's copy of a component is
	// not the one a candidate names. See `ranBy` in `descend()`.
	if (walk.expand(expression).includes(`${RUN_NAME}(`)) {
		refuse(
			'a component chosen by a script this compiler runs per request: which component renders is ' +
				'decided by identity, and the run holds its own copy of each, not the one the source ' +
				'names. See spec/derivation.md',
		);
	}
	if (!mentions(settled(walk.expand(expression), walk), walk.dynamic)) return null;
	const through = new Set<string>();
	const name = candidateOf(expression, walk, through, (held) => componentImport(held, walk));
	if (name === null) return null;
	// A default this followed to a component is one the derivation scope cannot hold, so it stands
	// there for what a component is worth to a derivation and nothing more: that it exists.
	for (const one of through) walk.site.stood.add(one);
	// The test asks whether the value is something, and every component is: a function is truthy.
	// So each component the expression names stands for `true` in it, which is also what leaves it
	// evaluable -- `gather()` in the carry package drops a component from the bundle on purpose,
	// so the name is not there for a derivation to read.
	return { name, test: settled(walk.expand(expression, standsFor(walk)), walk) };
}
