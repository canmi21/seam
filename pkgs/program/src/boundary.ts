/**
 * A `<svelte:boundary>` as `renderer.boundary` renders one: a `try`. See spec/ir.md, "A boundary is a
 * `try`".
 */
import type { Node as IrNode } from '@seam-js/injector';
import { parsedExpression, type Node } from './rewrite.ts';
import { type Env, json, metaFree, unwrapped } from './model.ts';
import { own } from './names.ts';
import type { Program } from './state.ts';
import { path, value, walk } from './walk.ts';

type If = Extract<IrNode, { t: 'if' }>;

/**
 * A boundary as the lowering writes it: an `if` whose test is `!($$caught(...)).threw` and whose
 * other branch is the `failed` snippet. The key the run would have kept its outcome under, or null
 * for one computed per item. Null for any other `if`.
 */
export function boundaryOf(p: Program, node: If): { test: string; key: string | null } | null {
	const [children, otherwise] = node.branches;
	if (node.branches.length !== 2 || children?.test == null || otherwise?.test !== null) return null;
	const info = p.infos.get(children.test);
	if (info === undefined || (info.kind !== 'lazy' && info.kind !== 'scoped')) return null;
	let tree: Node;
	try {
		tree = unwrapped(parsedExpression(metaFree(info.derivation.expression)));
	} catch {
		return null;
	}
	if (tree.type !== 'UnaryExpression' || tree['operator'] !== '!') return null;
	const member = unwrapped(tree['argument'] as Node);
	if (member.type !== 'MemberExpression' || (member['property'] as Node)['name'] !== 'threw') {
		return null;
	}
	let call = unwrapped(member['object'] as Node);
	if (call.type === 'AwaitExpression') call = unwrapped(call['argument'] as Node);
	const callee = call['callee'] as Node | undefined;
	const key = (call['arguments'] as Node[] | undefined)?.[1];
	if (
		call.type !== 'CallExpression' ||
		callee?.type !== 'Identifier' ||
		callee['name'] !== '$$caught' ||
		key?.type !== 'Literal' ||
		(typeof key['value'] !== 'string' && key['value'] !== null) ||
		own(p, '$$caught') === null
	) {
		return null;
	}
	return { test: children.test, key: key['value'] as string | null };
}

/**
 * The children into a buffer of their own inside a `try`, kept where nothing threw, and otherwise the
 * request's `transformError` of what did and the `failed` snippet over it. What it came to is
 * recorded, which the head stream's half of the same boundary reads -- and where only that half
 * throws, the body's half is written again as the snippet.
 */
