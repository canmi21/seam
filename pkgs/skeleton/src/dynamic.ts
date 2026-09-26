/**
 * What the request decides: whether an expression varies with it, which names a file's script
 * changes or the render mutates, what a context read or a host global makes of one, and what
 * may be evaluated outside the render. See spec/derivation.md.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { parse } from 'svelte/compiler';
import {
	ambientIn,
	AT_REQUEST,
	bindings,
	identifierOf,
	mentions,
	onlyWithin,
	readsOf,
	parsed,
	parsedComponent,
	resolveBare,
	rootOf,
} from 'ast';
import { carries, importsOf } from './compose.ts';
import { type AstNode, isNode, namesIn, refuse, span } from './node.ts';
import { RUNE, unknown } from './branches.ts';
import { type Walk } from './walk-types.ts';

/** The locals a file imports from a runes module, which Svelte compiles and nothing else runs. */
export function runesOf(imports: Record<string, string>, file: string): Set<string> {
	const found = new Set<string>();
	for (const [local, from] of Object.entries(imports)) {
		// The file decides, not the specifier: a bundler is asked for `x.svelte` and completes it
		// to `x.svelte.ts`, and `$lib` stands in front of either.
		const target = resolveBare(from, file) ?? from;
		if (/\.svelte\.(?:ts|js)$/.test(target)) found.add(local);
	}
	return found;
}

/**
 * Whether the request decides an expression's value: it reads a name the walk does not hold,
 * and not only inside the arguments of a call into a runes module. Such a call's value on the
 * server is decided inside a render by the library -- a query never runs there and is pending
 * whatever its key -- so the render is asked, the way it is asked about anything the request
 * does not decide. See `onlyWithin`.
 */
/**
 * Records the context keys this file sets from a value the request decides.
 *
 * `setContext(k, v)` runs while the bytes are written and stores `v` where a descendant's
 * `getContext(k)` reads it. Neither name is one the request decides, so an expression reading a
 * context looks inert and is handed to the render -- which has the neutralised value, not the
 * request's. Walked before the file's markup is, so a parent's keys are known by the time a child
 * reads one.
 */
export function contextual(ast: AstNode, walk: Walk): void {
	const local = new Set(
		Object.entries(importsOf(walk.source))
			.filter(([, from]) => from === 'svelte')
			.map(([name]) => name),
	);
	const step = (one: unknown): void => {
		if (Array.isArray(one)) {
			for (const each of one) step(each);
			return;
		}
		if (!isNode(one)) return;
		if (one['type'] === 'CallExpression') {
			const callee = one['callee'];
			const name = isNode(callee) && typeof callee['name'] === 'string' ? callee['name'] : '';
			if (name === 'setContext' && local.has(name)) {
				const args = Array.isArray(one['arguments']) ? one['arguments'] : [];
				const [key, value] = args;
				let written = '';
				try {
					written = value === undefined ? '' : walk.expand(value);
				} catch {
					written = '';
				}
				if (written !== '' && varies(written, walk)) {
					const literal =
						isNode(key) && key['type'] === 'Literal' && typeof key['value'] === 'string'
							? key['value']
							: null;
					walk.site.contexts.add(literal ?? '*');
				}
			}
		}
		for (const value of Object.values(one)) step(value);
	};
	for (const block of [ast['module'], ast['instance']]) {
		if (!isNode(block)) continue;
		const content = block['content'];
		if (isNode(content)) step(content['body']);
	}
}

/**
 * The names a module exports that something in it changes, by module path.
 *
 * **The render's module instances are not the artifact's.** An expression the walk judges inert is
 * handed back for Svelte to evaluate in the render, which imports the module afresh; a derivation
 * evaluates in the carried bundle, which imported it once. Where the module holds no state the two
 * agree, which is what makes handing an inert `cn(...)` to the render right. Where it does, they
 * are two states:
 *
 * ```js
 * export const seen = [];
 * export function mark(x) { seen.push(x); return seen.length; }
 * ```
 *
 * `{mark(n)}` is a marker and runs in the bundle; `{seen.length}` looked inert and ran in the
 * render, where `mark` was a marker and never ran. Measured: `1:0`, `2:0` against Svelte's `1:1`,
 * `2:2`.
 *
 * Refused rather than moved. A derivation is a pure expression computed once per request and held,
 * and `seen.length` is neither pure nor once: read per item it would give `1:1`, `2:1` where
 * Svelte gives `1:1`, `2:2`, so there is no place in this pipeline that is right.
 *
 * Only a relative module, whose source this can read. A package's is a hole, named in
 * spec/roadmap.md.
 */
