/**
 * A route's IR and derivations, written as the one program that writes its bytes. See spec/ir.md,
 * "A route is one program".
 *
 * What a walk of the IR and an evaluator did per request, this decides once: every node becomes the statement
 * that writes it, every name an expression reads becomes what it means -- an each's item, the
 * payload, another derivation, a carried import, the request's `hydratable` -- and what the walk kept
 * as a scope stack becomes the program's own variables. The bytes are the ones the walk wrote, and
 * the suite holds the two together.
 */
import type { Node as IrNode } from '@seam-js/injector';
import { boundaryState, patched } from './boundary.ts';
import { derivationCode, orderedCode } from './derivations.ts';
import { type CarriedNames, type Env, json, type Structure } from './model.ts';
import { Program } from './state.ts';
import { fragments, openFrame, walk } from './walk.ts';

export type { CarriedName, CarriedNames, Derivation, Source, Structure } from './model.ts';

/** The pair `render()` writes around a root. */
const OPEN = '<!--[-->';
const CLOSE = '<!--]-->';

export function generate(structure: Structure, carried: CarriedNames): string {
	const p = new Program(structure, carried);
	const render: string[] = [
		`const $out = { ...$props };`,
		`$out["$$given"] = $props;`,
		`$out["$$options"] = $options;`,
		// The table Svelte's `hydratable` writes into, only where something calls it -- a derivation, or
		// a script run handed it: it is the one part of the runtime that serialises with what the host
		// provides.
		...(p.hydrating || p.derivations.some((one) => one.expression.includes('$$hydratable'))
			? [`const $tab = $rt.hydratables();`, `const $hyd = $tab.hydratable;`]
			: [`const $hyd = undefined;`]),
		`const $req = { page: $out["page"] };`,
		...boundaryState(p),
	];
	derivationCode(p, render);
	orderedCode(p, render);
	// What the walk counts across the whole response: the ids `$props.id()` hands out, and which
	// title wins. See the `title` node in the IR.
	render.push(`let $fresh = 1;`, `let $blk = 0;`, `let $ttl;`);

	const steps: string[] = [];
	const root = new Map<string, string>();
	openFrame(p, [p.ir.body, p.ir.head, p.ir.title, p.ir.styles ?? []], root, steps);
	steps.push(`let $body = '';`);
	// The pair held apart where the body opens and closes with it, so that a server writing into a
	// renderer of its own -- Kit's, which writes the pair itself -- takes the body without it rather
	// than cutting it off a page's length later.
	const body = [...p.ir.body];
	const paired = unpaired(body);
	const result = (rest: string): string =>
		paired
			? `$inject.bare === true ? { body: $body, head: $head${rest}, bare: true } : { body: ${json(OPEN)} + $body + ${json(CLOSE)}, head: $head${rest} }`
			: `{ body: $body, head: $head${rest} }`;
	const env: Env = { frames: [root], open: null };
	// The fragments first, so that each call knows what its fragment reads from its caller.
	const called: string[] = [];
	fragments(p, called);
	walk(p, body, env, '$body', steps);
	steps.push(`let $head = '';`);
	const head: Env = { ...env, head: true };
	walk(p, p.ir.head, head, '$head', steps);
	steps.push(`let $dec = '';`);
	walk(p, p.ir.title, head, '$dec', steps);
	steps.push(
		`$head += $dec !== '' ? $dec : $ttl === undefined ? '' : '<title>' + $ttl.text + '</title>';`,
	);
	walk(p, p.ir.styles ?? [], head, '$head', steps);
	steps.push(...patched(p));
	if (p.hydrating) {
		steps.push(
			`if ($tab.record.size > 0) {`,
			`const $made = yield $rt.script($tab.record, $inject.csp);`,
			`if ($made !== null) {`,
			`$head = $made.script + $head;`,
			`if ($made.hash !== undefined) return ${result(', hashes: { script: [$made.hash] }')};`,
			`}`,
			`}`,
		);
	}
	steps.push(`return ${result('')};`);
	// Inside a render of Svelte's own, as a component's script runs: what the bundle's copy of
	// Svelte's runtime asks of its context is answered as it is in a render. Entered again each time
	// the program resumes after waiting. See `rendering` in the carry package.
	const push = p.fileName(['*'], '$$push');
	const pop = p.fileName(['*'], '$$pop');
	const entered = (inner: string): string =>
		push === null || pop === null ? inner : `$rt.entered(${inner}, ${push}, ${pop})`;
	if (p.generator) {
		render.push(
			...called,
			`return $rt.drive(${entered(`(function* () {\nlet $t;\n${steps.join('\n')}\n})()`)});`,
		);
	} else {
		render.push(...called, ...steps);
	}
	if (push !== null && pop !== null) {
		render.unshift(`${push}();`, `try {`);
		render.push(`} finally { ${pop}(); }`);
	}
	return [
		`var __program = function ($rt, $files) {`,
		`const $U = $rt.UNSET;`,
		`const $S = ${json(p.derivations.map((one) => one.expression))};`,
		...p.module,
		`return function render($props, $options = {}, $inject = {}) {`,
		...render,
		`};`,
		`};`,
	].join('\n');
}

/** Whether the body opens and closes with the pair, which is then taken off its two ends. */
function unpaired(body: IrNode[]): boolean {
	const [first] = body;
	const last = body.at(-1);
	if (
		first?.t !== 'static' ||
		!first.s.startsWith(OPEN) ||
		last?.t !== 'static' ||
		!last.s.endsWith(CLOSE) ||
		(body.length === 1 && first.s.length < OPEN.length + CLOSE.length)
	) {
		return false;
	}
	body[0] = { t: 'static', s: first.s.slice(OPEN.length) };
	const end = body.at(-1) as { t: 'static'; s: string };
	body[body.length - 1] = { t: 'static', s: end.s.slice(0, end.s.length - CLOSE.length) };
	return true;
}
