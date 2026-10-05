/**
 * What each name an expression reads means, decided when the program is written: in the order
 * the evaluator looked it up, what the request binds, the files the expression was written across
 * innermost first, the data -- what a block binds, then the payload and the derivations -- and the
 * shared helpers. A name none of them holds is the host's, left as written. See spec/derivation.md,
 * "A name is resolved when the program is written".
 */
import { type Node, rewritten, rewrittenWithin } from './rewrite.ts';
import {
	type Context,
	GLOBALS,
	type Info,
	json,
	local,
	metaFree,
	ROOT_SPECIAL,
	RUNTIME,
	textKey,
} from './model.ts';
import type { Program } from './state.ts';

/** A derivation's expression with its names resolved. */
export function expression(p: Program, info: Info, context: Context): string {
	return rewritten(
		metaFree(info.derivation.expression),
		(name, bound) => resolve(p, context, name, bound),
		(call, bound, source) => within(p, context, call, bound, source),
		(name, bound) => typeOf(p, context, name, bound),
	);
}

/** A node of an expression with its names resolved, for a caller writing the rest itself. */
export function written(
	p: Program,
	context: Context,
	source: string,
	node: Node,
	bound: ReadonlySet<string>,
): string {
	return rewrittenWithin(
		source,
		node,
		bound,
		(name, inner) => resolve(p, context, name, inner),
		(call, inner, text) => within(p, context, call, inner, text),
		(name, inner) => typeOf(p, context, name, inner),
	);
}

export function resolve(
	p: Program,
	context: Context,
	name: string,
	bound: ReadonlySet<string>,
): string | null {
	const found = resolution(p, context, name, bound);
	if (found === null) return null;
	if ('text' in found) return found.text;
	return `(${found.test} ? $out[${json(name)}] : ${found.rest ?? name})`;
}

/** `typeof name`, whole: a name no layer holds stays the host's, and `typeof` of it does not throw. */
function typeOf(
	p: Program,
	context: Context,
	name: string,
	bound: ReadonlySet<string>,
): string | null {
	const found = resolution(p, context, name, bound);
	if (found === null) return null;
	if ('text' in found) return `typeof (${found.text})`;
	return `(${found.test} ? typeof $out[${json(name)}] : typeof ${found.rest ?? name})`;
}

function resolution(
	p: Program,
	context: Context,
	name: string,
	bound: ReadonlySet<string>,
): { text: string } | { test: string; rest: string | null } | null {
	if (context.pieceLocals?.has(name) === true) return null;
	if (name === '$$request') return { text: '$req' };
	if (name === '$$hydratable') return { text: '$hyd' };
	if (requestMarked(context).has(name)) return { text: '$hyd' };
	const file = p.fileName(context.chain, name);
	if (file !== null) return { text: file };
	const data = dataRead(p, context, name, bound);
	if (data !== null) return { text: data };
	// A payload key nothing declares, which the data held and a name the host has may not be:
	// asked of the payload as the request brings it. Not of a name the language itself defines,
	// nor of one this compiler writes, `$$` and all, which no payload carries in place of either.
	const test =
		GLOBALS.has(name) || name.startsWith('$$')
			? null
			: perItem(context)
				? `Object.hasOwn($out, ${json(name)})`
				: `${json(name)} in $out`;
	let rest: string | null = null;
	for (
		let outer: Context | undefined = context.outer;
		outer && rest === null;
		outer = outer.outer
	) {
		rest = p.fileName(outer.chain, name);
	}
	rest ??= own(p, name) ?? p.fileName(['*'], name) ?? RUNTIME[name] ?? null;
	if (test === null) return rest === null ? null : { text: rest };
	return { test, rest };
}

/**
 * A boundary's helpers, as the program answers them: what a boundary came to is what its `try`
 * caught, and a guard inside one lets the throw reach that `try`. Each falls back on the carried
 * helper where the program wrote no boundary of its own. See boundary.ts.
 */
export function own(p: Program, name: string): string | null {
	if (name !== '$$caught' && name !== '$$tried') return null;
	if (p.fileName(['*'], name) === null) return null;
	return name === '$$caught' ? '$caughtNow' : '$triedNow';
}

/** Which kind of derivation a place is in, which a guard's value is looked up among. */
export function kindAt(context: Context): 'scoped' | 'lazy' {
	return perItem(context) ? 'scoped' : 'lazy';
}

/** Whether a place reads its data the way a per-item derivation did, own keys only. */
function perItem(context: Context): boolean {
	return context.outer !== undefined ? perItem(context.outer) : context.params !== undefined;
}

function requestMarked(context: Context): ReadonlySet<string> {
	if (context.outer === undefined) return context.marked;
	return new Set([...context.marked, ...requestMarked(context.outer)]);
}

/** The data layer: a block-bound name where one is in scope, then the payload and derivations. */
function dataRead(
	p: Program,
	context: Context,
	name: string,
	bound: ReadonlySet<string>,
): string | null {
	const block = blockName(p, context, name);
	if (block !== null) return block;
	const info = p.infos.get(name);
	if (info !== undefined) return derivationRead(p, context, info, bound);
	if (ROOT_SPECIAL.has(name)) return `$out[${json(name)}]`;
	return null;
}

/** A name a block binds, read by a per-item derivation: its parameter. */
function blockName(p: Program, context: Context, name: string): string | null {
	if (context.outer !== undefined) return blockName(p, context.outer, name);
	if (context.params === undefined || !p.blockNames.has(name)) return null;
	context.params.add(name);
	return local(name);
}

