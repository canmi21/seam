/**
 * A `<svelte:boundary>` and what it renders per request, in the order the render computes it, and
 * a raw snippet as a raw hole over the author's `render`. See spec/ir.md.
 */
import { basename } from 'node:path';
import { bound as namesBound, constant, OPTIONS, mentions, reads as readsIn } from 'ast';
import { type AstNode, isNode, refuse, span } from './node.ts';
import { sentinel, THROWN } from './sentinel.ts';
import type { Block, Hole } from './shape.ts';
import { awaiting } from './awaits.ts';
import { chose, keyed } from './branches.ts';
import { collect } from './collect.ts';
import { onlyChild, unwrapped } from './components.ts';
import { expressionIn, varies } from './dynamic.ts';
import { held, stamped } from './stamps.ts';
import { type Walk } from './walk-types.ts';
import { parameterNames } from './written.ts';

/**
 * A `<svelte:boundary>` with a `failed` snippet, as a block: the children where nothing threw, the
 * snippet over the request's `transformError` of what did. See spec/ir.md, "A boundary that may
 * throw is a block of its own, lowered to an `if`".
 *
 * The children are walked as any markup is, components entered and blocks recorded, and what they
 * compute is guarded holes: the render written for the first branch evaluates none of them and
 * cannot throw, and so does every derivation. The test is the same values computed again inside
 * one catch per request, in the order the render computes them and under the same ifs and eaches,
 * which is the source of the error. The render for the second branch throws from inside the
 * children on purpose, at their end, and `failed` is walked with its parameter bound to the
 * transformed value.
 */
export function boundary(
	node: AstNode,
	kept: readonly unknown[],
	failed: AstNode,
	walk: Walk,
	fragment: unknown,
): void {
	const { blocks, edits, holes, source, stream, within } = walk;
	const index = blocks.length;
	const block: Block = {
		index,
		kind: 'boundary',
		stream,
		expression: '',
		tests: [],
		item: null,
		counter: null,
		alternate: true,
		within: [...within],
	};
	blocks.push(block);
	const whole = span(node);
	if (whole !== null) {
		const close = source.lastIndexOf('</svelte:boundary', whole[1]);
		chose(walk, edits, close, close, index, -1, `{(() => { throw globalThis.${THROWN}; })()}`, '');
		edits.push(stamped(walk, index, source, whole[1]));
	}
	const raw = new Map<string, string>();
	const guard = (text: string): string => {
		// A literal throws nothing, and it is what the walk folds a test or a value by.
		if (constant(text) || unwrapped(text) === 'undefined') return text;
		const guarded = awaiting(text)
			? `(await $$tried(async () => (${text})))`
			: `$$tried(() => (${text}))`;
		raw.set(guarded, text);
		return guarded;
	};
	// Every hole and block the children record, with the blocks enclosing it, in the order the walk
	// records them -- which is source order, entered components included. Read off the two lists as
	// they grow, since the children record into them from every one of their visitors.
	const steps: Step[] = [];
	const listen = <T extends Hole | Block>(list: T[], as: (one: T) => Step['at']): (() => void) => {
		const push = list.push.bind(list);
		list.push = (...items: T[]): number => {
			for (const one of items)
				steps.push({ at: as(one), within: within.slice(block.within?.length) });
			return push(...items);
		};
		return () => {
			list.push = push;
		};
	};
	const quiet = [
		listen(holes, (hole) => ({ hole })),
		listen(blocks, (inner) => ({ block: inner })),
	];
	within.push([index, 0]);
	try {
		held(
			kept,
			{
				...walk,
				trying: guard,
				holding: true,
				expand: (one, extra) => guard(walk.expand(one, extra)),
			},
			walk.standalone && isNode(fragment) ? onlyChild(fragment) : null,
		);
	} finally {
		within.pop();
		for (const one of quiet) one();
	}
	const unguarded = (text: string): string => {
		// Longest first: a guarded value inside another is part of the outer one's text until the
		// outer one is taken off.
		const keys = [...raw.keys()].toSorted((a, b) => b.length - a.length);
		for (let changed = true; changed;) {
			changed = false;
			for (const key of keys) {
				if (!text.includes(key)) continue;
				text = text.split(key).join(raw.get(key) ?? key);
				changed = true;
			}
		}
		return text;
	};
	const waits = raw.size > 0 && [...raw.values()].some(awaiting);
	const body = inOrder(steps, 1, unguarded, waits);
	if (body === null) {
		refuse(
			'a `<svelte:boundary>` with a `failed` snippet, whose body holds what computing its values ' +
				'in order cannot follow: an `{#await}`, a `<svelte:element>`, a component rendering ' +
				'itself or a boundary inside it. Whether the body throws is asked per request by running ' +
				'what it computes, which these are not written for. See spec/ir.md',
		);
	}
	const run = `${waits ? 'async ' : ''}() => { ${body} }`;
	const outcome = waits ? `(await $$caught(${run}, ${OPTIONS}))` : `$$caught(${run}, ${OPTIONS})`;
	const test = `!(${outcome}).threw`;
	block.expression = test;
	block.tests = [test, `(${outcome}).json`];
	const params = parameterNames(Array.isArray(failed['parameters']) ? failed['parameters'] : []);
	const bound = new Map([...params].map((name): [string, string] => [name, `(${outcome}).value`]));
	within.push([index, -1]);
	collect(failed['body'], {
		...walk,
		holding: true,
		dynamic: new Set([...walk.dynamic, ...params]),
		expand: (one, extra) => walk.expand(one, new Map([...bound, ...(extra ?? new Map())])),
	});
	within.pop();
}