const CHANGED = new Map<string, ReadonlySet<string>>();

export function changedBy(file: string): ReadonlySet<string> {
	const held = CHANGED.get(file);
	if (held !== undefined) return held;
	const found = new Set<string>();
	CHANGED.set(file, found);
	let source: string;
	try {
		source = readFileSync(file, 'utf8');
	} catch {
		return found;
	}
	let ast: AstNode;
	try {
		// A component's `<script module>` is module state too, reached by a named import of the
		// component. Its source is already markup, so it is parsed as what it is rather than
		// wrapped; everything else is a module and is wrapped to be read the same way.
		ast = parse(file.endsWith('.svelte') ? source : `<script module lang="ts">${source}</script>`, {
			modern: true,
		}) as unknown as AstNode;
	} catch {
		return found;
	}
	const block = ast['module'];
	const content = isNode(block) ? block['content'] : undefined;
	if (!isNode(content) || !Array.isArray(content['body'])) return found;
	const declared = new Set<string>();
	for (const statement of content['body']) {
		const one =
			isNode(statement) && statement['type'] === 'ExportNamedDeclaration'
				? statement['declaration']
				: statement;
		if (!isNode(one) || one['type'] !== 'VariableDeclaration') continue;
		for (const each of Array.isArray(one['declarations']) ? one['declarations'] : []) {
			if (isNode(each)) namesIn(each['id'], declared);
		}
	}
	// Every assignment, update and method call in the file, wherever it is written: a module's
	// functions are called from the artifact, so a mutation inside one of them happens.
	const hit = (target: unknown): void => {
		const name = rootOf(target);
		if (name !== null && declared.has(name)) found.add(name);
	};
	const step = (one: unknown): void => {
		if (Array.isArray(one)) {
			for (const each of one) step(each);
			return;
		}
		if (!isNode(one)) return;
		if (one['type'] === 'AssignmentExpression') hit(one['left']);
		if (one['type'] === 'UpdateExpression') hit(one['argument']);
		if (one['type'] === 'CallExpression') {
			const callee = one['callee'];
			if (isNode(callee) && callee['type'] === 'MemberExpression') hit(callee['object']);
		}
		for (const value of Object.values(one)) step(value);
	};
	step(content['body']);
	return found;
}

/** The local names this file imports that the module they come from changes. */
function unstable(walk: Walk): ReadonlySet<string> {
	const found = new Set<string>();
	for (const [local, one] of walk.site.carried) {
		if (!one.from.startsWith('.')) continue;
		// Only the default import of a component is the component; a named one is its module
		// script, whose state changes the same way any module's does.
		if (one.from.endsWith('.svelte') && one.kind === 'default') continue;
		const at = resolvePath(dirname(walk.site.file), one.from);
		const exported = one.kind === 'named' ? (one.exported ?? one.local) : null;
		if (exported === null) continue;
		if (changedBy(at).has(exported)) found.add(local);
	}
	return found;
}

/**
 * Whether this component's own render calls into a relative module that changes something of its
 * own: a call its script makes as it runs, or one its markup makes, and not one inside a function
 * only a handler runs. See `unstable()`.
 */
