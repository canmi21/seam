import { parse } from 'svelte/compiler';
import { locals, parsed } from './locals.ts';
import { bySource } from './memo.ts';
import { resolveBare } from './packages.ts';
import {
	APP_STATE,
	bound,
	declaredBy,
	declaring,
	free,
	isNode,
	type Node,
	requested,
} from './scope.ts';

/**
 * Where every name in the markup comes from.
 *
 * The compiler used to decide by shape: an expression matching a dotted identifier was a data
 * path and anything else became a derivation, and nothing asked where the names in either came
 * from. A local variable and a payload key look the same, so `{total}` was looked up in the data,
 * found nothing, and rendered an empty string. That is the failure this exists to stop, and it is
 * the worst of the three it stops because it is the silent one.
 *
 * See spec/derivation.md, which this implements.
 */

/**
 * Names that resolve to the same value everywhere, so an expression using one cannot make the
 * server and the browser disagree. Deliberately short: this is a list of things nobody has to
 * think about, and anything that reads a clock, a locale or an environment is not on it.
 */
const GLOBALS = new Set([
	'Array',
	'BigInt',
	'Boolean',
	'Infinity',
	'JSON',
	'Map',
	'Math',
	'NaN',
	'Number',
	'Object',
	// Deterministic wherever it is given something: `Date.parse(s)`, `new Date(s)` and
	// `x instanceof Date` read the same everywhere. `Date.now()` and a `Date` built from nothing
	// are a clock, and both are below.
	'Date',
	'Promise',
	'RegExp',
	'Set',
	'String',
	'structuredClone',
	'URL',
	'URLSearchParams',
	// It reads the same everywhere -- `undefined` -- and what it does instead of returning is not
	// bytes. Both the render and the artifact call it, so a line is written twice; that is a log,
	// not a difference in what is served.
	'console',
	'decodeURI',
	'decodeURIComponent',
	'encodeURI',
	'encodeURIComponent',
	'isFinite',
	'isNaN',
	'parseFloat',
	'parseInt',
	'undefined',
]);

/**
 * Names whose value the **server** has and the **build** has not, which is a third answer.
 *
 * `GLOBALS` above is the list of names that read the same everywhere, and the ambient members
 * below are the ones that do not read the same twice. `process.env.TMP_VAR` is neither: it reads
 * the same twice within one server and differently on the machine that built the artifact. Svelte
 * compiles it to a read evaluated inside `render()`, once per request, and a derivation is read
 * once per request too -- so the two agree. What does not agree is an expression judged inert and
 * handed back to the compile-time render, which would read the build machine's value and write it
 * into the bytes. So it resolves here, and `unknown()` in the skeleton keeps it off that path.
 *
 * Svelte itself has no list to read forward from: its `globals` table in `phases/scope.js` is for
 * folding a keypath at compile time and says nothing about which names are legal. The category is
 * this compiler's, and the scope line is what decides it -- a value the build does not hold is a
 * value the request brings, whatever channel it comes down. See spec/derivation.md.
 *
 * **`globalThis` is not one of these, and measuring said so.** The object is the same object on
 * both machines; it is a *property* of it that differs, and the test here is on the root name, so
 * listing it made every expression that names it vary -- which took a sample that had nothing to
 * do with the environment. `process` is listed because there is no read of it that the build and
 * the server agree on.
 */
export const AT_REQUEST: ReadonlySet<string> = new Set(['process']);

/** Members of an allowed global that are not themselves deterministic. */
const AMBIENT_MEMBERS: Record<string, ReadonlySet<string>> = {
	Math: new Set(['random']),
	Date: new Set(['now']),
};

/**
 * Globals whose call does not return the same value twice, so substituting one duplicates it.
 *
 * `Symbol()` is the one that found this: `const s = Symbol()` beside `s in obj` substituted the
 * call at both reads, made two different symbols, and wrote `false` where Svelte wrote `true`. It
 * is `Math.random` again in a shape a member test cannot see -- a bare call rather than a member.
 * `Symbol.for` is interned and is not one of these, which is why the test is on the callee being
 * the bare name.
 */
const AMBIENT_CALLS: ReadonlySet<string> = new Set(['Symbol']);