/** Another derivation read from an expression: its value, or its call with what it is called with. */
export function derivationRead(
	p: Program,
	context: Context,
	info: Info,
	bound: ReadonlySet<string>,
): string {
	const { name } = info.derivation;
	if (info.kind === 'prop' || info.kind === 'eager') return `$out[${json(name)}]`;
	if (info.kind === 'lazy') return `$d${String(info.index)}()`;
	const args = info.params.map((param) => argument(p, context, param, bound));
	const call = `$s${String(info.index)}(${args.join(', ')})`;
	const awaited = awaitedSite(context, call);
	if (awaited !== null) return awaited;
	// Read again in the same evaluation with the same arguments, it is the value already read: an
	// argument the expression binds itself differs from one call to the next, and is not.
	const changing = info.params.some(
		(param) => bound.has(param) || context.pieceLocals?.has(param) === true,
	);
	const reads = context.reads;
	if (reads === undefined || changing) return call;
	let held = reads.seen.get(call);
	if (held === undefined) {
		held = `$q${String(reads.seen.size)}`;
		reads.seen.set(call, held);
		reads.declared.push(`let ${held} = $U;`);
	}
	return `(${held} !== $U ? ${held} : (${held} = ${call}))`;
}

function awaitedSite(context: Context, call: string): string | null {
	for (let at: Context | undefined = context; at; at = at.outer) {
		const found = at.awaitedSites?.get(call);
		if (found !== undefined) return found;
	}
	return null;
}

/** What a per-item derivation is called with for one of its names, from where it is read. */
function argument(p: Program, context: Context, param: string, bound: ReadonlySet<string>): string {
	if (bound.has(param)) return param;
	if (context.pieceLocals?.has(param) === true) return param;
	const block = blockName(p, context, param);
	if (block !== null) return block;
	return rootRead(p, param);
}

/** A name read where no block binds it: the payload's, or nothing. */
export function rootRead(p: Program, name: string): string {
	const info = p.infos.get(name);
	if (info !== undefined && (info.kind === 'prop' || info.kind === 'eager')) {
		return `$out[${json(name)}]`;
	}
	return 'undefined';
}

/**
 * `$$within(chain, $scope, $request, { names }, "code")`, written in place: the code another
 * component wrote, its names resolved through that component's files, as a function of the names
 * the run binds around it. See `boundary()` in the skeleton package.
 */
function within(
	p: Program,
	context: Context,
	call: Node,
	bound: ReadonlySet<string>,
	source: string,
): string | null {
	const guard = tried(p, context, call, bound, source);
	if (guard !== null) return guard;
	const callee = call['callee'] as Node;
	if (callee.type !== 'Identifier' || callee['name'] !== '$$within' || bound.has('$$within')) {
		return null;
	}
	const [chainNode, , , localsNode, codeNode] = call['arguments'] as Node[];
	if (
		chainNode?.type !== 'ArrayExpression' ||
		localsNode?.type !== 'ObjectExpression' ||
		codeNode?.type !== 'Literal' ||
		typeof codeNode['value'] !== 'string'
	) {
		throw new Error(
			`a \`$$within\` this compiler did not write: ${source.slice(call.start, call.end)}`,
		);
	}
	const chain = (chainNode['elements'] as Node[]).map((one) => String(one['value']));
	const names: string[] = [];
	const values: string[] = [];
	for (const property of localsNode['properties'] as Node[]) {
		const key = property['key'] as Node;
		names.push(String(key['name'] ?? key['value']));
		values.push(written(p, context, source, property['value'] as Node, bound));
	}
	const piece: Context = {
		chain,
		marked: p.marked(chain),
		pieceLocals: new Set(names),
		outer: context,
	};
	const code = metaFree(codeNode['value']);
	const body = rewritten(
		code,
		(name, inner) => resolve(p, piece, name, inner),
		(inner, innerBound, text) => within(p, piece, inner, innerBound, text),
		(name, inner) => typeOf(p, piece, name, inner),
	);
	const value = /\bawait\b/.test(code) ? `(async () => (${body}))()` : `(${body})`;
	return `((${names.join(', ')}) => ${value})(${values.join(', ')})`;
}

/**
 * `$$tried($$request, null, () => (value))` over a value another derivation of the same files
 * computes -- a boundary's run held what its children compute, and the hole writing one guards the
 * same text -- reads that derivation, so the two are one value, computed once per item.
 */
function tried(
	p: Program,
	context: Context,
	call: Node,
	bound: ReadonlySet<string>,
	source: string,
): string | null {
	const callee = call['callee'] as Node;
	const args = call['arguments'] as Node[];
	const [request, key, body] = args;
	if (
		callee.type !== 'Identifier' ||
		callee['name'] !== '$$tried' ||
		bound.has('$$tried') ||
		args.length !== 3 ||
		body?.type !== 'ArrowFunctionExpression' ||
		(body['params'] as unknown[]).length !== 0 ||
		(body['body'] as Node).type === 'BlockStatement' ||
		request === undefined ||
		key === undefined
	) {
		return null;
	}
	const inner = body['body'] as Node;
	const found = p.byText.get(
		`${kindAt(context)}\u0002${textKey(context.chain, source.slice(inner.start, inner.end)) ?? ''}`,
	);
	if (found === undefined) return null;
	const plain = (node: Node): string =>
		rewrittenWithin(source, node, bound, (name, at) => resolve(p, context, name, at));
	const read = derivationRead(p, context, found, bound);
	return `${resolve(p, context, '$$tried', bound) ?? '$$tried'}(${plain(request)}, ${plain(key)}, () => (${read}))`;
}