function stirred(walk: Walk): boolean {
	const into = new Set<string>();
	for (const [local, one] of walk.site.carried) {
		if (!one.from.startsWith('.')) continue;
		if (changedBy(resolvePath(dirname(walk.site.file), one.from)).size > 0) into.add(local);
	}
	if (into.size === 0) return false;
	let ast: AstNode;
	try {
		ast = parsedComponent(walk.source) as AstNode;
	} catch {
		return true;
	}
	const called = new Set<string>();
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
			type === 'ArrowFunctionExpression'
		) {
			return;
		}
		const callee = node['callee'];
		if (type === 'CallExpression' && isNode(callee) && typeof callee['name'] === 'string') {
			called.add(callee['name']);
		}
		for (const value of Object.values(node)) visit(value);
	};
	const instance = ast['instance'];
	visit(isNode(instance) ? instance['content'] : undefined);
	visit(ast['fragment']);
	return [...called].some((one) => into.has(one));
}

/** An expression as parsed, with the text and the offset its positions are counted from. */
export function expressionIn(text: string): { node: unknown; text: string; offset: number } | null {
	try {
		const fragment = (parsed(text) as AstNode)['fragment'];
		const [tag] = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
		if (!isNode(tag)) return null;
		return { node: tag['expression'], text, offset: '<script lang="ts"></script>{'.length };
	} catch {
		return null;
	}
}

/**
 * A `hydratable` call in a script the run would answer. The script the injector writes is made from
 * the entry's own calls, computed first on every request, and a run cannot hand back which calls it
 * made. See spec/derivation.md.
 */
export const HYDRATABLE = /\bhydratable\b/;

export const HYDRATABLE_RUN =
	'a `hydratable` call in a script this compiler runs per request: the script the injector ' +
	'writes is made from the calls the entry makes first, and a run cannot hand back which it ' +
	'made. See spec/derivation.md';

/**
 * An expression that does not read the same twice, marked with where it was written.
 *
 * Lowering makes one derivation per expression text, which is right for one expression substituted
 * at several reads -- Svelte evaluated it once -- and wrong for two places that happen to write the
 * same text: `{Math.random()}` twice is two numbers in Svelte's render. The place goes in as a
 * comment, so text from one place still meets itself and two places stay two.
 */
export function placed(text: string, node: unknown, file: string): string {
	const at = span(node);
	// Text that already carries a place came from there by substitution: a prop read three times in
	// a child is the caller's one expression, which Svelte evaluated once.
	if (at === null || text.includes('/*@') || !ambientText(text)) return text;
	return `${text} /*@${basename(file).replaceAll('*', '')}:${String(at[0])} */`;
}

/** Whether an expression reads a clock, randomness or a fresh symbol. See `ambientIn()` in `ast`. */
function ambientText(expression: string): boolean {
	if (!/\b(?:Math|Date|Symbol)\b/.test(expression)) return false;
	try {
		const fragment = (parsed(expression) as AstNode)['fragment'];
		const [tag] = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
		return isNode(tag) && ambientIn(tag['expression']).length > 0;
	} catch {
		return true;
	}
}

/**
 * A file's host globals as a test by the word: a name no script in it writes. By the word rather than
 * through `mentions`, which reads an expression it cannot parse as naming everything. See `varies()`.
 */