/** Globals whose call reads a clock when it is given nothing, and a value when it is given one. */
const AMBIENT_EMPTY: ReadonlySet<string> = new Set(['Date']);

export interface Unresolved {
	name: string;
	/** The expression it was written in, so the report says where to look. */
	expression: string;
	reason: 'unknown' | 'ambient';
}

/** One name an expression uses that came from an import, and how to ask for it again. */
export interface Carried {
	/** The name as the markup writes it. */
	local: string;
	from: string;
	/** What the module calls it: the export's name, `default`, or the whole module. */
	kind: 'named' | 'default' | 'namespace';
	/** For a named import, the exported name, which a rename makes different from `local`. */
	exported?: string;
}

export interface Bindings {
	unresolved: Unresolved[];
	/**
	 * The imported names the markup actually uses. They are legal, and they are the list of what
	 * has to be bundled with the expressions that call them. Not analysed: see spec/derivation.md
	 * for why a purity check over library code was measured and abandoned.
	 */
	carried: Carried[];
}

interface Context {
	known: ReadonlyMap<string, Carried>;
	used: Set<string>;
	declares: (name: string) => boolean;
	/** Declared names the markup reads, so what they expanded into can be checked as well. */
	read: Set<string>;
	/** The component's own path, for resolving what its imports name; unknown for bare source. */
	file?: string;
}

/**
 * Whether an import is a component, which is composed at compile time and never a value here.
 * The file decides, not the specifier: `x.svelte` is how a bundler is asked for the runes module
 * `x.svelte.ts` once it completes the extension. Without a file to resolve from, the suffix has
 * to do.
 */
function componentImport(held: Carried, file: string | undefined): boolean {
	// Only the default export is the component. Svelte compiles a component to a module whose
	// `default` is the component and whose `<script module>` exports are its named exports, so
	// `import { foo } from './Foo.svelte'` is a value like any other and is carried, not composed.
	if (held.kind !== 'default') return false;
	if (!held.from.endsWith('.svelte')) return false;
	if (file === undefined) return true;
	return (resolveBare(held.from, file) ?? held.from).endsWith('.svelte');
}

const KINDS: Record<string, Carried['kind']> = {
	ImportSpecifier: 'named',
	ImportDefaultSpecifier: 'default',
	ImportNamespaceSpecifier: 'namespace',
};

/** Every name the instance script imports, and enough about each to import it again. */
function imported(instance: unknown): Map<string, Carried> {
	const found = new Map<string, Carried>();
	if (!isNode(instance)) return found;
	const content = instance['content'];
	if (!isNode(content)) return found;
	const body = content['body'];
	if (!Array.isArray(body)) return found;

	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'ImportDeclaration') continue;
		const from = statement['source'];
		if (!isNode(from) || typeof from['value'] !== 'string') continue;
		for (const specifier of Array.isArray(statement['specifiers']) ? statement['specifiers'] : []) {
			if (!isNode(specifier)) continue;
			const local = specifier['local'];
			const kind = KINDS[String(specifier['type'])];
			if (!isNode(local) || typeof local['name'] !== 'string' || kind === undefined) continue;
			const named = specifier['imported'];
			found.set(local['name'], {
				local: local['name'],
				from: from['value'],
				kind,
				...(isNode(named) && typeof named['name'] === 'string' ? { exported: named['name'] } : {}),
			});
		}
	}
	return found;
}

/**
 * An attribute the client owns and the server never writes. Its expression reads whatever the
 * component's own scope holds and none of it reaches the output, so it is not this pass's
 * business. Measured: a component carrying these renders bytes indistinguishable from one
 * without them. See spec/ir.md.
 */
function clientOnly(name: unknown): boolean {
	if (typeof name !== 'string') return false;
	return /^on[A-Z:a-z]/.test(name) && name.length > 2;
}

/**
 * The runes, which are `$`-prefixed and are not stores. `is_rune` in Svelte's own analysis is the
 * same list, and a reference to one is what puts a file in runes mode rather than a subscription.
 */
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
 * The names an expression reads only as the argument of `typeof`, which need no binding.
 *
 * Every other mention counts, and the count is deliberately loose: a member's property name and an
 * object key land in it too, which can only keep a name out of this set. Being kept out means being
 * reported, which is the safe direction.
 */
