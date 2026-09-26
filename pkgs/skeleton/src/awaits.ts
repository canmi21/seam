/**
 * What Svelte's async mode makes wait, and where the walk keeps an `await` so Svelte writes the
 * anchors it would have: the names a top-level await blocks, the statements the request moves,
 * and the reads the markup makes while the bytes are written. See spec/roadmap.md.
 */
import { awaitsIn, bound, parsed, projectAsync, reads as readsIn, RUN_NAME, runeCalled } from 'ast';
import { type AstNode, isNode, refuse } from './node.ts';
import { calleeName } from './components.ts';
import { type Walk } from './walk-types.ts';

/**
 * Refuses `await` in markup and at the top of a script where the project is not in Svelte's async
 * mode, which is the only mode Svelte compiles one in. Where it is, an `await` whose value the build
 * can know is compiled and awaited here, and one of what the request decides becomes a derivation
 * built `async` and awaited per request. `{#await}` is not
 * this, since a synchronous render writes its pending branch and awaits nothing. See
 * spec/roadmap.md.
 */
export function awaitless(ast: AstNode, what: string): void {
	// An `await` inside a function is that function's, run when something calls it -- a handler,
	// a load -- and not the render's. Only one the render itself would await is async Svelte.
	// A project in Svelte's async mode compiles these, and the render is awaited. See spec/roadmap.md.
	if (projectAsync()) return;
	if (awaitsIn(ast['fragment']) || awaitsIn(ast['instance'])) {
		refuse(
			`${what} awaits in its markup or at the top of its script, which is async Svelte, and ` +
				'Svelte compiles that only in its async mode: set `compilerOptions.experimental.async` ' +
				'in svelte.config.js. See spec/roadmap.md',
		);
	}
}

/** Whether markup holds a node of this type anywhere inside it. */
/**
 * The calls of Svelte's `hydratable` the entry's script makes as it initializes, in the order it
 * makes them.
 *
 * Svelte runs a component's script before its markup, so these are called on every request whether
 * or not anything reads what they return, and the script `#hydratable_block` writes holds their keys
 * in this order. Not inside a function, which runs when something calls it, and not inside
 * `$derived`, which runs when something reads it; either is a call a derivation makes when it is
 * read. See spec/derivation.md.
 */
export function hydratableCalls(ast: Record<string, unknown>): Record<string, unknown>[] {
	const content = isNode(ast['instance']) ? ast['instance']['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	const aliases = new Set<string>();
	for (const statement of body) {
		if (
			!isNode(statement) ||
			statement['type'] !== 'ImportDeclaration' ||
			!isNode(statement['source']) ||
			statement['source']['value'] !== 'svelte'
		) {
			continue;
		}
		for (const one of Array.isArray(statement['specifiers']) ? statement['specifiers'] : []) {
			if (
				isNode(one) &&
				one['type'] === 'ImportSpecifier' &&
				isNode(one['imported']) &&
				one['imported']['name'] === 'hydratable' &&
				isNode(one['local']) &&
				typeof one['local']['name'] === 'string'
			) {
				aliases.add(one['local']['name']);
			}
		}
	}
	const found: Record<string, unknown>[] = [];
	if (aliases.size === 0) return found;
	const visit = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const one of node) visit(one);
			return;
		}
		if (!isNode(node)) return;
		const type = node['type'];
		if (
			type === 'FunctionDeclaration' ||
			type === 'FunctionExpression' ||
			type === 'ArrowFunctionExpression' ||
			type === 'ImportDeclaration'
		) {
			return;
		}
		if (type === 'CallExpression') {
			const callee = node['callee'];
			if (
				isNode(callee) &&
				callee['type'] === 'Identifier' &&
				aliases.has(String(callee['name']))
			) {
				// Its arguments first, which JavaScript evaluates before the call.
				visit(node['arguments']);
				found.push(node);
				return;
			}
			if (isNode(callee) && ['$derived', '$derived.by'].includes(calleeName(callee))) return;
		}
		for (const value of Object.values(node)) visit(value);
	};
	visit(body);
	return found;
}

/**
 * Every name a statement changes, as Svelte's `trace_references` counts it: assigned or updated at
 * its root, or reached by a call, which is assumed to touch everything it is handed.
 */