/** A hole or a block a boundary's children recorded, and the blocks inside the boundary around it. */
interface Step {
	at: { hole: Hole } | { block: Block };
	within: [number, number][];
}

/**
 * What a boundary's children compute, as statements in the order the render computes it: a hole's
 * value, an if's tests choosing the branch whose values follow, an each's source iterated with its
 * body's values per item and its fallback where it is empty. Null for anything else, which is a
 * shape the render computes in an order of its own.
 */
function inOrder(
	steps: readonly Step[],
	depth: number,
	unguarded: (text: string) => string,
	/** Whether the run awaits, which makes a fragment's function async and each call an await. */
	waits: boolean,
	/** The fragments this run has defined so far, which a call inside it can call. */
	defined: Set<string> = new Set(),
): string | null {
	const out: string[] = [];
	const binding = (binds: readonly [string, string][]): string =>
		binds.map(([, value]) => unguarded(value)).join(', ');
	const entered = (name: string, binds: readonly [string, string][]): string =>
		`${waits ? 'await ' : ''}${name}(${binding(binds)});`;
	for (let at = 0; at < steps.length; at += 1) {
		const step = steps[at];
		if (step === undefined) continue;
		if (step.within.length !== depth) return null;
		if ('hole' in step.at) {
			const { hole } = step.at;
			if (hole.call !== undefined) {
				if (!defined.has(hole.call.fragment)) return null;
				out.push(entered(hole.call.fragment, hole.call.binds));
				continue;
			}
			// An id is the runtime's count and throws nothing.
			if (hole.fresh === true) continue;
			for (const one of [hole.expression, ...(hole.choice?.tests ?? [])]) {
				if (one !== '') out.push(`(${unguarded(one)});`);
			}
			continue;
		}
		const { block } = step.at;
		const inside: Step[] = [];
		while (steps[at + 1] !== undefined && (steps[at + 1]?.within.length ?? 0) > depth) {
			const next = steps[at + 1] as Step;
			if (next.within[depth]?.[0] !== block.index) return null;
			inside.push(next);
			at += 1;
		}
		const branch = (which: number): string | null =>
			inOrder(
				inside.filter((one) => one.within[depth]?.[1] === which),
				depth + 1,
				unguarded,
				waits,
				defined,
			);
		// A component entered as a fragment, which a call inside it may enter again: a function of
		// its parameters, called here with what this first call binds them to.
		if (block.fragment !== undefined && block.mirrors === undefined) {
			const { name, params, binds } = block.fragment;
			defined.add(name);
			const body = branch(0);
			if (body === null) return null;
			out.push(
				`const ${name} = ${waits ? 'async ' : ''}(${params.join(', ')}) => { ${body} }; ` +
					entered(name, binds),
			);
			continue;
		}
		if (block.kind === 'if' && block.mirrors === undefined && block.fragment === undefined) {
			const tests = block.tests ?? [block.expression];
			const arms: string[] = [];
			for (const [which, test] of tests.entries()) {
				const taken = branch(which);
				if (taken === null) return null;
				arms.push(`if (${unguarded(test)}) { ${taken} }`);
			}
			const otherwise = branch(-1);
			if (otherwise === null) return null;
			out.push(`${arms.join(' else ')} else { ${otherwise} }`);
			continue;
		}
		if (block.kind === 'each' && block.mirrors === undefined && block.item !== null) {
			const each = branch(0);
			const empty = branch(-1);
			if (each === null || empty === null) return null;
			// `ensure_array_like`: nothing for a falsy source, and the source itself or `Array.from` of
			// it otherwise, which iterate alike.
			const list = `$$list${String(block.index)}`;
			const counter = `$$at${String(block.index)}`;
			out.push(
				`{ const ${list} = Array.from((${unguarded(block.expression)}) || []); ` +
					`if (${list}.length === 0) { ${empty} } ` +
					`for (let ${counter} = 0; ${counter} < ${list}.length; ${counter} += 1) { ` +
					`const ${block.item} = ${list}[${counter}]; ` +
					`${block.counter == null ? '' : `const ${block.counter} = ${counter}; `}${each} } }`,
			);
			continue;
		}
		return null;
	}
	return out.join(' ');
}