function onlyTypeof(node: unknown): Set<string> {
	const under = new Set<string>();
	const other = new Set<string>();
	const step = (one: unknown): void => {
		if (Array.isArray(one)) {
			for (const each of one) step(each);
			return;
		}
		if (!isNode(one)) return;
		if (one['type'] === 'UnaryExpression' && one['operator'] === 'typeof') {
			const argument = one['argument'];
			if (
				isNode(argument) &&
				argument['type'] === 'Identifier' &&
				typeof argument['name'] === 'string'
			) {
				under.add(argument['name']);
				return;
			}
		}
		if (one['type'] === 'Identifier' && typeof one['name'] === 'string') {
			other.add(one['name']);
			return;
		}
		for (const value of Object.values(one)) step(value);
	};
	step(node);
	for (const name of other) under.delete(name);
	return under;
}

function report(
	expression: unknown,
	source: string,
	scope: ReadonlySet<string>,
	into: Unresolved[],
	carried?: Context,
): void {
	if (!isNode(expression)) return;
	const names = new Set<string>();
	free(expression, scope, names);

	const { start, end } = expression;
	const text = typeof start === 'number' && typeof end === 'number' ? source.slice(start, end) : '';

	const guarded = onlyTypeof(expression);
	for (const name of names) {
		if (GLOBALS.has(name)) continue;
		// A name the server holds and the build does not. It resolves; what it must not do is reach
		// the compile-time render, which `unknown()` in the skeleton sees to. See `AT_REQUEST`.
		if (AT_REQUEST.has(name)) continue;
		// `typeof x` on a name nothing binds is defined behaviour and reads the same everywhere:
		// `"undefined"`. It is how a file asks whether a global exists, and Svelte compiles it
		// unchanged, so the render evaluates the same expression and writes the same bytes. Only
		// where every read of the name is guarded that way -- `{typeof b} {b}` still has to resolve.
		if (guarded.has(name)) continue;
		// A rune is compiled away by Svelte and resolves nowhere at run time, which is why it is not
		// a name the data has to carry: `CallExpression.js` answers each one where it stands --
		// `$effect.tracking()` is `false`, `$effect.pending()` is `0` -- and `locals.ts` writes those
		// answers in. See `answered()`.
		if (RUNES.has(name)) continue;
		// `$x` is a subscription to the store `x`, and it resolves exactly where `x` does.
		// `2-analyze/index.js` declares a `store_sub` binding for a `$`-prefixed reference whose
		// name is not a rune and whose `x` is declared in the module or instance scope, and errors
		// where it is not; `build_getter` in the server transform then writes
		// `$.store_get($$store_subs ??= {}, '$x', x)`, which subscribes, takes the value and
		// memoises it for the render. So the store itself is what has to resolve, and it is the
		// store that gets bundled where it was imported. See spec/derivation.md.
		if (name.startsWith('$') && name.length > 1 && !RUNES.has(name)) {
			const store = name.slice(1);
			const imported = carried?.known.get(store);
			if (carried !== undefined && imported !== undefined) {
				carried.used.add(store);
				continue;
			}
			if (carried?.declares(store) === true) continue;
		}
		// A name from `$app/state` is neither bundled nor looked up: `page` is the payload's and
		// the other two are written out as what a server holds. See `stateImports()`.
		if (carried?.known.get(name)?.from === APP_STATE) continue;
		// An imported name is legal and gets bundled rather than looked up in the data. A
		// component is not one of these: it is composed at compile time and never a value here.
		const held = carried?.known.get(name);
		if (carried !== undefined && held !== undefined && !componentImport(held, carried.file)) {
			carried.used.add(name);
			continue;
		}
		// A name the scripts declare is substituted rather than looked up, so by the time an
		// expression reaches the compiler it is gone. What is checked is what it expanded into.
		if (carried?.declares(name) === true) {
			carried.read.add(name);
			continue;
		}
		into.push({ name, expression: text, reason: 'unknown' });
	}

	ambient(expression, text, into);
}

/**
 * The names in one expression that do not read the same twice, reported wherever it is found.
 *
 * A global on the list can still hold something that is not: `Math` is fine and `Math.random` is a
 * clock by another name. A bare call is the other shape, `Symbol()`.
 */