function writtenBy(node: unknown): string[] {
	const out: string[] = [];
	const root = (target: unknown): void => {
		let at = target;
		while (isNode(at) && at['type'] === 'MemberExpression') at = at['object'];
		if (isNode(at) && at['type'] === 'Identifier' && typeof at['name'] === 'string') {
			out.push(at['name']);
		}
	};
	const step = (one: unknown): void => {
		if (Array.isArray(one)) {
			for (const each of one) step(each);
			return;
		}
		if (!isNode(one)) return;
		if (one['type'] === 'AssignmentExpression') root(one['left']);
		if (one['type'] === 'UpdateExpression') root(one['argument']);
		// A call is assumed to change everything it reaches -- `touch` in `trace_references`,
		// "assume everything touched by the callee ends up mutating the object" -- so every name
		// it references waits, `$derived(await foo)` giving `foo` a blocker. `$effect` is the
		// exception Svelte makes, since it only runs once the async work is done.
		if (one['type'] === 'CallExpression') {
			if (runeCalled(one['callee']) === '$effect') return;
			readsIn(one, new Set(), (at) => {
				if (typeof at['name'] === 'string') out.push(at['name']);
			});
			return;
		}
		// Svelte does not look inside a function until something calls it.
		if (
			one['type'] === 'ArrowFunctionExpression' ||
			one['type'] === 'FunctionExpression' ||
			one['type'] === 'FunctionDeclaration'
		) {
			return;
		}
		for (const value of Object.values(one)) step(value);
	};
	step(node);
	return out;
}

/**
 * The names Svelte's async mode makes wait: what `calculate_blockers` in `2-analyze/index.js`
 * gives a `blocker`.
 *
 * From the first top-level statement that awaits onward, every statement is run after the promise
 * before it, so a binding one declares or writes waits on it; and a function that reads a binding
 * that waits waits too. A node in the markup reading one is wrapped in `$$renderer.async` or
 * `async_block`, which writes `<!--[-->` and `<!--]-->` around it. Empty where the project is not in
 * async mode or nothing awaits. See `blocking()`.
 */
export function blockedBy(ast: AstNode): ReadonlySet<string> {
	const found = new Set<string>();
	if (!projectAsync()) return found;
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	const functions: [string, unknown][] = [];
	let awaited = false;
	for (const raw of body) {
		const statement =
			isNode(raw) && raw['type'] === 'ExportNamedDeclaration' ? raw['declaration'] : raw;
		if (!isNode(statement) || statement['type'] === 'ImportDeclaration') continue;
		awaited ||= awaitsAtTop(statement);
		if (statement['type'] === 'FunctionDeclaration') {
			const id = statement['id'];
			if (isNode(id) && typeof id['name'] === 'string') functions.push([id['name'], statement]);
			continue;
		}
		if (statement['type'] === 'VariableDeclaration') {
			const declarators = Array.isArray(statement['declarations']) ? statement['declarations'] : [];
			for (const one of declarators) {
				if (!isNode(one)) continue;
				const init = one['init'];
				if (
					isNode(init) &&
					(init['type'] === 'ArrowFunctionExpression' || init['type'] === 'FunctionExpression')
				) {
					const declared = new Set<string>();
					bound(one['id'], declared);
					for (const name of declared) functions.push([name, init]);
					continue;
				}
				if (!awaited) continue;
				bound(one['id'], found);
				for (const name of writtenBy(one)) found.add(name);
			}
			continue;
		}
		if (!awaited) continue;
		for (const name of writtenBy(statement)) found.add(name);
		if (statement['type'] === 'ClassDeclaration') {
			const id = statement['id'];
			if (isNode(id) && typeof id['name'] === 'string') found.add(id['name']);
		}
	}
	if (found.size === 0) return found;
	// A function waits on what it reads, to the fixed point.
	for (let moved = true; moved;) {
		moved = false;
		for (const [name, node] of functions) {
			if (found.has(name)) continue;
			let reads = false;
			readsIn(node, new Set(), (at) => {
				if (typeof at['name'] === 'string' && found.has(at['name'])) reads = true;
			});
			if (!reads) continue;
			found.add(name);
			moved = true;
		}
	}
	return found;
}