export function boundary(
	p: Program,
	node: If,
	caught: { test: string; key: string | null },
	env: Env,
	out: string,
	lines: string[],
): void {
	const [children, otherwise] = node.branches as [
		{ test: string; body: IrNode[] },
		{ test: null; body: IrNode[] },
	];
	const key = json(caught.key);
	const test = json(caught.test);
	const buffer = p.temp('$r');
	const threw = p.temp('$x');
	const error = p.temp('$e');
	const outcome = p.temp('$oc');
	const settle = p.generator
		? `if ($rt.thenable(${outcome})) ${outcome} = yield ${outcome};`
		: `if ($rt.thenable(${outcome})) throw new Error('a \`transformError\` returned a promise in a render that waits on nothing');`;
	const failedInto = (into: string, from: string[]): void => {
		from.push(`$stack.push({ key: ${key}, outcome: ${outcome} });`, `try {`);
		walk(p, otherwise.body, env, into, from);
		from.push(`} finally { $stack.pop(); }`);
	};
	const tried = (): void => {
		lines.push(
			`let ${buffer} = '';`,
			`let ${threw} = false;`,
			`let ${error};`,
			`$depth += 1;`,
			`try {`,
		);
		walk(p, children.body, env, buffer, lines);
		lines.push(
			`} catch ($thrown) { ${threw} = true; ${error} = $thrown; } finally { $depth -= 1; }`,
		);
	};
	lines.push('{');
	if (env.head !== true) {
		tried();
		const start = p.temp('$st');
		lines.push(
			`if (!${threw}) {`,
			`const ${start} = ${out}.length;`,
			`${out} += ${buffer};`,
			`$record(${key}, ${test}, $rt.SUCCEEDED);`,
		);
		if (caught.key !== null && out === '$body') {
			// What the snippet writes here, kept for a head that throws where this half did not.
			const later: string[] = [
				`$segments.set(${key}, { start: ${start}, end: ${out}.length, failed: function${p.generator ? '*' : ''} (${outcome}) {`,
				`let $o = '';`,
				...(p.generator ? ['let $t;'] : []),
			];
			failedInto('$o', later);
			later.push(`return $o;`, `} });`);
			lines.push(...later);
		}
		lines.push(
			`} else {`,
			`let ${outcome} = $rt.failed(${error}, $options);`,
			settle,
			`$record(${key}, ${test}, ${outcome});`,
		);
		failedInto(out, lines);
		lines.push(`}`, `}`);
		return;
	}
	const recorded = p.temp('$m');
	lines.push(`const ${recorded} = $recorded(${key}, ${test});`, `if (${recorded} === undefined) {`);
	// No body half recorded what it came to: the boundary is read as its run reads it.
	for (const branch of node.branches) {
		if (branch.test === null) lines.push('else {');
		else lines.push(`if (${value(p, path(p, env, branch.test))}) {`);
		walk(p, branch.body, env, out, lines);
		lines.push('}');
	}
	lines.push(`} else if (${recorded}.threw === false) {`);
	const block = p.temp('$bk');
	const title = p.temp('$tl');
	lines.push(`const ${block} = $blk;`, `const ${title} = $ttl;`);
	tried();
	lines.push(
		`if (!${threw}) ${out} += ${buffer};`,
		`else {`,
		`$blk = ${block};`,
		`$ttl = ${title};`,
		`let ${outcome} = $rt.failed(${error}, $options);`,
		settle,
		caught.key === null
			? `throw ${error};`
			: `$regions.set(${key}, ${outcome}); $patches.push({ key: ${key}, outcome: ${outcome} });`,
	);
	failedInto(out, lines);
	lines.push(`}`, `} else {`, `const ${outcome} = ${recorded};`);
	failedInto(out, lines);
	lines.push(`}`, `}`);
}

/**
 * What the program keeps of its boundaries, ahead of anything that reads one: what each came to, by
 * the key a run would have kept it under or in order for one per item; the ones being written,
 * innermost last; what a throwing head writes again; and the helpers a derivation reads them by.
 */
export function boundaryState(p: Program): string[] {
	const lines = [
		`let $depth = 0;`,
		`const $regions = new Map();`,
		`const $queues = new Map();`,
		`const $stack = [];`,
		`const $segments = new Map();`,
		`const $patches = [];`,
		`function $record($k, $test, $oc) { if ($k !== null) { $regions.set($k, $oc); return; } let $q = $queues.get($test); if ($q === undefined) { $q = []; $queues.set($test, $q); } $q.push($oc); }`,
		`function $recorded($k, $test) { if ($k !== null) return $regions.get($k); return $queues.get($test)?.shift(); }`,
	];
	const caughtHelper = p.fileName(['*'], '$$caught');
	if (caughtHelper !== null) {
		lines.push(
			`function $caughtNow($q, $k, $run, $opts) { for (let $i = $stack.length - 1; $i >= 0; $i -= 1) if ($stack[$i].key === $k) return $stack[$i].outcome; if ($k !== null && $regions.has($k)) return $regions.get($k); return ${caughtHelper}($q, $k, $run, $opts); }`,
		);
	}
	const triedHelper = p.fileName(['*'], '$$tried');
	if (triedHelper !== null) {
		lines.push(
			`function $triedNow($q, $k, $run) { return $depth > 0 ? $run() : ${triedHelper}($q, $k, $run); }`,
		);
	}
	return lines;
}

/**
 * A body half written again where only its head half threw, last first so each one's place still
 * stands; one inside another that is written again goes with it.
 */
export function patched(p: Program): string[] {
	return [
		`if ($patches.length > 0) {`,
		`const $ps = $patches.map(($p) => ({ ...$segments.get($p.key), outcome: $p.outcome })).filter(($p) => $p.start !== undefined).sort(($a, $b) => $b.start - $a.start);`,
		`let $floor = Infinity;`,
		`for (const $p of $ps) {`,
		`if ($p.end > $floor) continue;`,
		`const $text = ${p.generator ? 'yield* ' : ''}$p.failed($p.outcome);`,
		`$body = $body.slice(0, $p.start) + $text + $body.slice($p.end);`,
		`$floor = $p.start;`,
		`}`,
		`}`,
	];
}