function ambient(expression: unknown, text: string, into: Unresolved[]): void {
	walkMembers(expression, (object, property) => {
		if (AMBIENT_MEMBERS[object]?.has(property) === true) {
			into.push({ name: `${object}.${property}`, expression: text, reason: 'ambient' });
		}
	});
	walkCalls(expression, (name, empty) => {
		if (AMBIENT_CALLS.has(name) || (empty && AMBIENT_EMPTY.has(name))) {
			into.push({ name: `${name}()`, expression: text, reason: 'ambient' });
		}
	});
}

/** Every call whose callee is a bare name, by that name and whether it was given nothing. */
function walkCalls(node: unknown, found: (name: string, empty: boolean) => void): void {
	if (!isNode(node)) return;
	if (node['type'] === 'CallExpression' || node['type'] === 'NewExpression') {
		const callee = node['callee'];
		const args = node['arguments'];
		if (isNode(callee) && callee['type'] === 'Identifier' && typeof callee['name'] === 'string') {
			found(callee['name'], Array.isArray(args) && args.length === 0);
		}
	}
	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const one of value) walkCalls(one, found);
		} else {
			walkCalls(value, found);
		}
	}
}

function walkMembers(node: unknown, found: (object: string, property: string) => void): void {
	if (!isNode(node)) return;
	if (node['type'] === 'MemberExpression' && node['computed'] !== true) {
		const object = node['object'];
		const property = node['property'];
		if (
			isNode(object) &&
			object['type'] === 'Identifier' &&
			typeof object['name'] === 'string' &&
			isNode(property) &&
			typeof property['name'] === 'string'
		) {
			found(object['name'], property['name']);
		}
	}
	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const child of value) walkMembers(child, found);
		} else if (isNode(value)) {
			walkMembers(value, found);
		}
	}
}

function markup(
	node: unknown,
	source: string,
	scope: Set<string>,
	into: Unresolved[],
	carried: Context,
): void {
	if (!isNode(node)) return;
	const type = node['type'];

	if (type === 'ExpressionTag' || type === 'HtmlTag') {
		report(node['expression'], source, scope, into, carried);
		return;
	}

	// A `{@const}` and a `{const}`/`{let}` are hoisted out of the fragment by `clean_nodes` and
	// pushed into the block's `init`, ahead of the template, so what they declare is in scope for
	// the whole fragment however late in it it was written. That is why every name goes into scope
	// before any initialiser is read here, rather than one tag at a time: `{@const yoo = foo}` above
	// `{@const foo = 1}` is legal, and in legacy mode `sort_const_tags` is what puts them in the
	// order that makes it work.
	//
	// In runes mode there is no sort, so reading a later one is JavaScript's temporal dead zone --
	// an error Svelte raises from the same source, which is why this pass does not need to. What it
	// asks is only whether the data has to carry a name, and a name a sibling declares it does not.
	if (type === 'Fragment') {
		const nodes = Array.isArray(node['nodes']) ? node['nodes'] : [];
		const inner = new Set(scope);
		for (const child of nodes) {
			if (!declaring(child)) continue;
			for (const [id] of declaredBy(child)) bound(id, inner);
		}
		for (const child of nodes) {
			if (declaring(child)) {
				for (const [, init] of declaredBy(child)) report(init, source, inner, into, carried);
				continue;
			}
			markup(child, source, inner, into, carried);
		}
		return;
	}

	if (type === 'Attribute') {
		if (clientOnly(node['name'])) return;
		const value = node['value'];
		for (const part of Array.isArray(value) ? value : [value]) {
			markup(part, source, scope, into, carried);
		}
		return;
	}

	// Directives the client owns write nothing, so what they read is not this pass's business.
	if (
		type === 'OnDirective' ||
		type === 'UseDirective' ||
		type === 'TransitionDirective' ||
		type === 'AnimateDirective'
	) {
		return;
	}

	if (type === 'IfBlock') {
		report(node['test'], source, scope, into, carried);
		markup(node['consequent'], source, scope, into, carried);
		markup(node['alternate'], source, scope, into, carried);
		return;
	}

	if (type === 'SnippetBlock') {
		// The parameters are the block's own, bound for the extent of its body, which is the same
		// arrangement an each block has.
		const inner = new Set(scope);
		for (const parameter of Array.isArray(node['parameters']) ? node['parameters'] : []) {
			bound(parameter, inner);
		}
		markup(node['body'], source, inner, into, carried);
		return;
	}

	if (type === 'EachBlock') {
		report(node['expression'], source, scope, into, carried);
		const inner = new Set(scope);
		bound(node['context'], inner);
		const index = node['index'];
		if (typeof index === 'string') inner.add(index);
		markup(node['body'], source, inner, into, carried);
		markup(node['fallback'], source, scope, into, carried);
		return;
	}

	if (type === 'AwaitBlock') {
		// The then branch binds the value and the catch branch the error, each for its own body.
		report(node['expression'], source, scope, into, carried);
		markup(node['pending'], source, scope, into, carried);
		const resolved = new Set(scope);
		bound(node['value'], resolved);
		markup(node['then'], source, resolved, into, carried);
		const rejected = new Set(scope);
		bound(node['error'], rejected);
		markup(node['catch'], source, rejected, into, carried);
		return;
	}

	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const child of value) markup(child, source, scope, into, carried);
		} else if (isNode(value)) {
			markup(value, source, scope, into, carried);
		}
	}
}