/**
 * The names a top-level statement that reads the request assigns: `if (environment === 'server')
 * value = 'server'; else value = ...` over a prop.
 *
 * The render runs the instance script, and a name something changes is left as the author wrote
 * it, so a read of one is right wherever the render evaluates it -- except where what changed it
 * read the request, because the render is given a stand-in for that and the branch it takes is not
 * the request's. That is a program per request, and the read of the name has to be one this
 * compiler writes, where the rule about a value the render changes refuses it. Left to the render
 * it threw over the stand-in, or wrote the wrong branch's value without a word. See
 * spec/derivation.md.
 */
export function movedBy(ast: AstNode, dynamic: ReadonlySet<string>): ReadonlySet<string> {
	const found = new Set<string>();
	if (dynamic.size === 0) return found;
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	// `$c` is a subscription to `c`, so it reads what `c` reads. And a name one statement moves is
	// read by the next -- `$: $b = $c; $: $a = $b` -- so this runs until nothing new is found.
	const varying = (name: string): boolean =>
		dynamic.has(name) ||
		found.has(name) ||
		(name.startsWith('$') && (dynamic.has(name.slice(1)) || found.has(name.slice(1))));
	// A function the script calls runs as part of the statement that calls it, so what it reads is
	// what that statement reads and what it assigns is what that statement moves: `function foo() {
	// b = c }` called by `foo()` over a `c` the request decides moves `b`.
	// So does a getter or a method of an object the script declares, reached as `object.name`.
	const functions = new Map<string, AstNode>();
	for (const statement of body) {
		if (!isNode(statement)) continue;
		if (statement['type'] === 'FunctionDeclaration' && isNode(statement['id'])) {
			const name = statement['id']['name'];
			if (typeof name === 'string') functions.set(name, statement);
		}
		if (statement['type'] !== 'VariableDeclaration') continue;
		const declarations = statement['declarations'];
		for (const one of Array.isArray(declarations) ? declarations : []) {
			if (!isNode(one) || !isNode(one['id']) || !isNode(one['init'])) continue;
			const name = one['id']['name'];
			const init = one['init'];
			if (typeof name !== 'string') continue;
			if (init['type'] === 'ArrowFunctionExpression' || init['type'] === 'FunctionExpression') {
				functions.set(name, init);
			}
			if (init['type'] !== 'ObjectExpression') continue;
			const properties = init['properties'];
			for (const property of Array.isArray(properties) ? properties : []) {
				if (!isNode(property) || property['computed'] === true || !isNode(property['key']))
					continue;
				const key = property['key']['name'];
				if (typeof key === 'string' && isNode(property['value'])) {
					const value = property['value'];
					if (
						value['type'] === 'FunctionExpression' ||
						value['type'] === 'ArrowFunctionExpression'
					) {
						functions.set(`${name}.${key}`, value);
					}
				}
			}
		}
	}
	let size = -1;
	while (found.size !== size) {
		size = found.size;
		moves(body, varying, found, functions);
	}
	return found;
}