export function hostedIn(source: string, file: string): RegExp | null {
	let names: string[];
	try {
		names = bindings(source, file)
			.unresolved.filter((one) => one.reason === 'free')
			.map((one) => one.name);
	} catch {
		return null;
	}
	if (names.length === 0) return null;
	// Escaped whole, though a name the parser handed back holds nothing but `\w` and `$`: an escape
	// that covers one character is the shape CodeQL reads as incomplete (alert 40), and the whole
	// one costs nothing. `RegExp.escape` is what Node runs and not yet what `target` types, so
	// the character class is written out. See spec/suite.md, "What CodeQL reports about code this
	// compiler writes".
	const words = [...new Set(names)].map((one) => one.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	return new RegExp(`(?:^|[^$\\w.])(?:${words.join('|')})\\b`);
}

/** Whether an expression reads a context, which is a channel this walk does not follow. */
const READS_CONTEXT = /\bget(?:All)?Contexts?\b/;

/**
 * Whether an expression may read a context, which only a render has: Svelte's own context API by
 * name, or anything imported from Svelte or from a component's module script, which is where the
 * getter `createContext` hands back is exported from. Read where every value would otherwise be a
 * hole, to leave these to the render. See `Walk.holding`.
 */
export function rendersOnly(expression: string, walk: Walk): boolean {
	if (READS_CONTEXT.test(expression)) return true;
	const names = new Set(
		Object.entries(walk.site.imports)
			.filter(([, from]) => from === 'svelte' || from.endsWith('.svelte'))
			.map(([name]) => name),
	);
	return names.size > 0 && mentions(expression, names);
}

/**
 * A read of one of the names the server holds and the build has not, by the word.
 *
 * Not a member of something else: `a.process` is somebody's own property, and `$process` is a
 * store. The shape is `carries()`'s, which asks the same kind of question of Svelte's helpers.
 */
const SERVER_HELD = new RegExp(`(?:^|[^$\\w.])(?:${[...AT_REQUEST].join('|')})\\b`);

export function varies(
	expression: string,
	walk: Walk,
	/**
	 * Set where the render is given the author's own source rather than this expansion.
	 *
	 * A test the render answers is written into the script by `asWritten`, which is the source as
	 * the author wrote it -- so `$foo` over a store this file makes is a question the render can
	 * answer, where the expansion naming `$$get` is not something it could be handed. The
	 * derivation still holds the expansion, and the carried bundle has those helpers in it.
	 */
	written = false,
): boolean {
	// What a boundary caught is the request's, and so is everything read off it, in whichever
	// component the failed snippet hands it to. See `boundary()`.
	if (expression.includes('$$caught(')) return true;
	// A name a statement reading the request assigns is the request's, whatever else it reads. See
	// `movedBy()`.
	if (walk.site.moved.size > 0 && mentions(expression, walk.site.moved)) return true;
	// And so is writing one, which is not a read: `{num++}` over a `num` the markup changes.
	if (walk.site.moved.size > 0 && assigned(expression).some((one) => walk.site.moved.has(one))) {
		return true;
	}
	// One of Svelte's own functions this compiler carries is not a name the render can be handed:
	// Svelte's compiler refuses a `$`-prefixed variable in markup outright. See `carries()`.
	if (!written && carries(expression)) return outside(expression);
	// A name the server holds and the build has not -- `process.env`. Svelte reads it inside
	// `render()`, once per request, and a derivation is read once per request too, so the two
	// agree. Handed to the compile-time render instead it would read the build machine's value and
	// write that into the bytes, which is the one answer neither of them gives.
	//
	// Tested by the word rather than through `unknown()`, which is what `carries` does and for the
	// same reason: `mentions` reports an expression it cannot parse as mentioning everything, so a
	// set that is never empty made every unreadable expression vary. A class field written
	// `$derived(...)` is one of those, and it took a sample that has nothing to do with the
	// environment. See `AT_REQUEST`.
	if (SERVER_HELD.test(expression)) return outside(expression);
	// A clock, randomness, a fresh symbol or a host's global: what Svelte's render reads while it
	// writes, which a derivation reads per request and the build never reads in its place. See
	// spec/derivation.md, "Ambient input is read at request time, never at the build".
	if (ambientText(expression) || walk.site.hosted?.test(expression) === true) {
		return outside(expression);
	}
	// A context read where something in this walk set one from a value the request decides. Neither
	// `getContext` nor the key is a name the request decides, so this would be handed to the render
	// -- which holds the neutralised value the `setContext` was given there. Refused rather than
	// made a marker: a derivation is evaluated outside `render()`, where there is no context to
	// read. See `Site.contexts`.
	// A module binding something in that module changes. The render imports the module afresh and
	// the carried bundle imported it once, so an inert read is answered by the wrong one of the two
	// -- and there is no place in this pipeline that is right, a derivation being pure and held.
	// See `changedBy()`.
	// Read per request instead, in the carried bundle, which imported the module once as a server
	// process does -- the state as it stands at the request. See spec/derivation.md. Unless this
	// render itself calls into that module: the change would then be made while the bytes are
	// written, in an order the render keeps and a derivation reading the module does not.
	const moving = unstable(walk);
	if (moving.size > 0 && mentions(expression, moving)) {
		if (stirred(walk)) {
			refuse(
				`a module binding something in that module changes -- ${[...moving]
					.map((one) => `\`${one}\``)
					.join(', ')} -- read beside a call into that module this render makes, so the value ` +
					'depends on the calls made while the bytes are written, in their order, which a ' +
					'derivation reading the module per request does not keep. See spec/derivation.md',
			);
		}
		return outside(expression);
	}
	if (walk.site.contexts.size > 0 && READS_CONTEXT.test(expression)) {
		refuse(
			'a context read where a `setContext` in this render was given a value the request ' +
				'decides. The value reaches the reader through a channel this compiler does not ' +
				'follow, and evaluating the read outside `render()` has no context to read from. ' +
				'Hand the value down as a prop. See spec/refusals.md',
		);
	}
	const names = unknown(walk);
	if (!mentions(expression, names)) return false;
	const varying = !onlyWithin(expression, names, walk.site.runes);
	if (!varying) return false;
	return outside(expression);
}

/** The node types that hold a body the expression may or may not call. */
const FUNCTIONS: ReadonlySet<string> = new Set([
	'FunctionDeclaration',
	'FunctionExpression',
	'ArrowFunctionExpression',
]);

/**
 * The first name an expression assigns to and does not itself declare, or null where there is none.
 *
 * Declarations are collected from the whole expression rather than per scope: a name declared in
 * one function and assigned in another is a shape nothing here writes, and reading the scopes
 * exactly would refuse more than the question asks. Loose in the direction of not refusing, which
 * is the safe one here -- what is missed is a derivation that throws at request time and says so,
 * not a byte written wrongly and silently.
 */
export function assigns(expression: string): string | null {
	return assigned(expression)[0] ?? null;
}

/** Every bare name an expression assigns to that it does not bind itself. See `assigns()`. */
export function assigned(expression: string): string[] {
	let ast: unknown;
	try {
		ast = parsed(expression);
	} catch {
		return [];
	}
	const bound = new Set<string>();
	const targets: string[] = [];
	// A bare name only. `counter.count += 1` over an imported `counter` writes into the module the
	// carried bundle holds, which is a module the derivation has: it is the rule about a module
	// binding something in that module changes, and `changedBy()` owns it. What cannot work at all
	// is a bare name nothing binds, since `reads()` never substituted it and nothing declares it.
	// Only where the assignment can run while the expression is evaluated. A function the
	// expression holds rather than calls writes nothing: `handleClick={() => clicked = letter}` is
	// a handler handed to a component and the server calls nothing, which is the same reading
	// `losing()` makes of a name the markup only names inside a function. A function called where
	// it is written is the other case, and it is the one this is here for -- an arrow invoked at
	// once, and a generator invoked and then drained by `to_array`.
	/** What a function binds, whether or not this expression ever runs its body. */
	const binds = (node: AstNode): void => {
		if (isNode(node['id']) && typeof node['id']['name'] === 'string') bound.add(node['id']['name']);
		for (const one of Array.isArray(node['params']) ? node['params'] : []) namesIn(one, bound);
	};
	/** Walks what the expression evaluates, and nothing it only holds. */
	const step = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const one of node) step(one);
			return;
		}
		if (!isNode(node)) return;
		const type = String(node['type']);
		if (type === 'VariableDeclarator') namesIn(node['id'], bound);
		// A function this expression holds rather than calls writes nothing while the bytes are
		// written: `handleClick={() => clicked = letter}` is a handler handed to a component and the
		// server calls nothing. It is read for what it binds and no further, which is the same
		// reading `losing()` makes of a name the markup only names inside a function.
		if (FUNCTIONS.has(type)) {
			binds(node);
			return;
		}
		if (type === 'AssignmentExpression') {
			const name = identifierOf(node['left']);
			if (name !== null) targets.push(name);
		}
		if (type === 'UpdateExpression') {
			const name = identifierOf(node['argument']);
			if (name !== null) targets.push(name);
		}
		// A function written where it is called does run: an arrow invoked at once, and a generator
		// invoked and then drained by `to_array`.
		if (type === 'CallExpression') {
			const callee = node['callee'];
			if (isNode(callee) && FUNCTIONS.has(String(callee['type']))) {
				binds(callee);
				step(callee['body']);
			} else {
				step(callee);
			}
			step(node['arguments']);
			return;
		}
		for (const value of Object.values(node)) step(value);
	};
	step(ast);
	return targets.filter((one) => !bound.has(one));
}

/**
 * What cannot survive being a derivation, asked wherever one is about to be made.
 *
 * A marker means a derivation, and a derivation is an expression evaluated outside `render()`. Two
 * things cannot make that trip, and both were reaching the evaluator and throwing there rather than
 * naming a file here. Asked at every answer `varies()` gives rather than at its last one: an
 * expansion naming one of Svelte's own helpers is a derivation before anything asks which names it
 * reads, and a context read wrapped in `$$get_store` went out that way and threw
 * `lifecycle_outside_component` at injection.
 *
 * Returns true, so it reads as the answer it guards.
 */
export function outside(
	expression: string,
	/**
	 * Set where the expression is one the artifact holds rather than one the walk is considering.
	 *
	 * `varies()` asks this of markup the walk may still fold away -- an `{#await}`'s `then` branch
	 * is walked and then not rendered, since the server writes the pending branch for a promise --
	 * and a refusal about markup nothing renders is a refusal about nothing. The two questions
	 * below hold whenever an expression is written out at all; the third is asked only of what is
	 * left at the end.
	 */
	written = false,
	/** The names substitution could not follow, with why. See `Site.changing`. */
	changing: ReadonlyMap<string, string> = new Map(),
): boolean {
	// A name substitution could not follow, left as the author wrote it and now inside an
	// expression this compiler has to write itself. The render would have evaluated it against the
	// value the script left; nothing evaluates a derivation against that, so this is where the rule
	// about a value the render changes refuses, rather than at the declaration.
	if (changing.size > 0) {
		for (const name of readsOf([expression])) {
			// `$x` is a subscription to `x`, so it is a read of `x` and stands or falls with it.
			const why =
				changing.get(name) ?? (name.startsWith('$') ? changing.get(name.slice(1)) : undefined);
			if (why !== undefined) refuse(why);
		}
	}
	// An assignment to a name the expression does not itself declare. A derivation is a pure
	// expression evaluated once per request and outside the script, so the name it writes to is
	// bound nowhere and no other read can see what it wrote. `reads()` never visits an assignment
	// target -- `(0) = 1` is not JavaScript -- so such a name is never substituted and never
	// reported as read either, and it went out as a free name: `let [one, two] = $state(test())`
	// over a generator whose body is `yield count++` reached the evaluator as `count is not
	// defined`, which names nothing an author wrote.
	const changed = written ? assigns(expression) : null;
	if (changed !== null) {
		refuse(
			`\`${changed}\` is assigned inside a value this compiler has to write itself. A derivation ` +
				'is a pure expression evaluated once per request and outside the script, so a name it ' +
				'assigns to is bound nowhere and nothing else can see what it wrote. Compute the value ' +
				'in one expression, or move what changes it out of the render. See spec/derivation.md',
		);
	}
	// A context read: `getContext` and `getAllContexts` ask the component being rendered, and there
	// is none. Handed to the render it is fine, which is the branch above.
	if (READS_CONTEXT.test(expression)) {
		refuse(
			'a context read in a value this compiler has to write itself. `getContext` asks the ' +
				'component being rendered and a derivation is evaluated outside one, so the read has ' +
				'nowhere to come from. Hand the value down as a prop, or write the read where the ' +
				'render can evaluate it. See spec/refusals.md',
		);
	}
	// A rune: `$state`, `$derived` and the rest are compiled away by Svelte and exist nowhere at
	// run time. One left in an expression -- a class field written `$state.raw([])`, which is not a
	// declaration this pass reads -- reached the evaluator as `$state is not defined`.
	const rune = RUNE.exec(expression);
	if (rune !== null) {
		refuse(
			`\`${rune[0].trim()}\` is left in a value this compiler has to write itself. A rune is ` +
				'compiled away by Svelte and is not a function anything can call, so a derivation ' +
				'reading one has nothing to call. See spec/refusals.md',
		);
	}
	return true;
}