/**
 * Where every name in the markup comes from: the ones that resolve to nothing, and the imported
 * ones that have to be bundled with it.
 *
 * An empty `unresolved` means each name is a prop, an each binding, an import, something the
 * expression bound itself, or one of the globals that reads the same everywhere.
 */
/**
 * Every snippet the markup declares, by name.
 *
 * A snippet is a name the component binds, and `{@render}` reads it, so it belongs in scope like
 * an each block's item. It is collected before the walk rather than during it, because a render
 * tag may be written above the snippet it names.
 */
/** Every name a `let:` binds, anywhere in the markup. See `hands()` in pkgs/skeleton. */
function lets(node: unknown, into: Set<string>): void {
	if (Array.isArray(node)) {
		for (const one of node) lets(one, into);
		return;
	}
	if (!isNode(node)) return;
	if (node['type'] === 'LetDirective') {
		// `let:x` binds `x`; `let:x={y}` binds `y`; an object or array expression is a pattern.
		if (!isNode(node['expression'])) {
			if (typeof node['name'] === 'string') into.add(node['name']);
		} else {
			names(node['expression'], into);
		}
		return;
	}
	for (const one of Object.values(node)) lets(one, into);
}

/** Every identifier in a `let:` value, which is a binding pattern where it is one. */
function names(node: unknown, into: Set<string>): void {
	if (Array.isArray(node)) {
		for (const one of node) names(one, into);
		return;
	}
	if (!isNode(node)) return;
	if (node['type'] === 'Identifier' && typeof node['name'] === 'string') {
		into.add(node['name']);
		return;
	}
	for (const [key, value] of Object.entries(node)) {
		if (key === 'key') continue;
		names(value, into);
	}
}

function snippetNames(node: unknown, into: Set<string>): void {
	if (Array.isArray(node)) {
		for (const one of node) snippetNames(one, into);
		return;
	}
	if (!isNode(node)) return;
	if (node['type'] === 'SnippetBlock') {
		const id = node['expression'];
		if (isNode(id) && typeof id['name'] === 'string') into.add(id['name']);
	}
	for (const value of Object.values(node)) snippetNames(value, into);
}

/**
 * Every name the component's instance script imports, by local name. See `carriedBy()`.
 *
 * The most-asked question in a compile, by a distance: 21,702 of one route's parses were this one.
 * Remembered by source, and the map is handed out shared -- nothing writes into it. See `bySource`.
 */
export const importsOf: (source: string) => Map<string, Carried> = bySource((source) => {
	const ast = parse(source, { modern: true }) as unknown as Node;
	return imported(ast['instance']);
});

/**
 * Every free name the given expressions read, which is what the evaluator will look up.
 *
 * Parsed as the one tag of a TypeScript-aware component, since an expression copied out of a
 * `lang="ts"` component may carry an `as`. One that will not parse reads nothing here and fails
 * where it is evaluated, which says more than a parse error would.
 */