/** Every name a top-level statement reading something `varying` assigns or updates. */
export function moves(
	body: readonly unknown[],
	varying: (name: string) => boolean,
	found: Set<string>,
	functions: ReadonlyMap<string, AstNode> = new Map(),
): void {
	// The functions a statement reaches by calling them by name, to the fixed point.
	const through = (statement: AstNode): AstNode[] => {
		const out: AstNode[] = [];
		const seen = new Set<string>();
		const visit = (one: unknown): void => {
			if (Array.isArray(one)) {
				for (const each of one) visit(each);
				return;
			}
			if (!isNode(one)) return;
			const callee = one['type'] === 'CallExpression' ? one['callee'] : undefined;
			const object = one['type'] === 'MemberExpression' ? one['object'] : undefined;
			const property = one['type'] === 'MemberExpression' ? one['property'] : undefined;
			const name =
				isNode(callee) && callee['type'] === 'Identifier'
					? callee['name']
					: one['computed'] !== true &&
						  isNode(object) &&
						  object['type'] === 'Identifier' &&
						  isNode(property) &&
						  typeof object['name'] === 'string' &&
						  typeof property['name'] === 'string'
						? `${object['name']}.${property['name']}`
						: undefined;
			const fn = typeof name === 'string' ? functions.get(name) : undefined;
			if (typeof name === 'string' && fn !== undefined && !seen.has(name)) {
				seen.add(name);
				out.push(fn);
				visit(fn['body']);
			}
			for (const value of Object.values(one)) visit(value);
		};
		visit(statement);
		return out;
	};
	const root = (target: unknown): void => {
		let at = target;
		while (isNode(at) && at['type'] === 'MemberExpression') at = at['object'];
		if (isNode(at) && at['type'] === 'Identifier' && typeof at['name'] === 'string') {
			found.add(at['name']);
		}
	};
	const step = (one: unknown): void => {
		if (Array.isArray(one)) {
			for (const each of one) step(each);
			return;
		}
		if (!isNode(one)) return;
		if (one['type'] === 'AssignmentExpression') root(one['left']);
		if (one['type'] === 'UpdateExpression') root(one['argument']);
		// A method of the language's own that changes what it is called on: `log.push(x)`.
		const callee = one['type'] === 'CallExpression' ? one['callee'] : undefined;
		if (isNode(callee) && callee['type'] === 'MemberExpression') {
			const method = callee['property'];
			if (isNode(method) && typeof method['name'] === 'string' && MUTATING.has(method['name'])) {
				root(callee['object']);
			}
		}
		for (const value of Object.values(one)) step(value);
	};
	for (const statement of body) {
		if (!isNode(statement)) continue;
		const type = statement['type'];
		// `$props()` reads the request by definition, and a default in its pattern runs only where the
		// request sent nothing: what the defaults call moves what it assigns.
		const destructured = type === 'VariableDeclaration' && propsDeclaration(statement);
		if (
			!destructured &&
			(type === 'ImportDeclaration' ||
				type === 'VariableDeclaration' ||
				type === 'FunctionDeclaration' ||
				type === 'ExportNamedDeclaration' ||
				type === 'ClassDeclaration')
		) {
			continue;
		}
		const calls = through(statement);
		if (destructured) {
			for (const fn of calls) step(fn['body']);
			continue;
		}
		let reads = false;
		for (const one of [statement, ...calls.map((fn) => fn['body'])]) {
			readsIn(one, new Set(), (at) => {
				if (typeof at['name'] === 'string' && varying(at['name'])) reads = true;
			});
		}
		if (!reads) continue;
		step(statement);
		for (const fn of calls) step(fn['body']);
	}
}

/**
 * The names the markup changes while the bytes are written, and the functions it calls to change
 * them: what they hold is read where the render reads it, per request, from the run. See `ran()`
 * in skeleton.ts.
 */
export function liveIn(changed: ReadonlyMap<string, string>): string[] {
	return [...changed]
		.filter(([, why]) => why.includes('changed by a function this render calls'))
		.map(([name]) => name);
}

/** The methods of ECMAScript's own collections that change the value they are called on. */
const MUTATING: ReadonlySet<string> = new Set([
	'push',
	'pop',
	'shift',
	'unshift',
	'splice',
	'sort',
	'reverse',
	'fill',
	'copyWithin',
	'set',
	'add',
	'delete',
	'clear',
]);

/** Whether a declaration destructures `$props()`, the one statement that reads the request itself. */
function propsDeclaration(statement: AstNode): boolean {
	const declarations = statement['declarations'];
	return (Array.isArray(declarations) ? declarations : []).some((one) => {
		const init = isNode(one) ? one['init'] : undefined;
		const callee = isNode(init) && init['type'] === 'CallExpression' ? init['callee'] : undefined;
		return isNode(callee) && callee['type'] === 'Identifier' && callee['name'] === '$props';
	});
}

/** Whether a statement awaits outside any function inside it, which is Svelte's `has_await_expression`. */
export function awaitsAtTop(node: unknown): boolean {
	if (Array.isArray(node)) return node.some(awaitsAtTop);
	if (!isNode(node)) return false;
	if (node['type'] === 'AwaitExpression') return true;
	if (
		node['type'] === 'FunctionExpression' ||
		node['type'] === 'ArrowFunctionExpression' ||
		node['type'] === 'FunctionDeclaration'
	) {
		return false;
	}
	return Object.values(node).some(awaitsAtTop);
}

/**
 * A replacement that still reads what the original read and Svelte's async mode makes wait.
 *
 * Substitution writes a value where the author wrote a name, and a name that waits -- declared
 * after a top-level `await` -- is what makes Svelte wrap the node reading it in `<!--[-->` and
 * `<!--]-->`. Written as the value alone, Svelte sees nothing waiting and writes no pair, which is
 * the "eighth" anchor in spec/roadmap.md. So the names are read ahead of the value in a sequence:
 * `(recipient, "world")` is the same value, waiting on the same thing.
 */