/**
 * A `{@render}` of a raw snippet whose bytes the request decides, as a raw hole: the value is what
 * `createRawSnippet(fn)` pushes on the server, `fn(...getters).render().trim()`, and the render is
 * handed a snippet that pushes the marker instead, so the anchors Svelte writes around the tag are
 * its own. Only `render` goes into the hole: `setup` is the client's.
 *
 * What in `fn` reads nothing the request decides is a value the build's render computes, the way
 * any such value is -- a whole `render(Child).body` included, which is a string however it was
 * made. It is asked for and written back as the literal it answered, and what is left is data
 * computed per request. What still renders a component after that is a render the request decides,
 * which a derivation does not do, and is refused. See spec/derivation.md, "A value the request does
 * not decide is the build's, however it is computed".
 */
export function rawSnippet(call: unknown, name: string | null, walk: Walk): boolean {
	const { edits, expand, holes, site } = walk;
	if (!isNode(call) || call['type'] !== 'CallExpression') return false;
	const at = span(call);
	if (at === null) return false;
	const made = expressionIn(expand(call['callee']));
	if (made === null) return false;
	let maker = made.node;
	while (isNode(maker) && maker['type'] === 'ParenthesizedExpression') maker = maker['expression'];
	if (!isNode(maker) || maker['type'] !== 'CallExpression') return false;
	const callee = maker['callee'];
	const named = isNode(callee) && callee['type'] === 'Identifier' ? callee['name'] : undefined;
	const imported = typeof named === 'string' ? site.carried.get(named) : undefined;
	if (
		typeof named !== 'string' ||
		(imported === undefined
			? named !== 'createRawSnippet'
			: imported.from !== 'svelte' || imported.exported !== 'createRawSnippet')
	) {
		return false;
	}
	const [fn] = Array.isArray(maker['arguments']) ? maker['arguments'] : [];
	if (!isNode(fn)) return false;
	const text = made.text;
	const cut = (node: unknown): string => {
		const where = span(node);
		return where === null ? '' : text.slice(where[0] - made.offset, where[1] - made.offset);
	};

	// Every name a function inside `fn` binds, which a value read under it may read.
	const bound = new Set<string>();
	const binds = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const one of node) binds(one);
			return;
		}
		if (!isNode(node)) return;
		const type = node['type'];
		for (const param of Array.isArray(node['params']) ? node['params'] : [])
			namesBound(param, bound);
		if (type === 'VariableDeclarator') namesBound(node['id'], bound);
		if (type === 'CatchClause') namesBound(node['param'], bound);
		if ((type === 'FunctionDeclaration' || type === 'ClassDeclaration') && isNode(node['id'])) {
			namesBound(node['id'], bound);
		}
		for (const value of Object.values(node)) binds(value);
	};
	binds(fn);

	// Only `render`, where `fn` hands back an object written out: `setup` runs on the client.
	let body = fn['body'];
	while (isNode(body) && body['type'] === 'ParenthesizedExpression') body = body['expression'];
	const properties =
		isNode(body) && body['type'] === 'ObjectExpression' && Array.isArray(body['properties'])
			? body['properties']
			: null;
	const rendering = properties?.find(
		(one) => isNode(one) && isNode(one['key']) && one['key']['name'] === 'render',
	);
	const fnAt = span(fn);
	const whole = span(body);
	if (fnAt === null) return false;

	// The largest pieces that read nothing the request decides and nothing bound inside `fn`, each
	// asked of the render. A function is not one: its body runs when it is called, which may be never.
	let pending = false;
	const folds: [number, number, string][] = [];
	const FOLDED = new Set([
		'CallExpression',
		'NewExpression',
		'MemberExpression',
		'TaggedTemplateExpression',
		'TemplateLiteral',
		'BinaryExpression',
		'LogicalExpression',
		'ConditionalExpression',
	]);
	const visit = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const one of node) visit(one);
			return;
		}
		if (!isNode(node)) return;
		const type = node['type'];
		if (typeof type === 'string' && FOLDED.has(type)) {
			const piece = cut(node);
			let local = false;
			readsIn(node, new Set(), (read) => {
				if (typeof read['name'] === 'string' && bound.has(read['name'])) local = true;
			});
			if (piece !== '' && !local && !constant(piece) && !varies(piece, walk)) {
				const key = keyed(walk, piece);
				const told = site.told.get(key);
				const where = span(node);
				if (told !== undefined && where !== null) {
					folds.push([where[0], where[1], told]);
					return;
				}
				if (!site.mute.has(key)) {
					pending = true;
					if (!site.wants.some(([one]) => one === key)) {
						// Asked where a throw is an answer of its own: what Svelte evaluates only on one
						// branch is evaluated here whatever the branch, and nothing is folded from it.
						site.wants.push([
							key,
							`(() => { try { return (${piece}); } catch { return undefined; } })()`,
						]);
					}
					return;
				}
			}
		}
		for (const [key, value] of Object.entries(node)) {
			if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
			visit(value);
		}
	};
	visit(isNode(rendering) ? rendering : fn);

	// Written back from the last one, so every earlier position still holds.
	const withFolds = (from: number, to: number): string => {
		let out = text.slice(from - made.offset, to - made.offset);
		for (const [a, b, value] of folds.toSorted((x, y) => y[0] - x[0])) {
			if (a < from || b > to) continue;
			out = `${out.slice(0, a - from)}${value}${out.slice(b - from)}`;
		}
		return out;
	};
	const inner = isNode(rendering) ? span(rendering) : null;
	const written =
		inner !== null && whole !== null
			? `${text.slice(fnAt[0] - made.offset, whole[0] - made.offset)}({ ${withFolds(inner[0], inner[1])} })${text.slice(whole[1] - made.offset, fnAt[1] - made.offset)}`
			: withFolds(fnAt[0], fnAt[1]);

	// What still renders a component is a render the request decides.
	const rendersStill = [...site.carried.values()].some(
		(one) =>
			(one.from === 'svelte/server' || one.from.endsWith('.svelte')) &&
			mentions(written, new Set([one.local])),
	);
	if (rendersStill && !pending) {
		refuse(
			`\`{@render ${String(name)}()}\` in ${basename(site.file)} is a raw snippet whose function ` +
				'renders a component over what the request decides. What reads nothing the request ' +
				'decides is computed at the build, however it is made; a render that reads the request ' +
				'would have to run per request, and a derivation renders nothing. Hand the component ' +
				'nothing from the request, or write it as a `{#snippet}`. See spec/derivation.md',
		);
	}

	const args = Array.isArray(call['arguments']) ? call['arguments'] : [];
	const getters = args.map((one) => `() => (${expand(one)})`).join(', ');
	const index = holes.length;
	holes.push({ index, expression: `(${written})(${getters}).render().trim()`, raw: true });
	// Standing where the author's snippet stood, and as dynamic as it was: `RenderTag.js` calls a tag
	// dynamic unless its callee is a name bound the plain way, and a standalone tag that is not
	// dynamic writes no anchor after it. So a plain name gets a plain name, declared at the top of
	// the script, and anything else an expression.
	const pushing = `(r) => r.push(${JSON.stringify(sentinel(index))})`;
	const plain =
		isNode(call['callee']) &&
		call['callee']['type'] === 'Identifier' &&
		typeof call['callee']['name'] === 'string' &&
		walk.declares(call['callee']['name']) &&
		walk.runeOf(call['callee']['name']) === undefined &&
		!(site.payload?.has(call['callee']['name']) ?? false);
	if (plain) {
		const stand = `__seam_raw${String(index)}`;
		site.prelude.push(`const ${stand} = ${pushing};`);
		edits.push([at[0], at[1], `${stand}()`]);
	} else {
		edits.push([at[0], at[1], `(${pushing})()`]);
	}
	return true;
}