export function readsOf(expressions: Iterable<string>): Set<string> {
	const names = new Set<string>();
	for (const expression of expressions) {
		if (expression.trim() === '') continue;
		let tag: Node;
		try {
			// The shared, memoised parse: the same wrapper, and read-only here as everywhere.
			tag = parsed(expression);
		} catch {
			continue;
		}
		const fragment = tag['fragment'];
		const [only] = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
		if (isNode(only)) free(only['expression'], new Set(), names);
	}
	return names;
}

/**
 * The declarations the markup reaches, checked for a value that does not read the same twice.
 *
 * A declaration is substituted rather than looked up, so what the markup reads is what its
 * initialiser expanded into, and nothing looked there. `const s = Symbol()` beside `s in obj` made
 * two different symbols and wrote `false` where Svelte wrote `true`.
 *
 * Followed transitively, because the initialiser that holds the call may be three declarations away
 * from the name the markup wrote. Only the ambient check runs here, never the unknown one: a script
 * may name whatever it likes as long as the value it leaves behind reads the same twice.
 */
function reached(ast: Node, source: string, from: ReadonlySet<string>, into: Unresolved[]): void {
	if (from.size === 0) return;
	const inits = new Map<string, unknown>();
	for (const block of [ast['instance'], ast['module']]) {
		const content = isNode(block) ? block['content'] : undefined;
		const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
		for (const statement of body) {
			if (!isNode(statement)) continue;
			// A `$:` that assigns is a declaration too, and its right-hand side is the initialiser.
			// `$: props = omit($$props, 'value')` is the shape that found this.
			if (statement['type'] === 'LabeledStatement') {
				const label = statement['label'];
				const held = statement['body'];
				const assign =
					isNode(held) && held['type'] === 'ExpressionStatement' ? held['expression'] : undefined;
				if (!isNode(label) || label['name'] !== '$' || !isNode(assign)) continue;
				if (assign['type'] !== 'AssignmentExpression') continue;
				const names = new Set<string>();
				bound(assign['left'], names);
				for (const name of names) inits.set(name, assign['right']);
				continue;
			}
			const declaration =
				statement['type'] === 'ExportNamedDeclaration' ? statement['declaration'] : statement;
			if (!isNode(declaration) || declaration['type'] !== 'VariableDeclaration') continue;
			const declarations = declaration['declarations'];
			if (!Array.isArray(declarations)) continue;
			for (const one of declarations) {
				if (!isNode(one)) continue;
				const names = new Set<string>();
				bound(one['id'], names);
				for (const name of names) inits.set(name, one['init']);
			}
		}
	}
	const seen = new Set<string>();
	const pending = [...from];
	while (pending.length > 0) {
		const name = pending.pop();
		if (name === undefined || seen.has(name)) continue;
		seen.add(name);
		const init = inits.get(name);
		if (init === undefined) continue;
		ambient(init, name, into);
		const names = new Set<string>();
		free(init, new Set(), names);
		for (const next of names) if (inits.has(next)) pending.push(next);
	}
}

export function bindings(source: string, file?: string): Bindings {
	const ast = parse(source, { modern: true }) as unknown as Node;
	const found: Unresolved[] = [];
	const declares = locals(source);
	const carried: Context = {
		known: imported(ast['instance']),
		used: new Set<string>(),
		declares: declares.has,
		read: new Set<string>(),
		...(file === undefined ? {} : { file }),
	};
	// A `let:` name is bound by the slot it is written on and supplied by the component that
	// renders it, so it is the component's rather than the payload's -- the same position a
	// snippet's parameter is in. Collected for the file rather than per element, since resolution
	// asks only whether a name has somewhere to come from.
	const letNames = new Set<string>();
	lets(ast['fragment'], letNames);
	// A snippet's own name, and the names its parameters bind, are the component's rather than the
	// payload's. See spec/refusals.md.
	const scope = new Set([...requested(ast['instance']), ...letNames]);
	snippetNames(ast['fragment'], scope);
	markup(ast['fragment'], source, scope, found, carried);
	reached(ast, source, carried.read, found);
	const used = [...carried.used]
		.toSorted()
		.map((name) => carried.known.get(name))
		.filter((one): one is Carried => one !== undefined);
	return { unresolved: found, carried: used };
}