export function blocking(
	original: unknown,
	replacement: string,
	walk: Walk,
	/**
	 * Written as `[a, b, value][2]` instead, which does not open with a parenthesis: an each with no
	 * `as` reads its expression up to the closing brace, and `{#each (a, value)}` is Svelte's own
	 * parse error.
	 */
	bracketed = false,
): string {
	const blocked = walk.site.blocked;
	if (blocked.size === 0) return replacement;
	const read = new Set<string>();
	for (const one of Array.isArray(original) ? original : [original]) {
		readsIn(one, new Set(), (at) => {
			if (typeof at['name'] === 'string' && blocked.has(at['name'])) read.add(at['name']);
		});
	}
	if (read.size === 0) return replacement;
	return bracketed
		? `[${[...read].join(', ')}, ${replacement}][${String(read.size)}]`
		: `(${[...read].join(', ')}, ${replacement})`;
}

/**
 * A construct's replacement as Svelte's async mode has to see it: reading what the original read
 * that waits (`blocking()`), and awaiting where the original awaits.
 *
 * `create_child_block` in `3-transform/server/visitors/shared/utils.js` wraps a node whose
 * `metadata.expression.has_await` is set in `renderer.child_block`, and that pushes `BLOCK_OPEN`
 * and `BLOCK_CLOSE` around what the node writes. Substituting the awaited value away, Svelte saw no
 * await and wrote no pair, so the keyword is kept -- `await` of a value that is not a promise is that
 * value, so nothing else moves.
 *
 * Where the await is only in the expansion -- a name declared with one -- it is kept only where no
 * blocker explains it. A script declaration that awaits gives its name a blocker, and Svelte waits
 * on a read of it through `async_block` rather than through the read's own `has_await`: kept as an
 * `await` as well, an else-if reading one stopped being flattened into its chain and wrote a block
 * of its own (`async-if-nested`). A `{@const}` that awaits has no blocker in that sense, so its
 * reads keep the `await`.
 */
export function waitsOn(
	original: unknown,
	expanded: string,
	replacement: string,
	walk: Walk,
	bracketed = false,
): string {
	const blocked = blocking(original, replacement, walk, bracketed);
	const own = awaitsAtTop(original);
	const through = awaiting(expanded) && blocked === replacement;
	return own || through ? `await ${blocked}` : blocked;
}

/**
 * Whether an expression awaits only through a name that waits, which the render has to be left to
 * evaluate as written: `<X />` over `const X = $derived(await Promise.resolve(Component))` is a
 * component the render reads off its own declaration, and written as the expansion,
 * `<svelte:component this={(await ...)}>`, Svelte's output would not load.
 */
export function waitsThrough(original: unknown, expanded: string, walk: Walk): boolean {
	return !awaitsAtTop(original) && awaiting(expanded) && blockedRead(original, walk);
}

/** Whether an expression reads a name Svelte's async mode makes wait. See `blocking()`. */
export function blockedRead(original: unknown, walk: Walk): boolean {
	return blocking(original, '', walk) !== '';
}

/**
 * Whether an expression awaits outside any function, which is what `has_await` records.
 *
 * **The run's own await is not one.** A script's run is `(await $$run(...))` in async mode, since
 * the render it makes is awaited there (`carry.ts`), and an expansion reading a name the run holds
 * carries that await. It is this compiler's, not the author's: Svelte sees `{props.qux}` and
 * wraps nothing, and written into the markup it made Svelte refuse a legacy copy outright
 * (`runtime-legacy/props-reactive`, `legacy_await_invalid`). See spec/derivation.md, "Where
 * substitution cannot follow, the script runs as Svelte compiled it".
 */
export function awaiting(text: string): boolean {
	if (!/\bawait\b/.test(text)) return false;
	let ast: Node;
	try {
		ast = parsed(text) as unknown as Node;
	} catch {
		return false;
	}
	// An await of the run is this compiler's, not the author's; see above.
	return awaitsIn(ast, (one) => {
		const callee = isNode(one['argument']) ? one['argument']['callee'] : undefined;
		return isNode(callee) && callee['name'] === RUN_NAME;
	});
}
