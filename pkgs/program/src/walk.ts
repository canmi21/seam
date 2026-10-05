/**
 * The IR written as the statements that write it: a static run as a literal, a slot as its value
 * escaped, an if as an `if`, an each as a loop over what Svelte's `ensure_array_like` makes of its
 * source, and a call as a function of the fragment's parameters. See spec/ir.md.
 */
import type { Node as IrNode } from './ir.ts';
import { boundary, boundaryOf } from './boundary.ts';
import { type Env, json, local } from './model.ts';
import { rootRead } from './names.ts';
import type { Program } from './state.ts';

/** A value read by the walk, waited on where it is a derivation's promise and the program waits. */
export function value(p: Program, text: string): string {
	return p.generator ? `(($t = ${text}), $rt.waited($t) ? (yield $t) : $t)` : text;
}

function lookup(p: Program, env: Env, name: string): string | null {
	for (let at = env.frames.length - 1; at >= 0; at -= 1) {
		const found = env.frames[at]?.get(name);
		if (found !== undefined) return found;
	}
	if (env.open !== null && p.blockNames.has(name)) {
		env.open.add(name);
		return local(name);
	}
	return null;
}

/** A data path, as `resolve` read it: the head innermost first, then each member. */
export function path(p: Program, env: Env, at: string): string {
	const [head = '', ...rest] = at.split('.');
	let text = lookup(p, env, head);
	if (text === null) {
		const info = p.infos.get(head);
		if (info === undefined) text = `$out[${json(head)}]`;
		else if (info.kind === 'scoped') {
			const args = info.params.map((param) => lookup(p, env, param) ?? rootRead(p, param));
			text = `$s${String(info.index)}(${args.join(', ')})`;
		} else if (info.kind === 'lazy') text = `$d${String(info.index)}()`;
		else text = `$out[${json(head)}]`;
	}
	return rest.length === 0 ? text : `(${text})${rest.map((key) => `?.[${json(key)}]`).join('')}`;
}

/** Every `$props.id()` slot a frame binds, declared where the frame opens. */
function freshIn(p: Program, nodes: readonly IrNode[], into: Set<string>): void {
	for (const node of nodes) {
		if (node.t === 'slot' && node.fresh === true) into.add(node.path);
		else if (node.t === 'if') for (const branch of node.branches) freshIn(p, branch.body, into);
		else if (node.t === 'title') freshIn(p, node.body, into);
		else if (node.t === 'attr') freshIn(p, node.parts, into);
		else if (node.t === 'call' && node.shared === true) {
			freshIn(p, p.ir.fragments?.[node.fragment] ?? [], into);
		}
	}
}

export function openFrame(
	p: Program,
	nodes: readonly IrNode[][],
	frame: Map<string, string>,
	lines: string[],
): void {
	const fresh = new Set<string>();
	for (const one of nodes) freshIn(p, one, fresh);
	for (const name of fresh) {
		frame.set(name, local(name));
		lines.push(`let ${local(name)};`);
	}
}

export function walk(
	p: Program,
	nodes: readonly IrNode[],
	env: Env,
	out: string,
	lines: string[],
): void {
	let text = '';
	const flush = (): void => {
		if (text !== '') lines.push(`${out} += ${json(text)};`);
		text = '';
	};
	for (const node of nodes) {
		if (node.t === 'static') {
			text += node.s;
			continue;
		}
		flush();
		written(p, node, env, out, lines);
	}
	flush();
}

function escaped(text: string, mode: 'content' | 'attr' | false): string {
	return mode === 'content'
		? `$rt.ec(${text})`
		: mode === 'attr'
			? `$rt.ea(${text})`
			: `$rt.es(${text})`;
}

function written(p: Program, node: IrNode, env: Env, out: string, lines: string[]): void {
	switch (node.t) {
		case 'static':
			lines.push(`${out} += ${json(node.s)};`);
			return;
		case 'slot': {
			if (node.fresh === true) {
				const name = lookup(p, env, node.path) ?? local(node.path);
				lines.push(`${name} = "s" + String($fresh++);`, `${out} += ${escaped(name, node.escape)};`);
				return;
			}
			lines.push(`${out} += ${escaped(value(p, path(p, env, node.path)), node.escape)};`);
			return;
		}
		case 'title': {
			if (node.role === 'open') {
				lines.push('$blk += 1;');
				return;
			}
			const held = p.temp('$tt');
			lines.push(`{`, `let ${held} = '';`);
			walk(p, node.body, env, held, lines);
			const top = String(node.role === 'top');
			lines.push(
				`if ($ttl === undefined || $blk > $ttl.block || ($blk === $ttl.block && ${top} && !$ttl.top)) $ttl = { block: $blk, top: ${top}, text: ${held} };`,
				`}`,
			);
			return;
		}
		case 'call': {
			const fragment = fragmentName(node.fragment, node.shared === true);
			const needs = p.needs.get(fragment) ?? new Set<string>();
			p.needs.set(fragment, needs);
			const args: string[] = [];
			lines.push('{');
			for (const [, at] of node.binds) {
				const held = p.temp('$b');
				lines.push(`const ${held} = ${value(p, path(p, env, at))};`);
				args.push(held);
			}
			for (const name of [...needs].toSorted())
				args.push(lookup(p, env, name) ?? rootRead(p, name));
			lines.push(`${out} += ${p.generator ? 'yield* ' : ''}${fragment}(${args.join(', ')});`, '}');
			return;
		}
		case 'if': {
			const caught = boundaryOf(p, node);
			if (caught !== null) {
				boundary(p, node, caught, env, out, lines);
				return;
			}
			node.branches.forEach((branch, at) => {
				const keyword = at === 0 ? 'if' : 'else if';
				if (branch.test === null) lines.push(at === 0 ? '{' : 'else {');
				else lines.push(`${keyword} (${value(p, path(p, env, branch.test))}) {`);
				walk(p, branch.body, env, out, lines);
				lines.push('}');
			});
			return;
		}
		case 'attr':
			attribute(p, node, env, out, lines);
			return;
		case 'each': {
			const list = p.temp('$a');
			const at = p.temp('$i');
			lines.push(
				`{`,
				`const ${list} = $rt.arrayLike(${value(p, path(p, env, node.source))});`,
				`if (${list} !== null) for (let ${at} = 0; ${at} < ${list}.length; ${at} += 1) {`,
			);
			const frame = new Map<string, string>([[node.item, local(node.item)]]);
			lines.push(`const ${local(node.item)} = ${list}[${at}];`);
			if (node.index != null) {
				frame.set(node.index, local(node.index));
				lines.push(`const ${local(node.index)} = ${at};`);
			}
			openFrame(p, [node.body], frame, lines);
			walk(p, node.body, { ...env, frames: [...env.frames, frame] }, out, lines);
			lines.push('}', '}');
			return;
		}
	}
}

/**
 * An attribute as Svelte writes it: gone where the value is nothing, `name=""` or gone where it is
 * boolean, `translate`'s `yes` and `no`, and gone where `class` or `style` comes out empty.
 */
function attribute(
	p: Program,
	node: Extract<IrNode, { t: 'attr' }>,
	env: Env,
	out: string,
	lines: string[],
): void {
	const [only] = node.parts;
	const single = node.parts.length === 1 && only?.t === 'slot';
	const held = p.temp('$v');
	lines.push('{');
	if (single) {
		lines.push(`const ${held} = ${value(p, path(p, env, only.path))};`);
	} else {
		lines.push(`let ${held} = '';`);
		walk(p, node.parts, env, held, lines);
	}
	const name = node.name;
	const shownAs = (): string[] => {
		const shown = name === 'translate' && single ? `($rt.TRANSLATE.get(${held}) ?? ${held})` : held;
		const text = p.temp('$x');
		return [
			`const ${text} = ${single ? `$rt.ea(${shown})` : `String(${held})`};`,
			node.presence === 'nonempty'
				? `if (${text} !== '') ${out} += ${json(` ${name}="`)} + ${text} + '"';`
				: `${out} += ${json(` ${name}="`)} + ${text} + '"';`,
		];
	};
	lines.push(`if (${held} !== undefined && ${held} !== null) {`);
	if (node.presence === 'boolean') {
		const bare = [`if (${held} || ${held} === '') ${out} += ${json(` ${name}=""`)};`];
		if (name === 'hidden') {
			lines.push(`if (${held} === 'until-found') {`, ...shownAs(), `} else {`, ...bare, `}`);
		} else {
			lines.push(...bare);
		}
	} else {
		lines.push(...shownAs());
	}
	lines.push('}', '}');
}

function fragmentName(fragment: string, shared: boolean): string {
	return `$f_${fragment.replace(/[^\w$]/g, '_')}${shared ? '_shared' : ''}`;
}

/** Each fragment called, as a function of its parameters and of what it reads from its caller. */
export function fragments(p: Program, lines: string[]): void {
	const called = new Map<string, { fragment: string; shared: boolean; binds: readonly string[] }>();
	const collect = (nodes: readonly IrNode[]): void => {
		for (const node of nodes) {
			if (node.t === 'call') {
				const name = fragmentName(node.fragment, node.shared === true);
				if (!called.has(name)) {
					called.set(name, {
						fragment: node.fragment,
						shared: node.shared === true,
						binds: node.binds.map(([one]) => one),
					});
					collect(p.ir.fragments?.[node.fragment] ?? []);
				}
			} else if (node.t === 'if') for (const branch of node.branches) collect(branch.body);
			else if (node.t === 'each') collect(node.body);
			else if (node.t === 'title') collect(node.body);
			else if (node.t === 'attr') collect(node.parts);
		}
	};
	for (const nodes of [p.ir.body, p.ir.head, p.ir.title, p.ir.styles ?? []]) collect(nodes);
	// What each reads from its caller grows as the bodies are written, a call inside one adding what
	// the called one reads; written again until nothing grows.
	let out: string[] = [];
	const state = (): string => JSON.stringify([...p.needs].map(([k, v]) => [k, [...v].toSorted()]));
	for (let round = 0; round < 50; round += 1) {
		const before = state();
		out = [];
		for (const [name, one] of called) {
			const body = p.ir.fragments?.[one.fragment];
			if (body === undefined)
				throw new Error(`a call of a fragment the IR does not hold: ${one.fragment}`);
			const needs = p.needs.get(name) ?? new Set<string>();
			p.needs.set(name, needs);
			const frame = new Map<string, string>(one.binds.map((bind) => [bind, local(bind)]));
			const inner: string[] = [];
			// A shared node takes no frame: what it binds lands where it was written.
			if (one.shared) {
				const fresh = new Set<string>();
				freshIn(p, body, fresh);
				if (fresh.size > 0)
					throw new Error(`a shared fragment binding an id is not written: ${one.fragment}`);
			} else {
				openFrame(p, [body], frame, inner);
			}
			const open = new Set(needs);
			walk(p, body, { frames: [frame], open }, '$o', inner);
			for (const need of open) needs.add(need);
			const params = [...one.binds.map(local), ...[...needs].toSorted().map(local)];
			out.push(
				`function${p.generator ? '*' : ''} ${name}(${params.join(', ')}) {`,
				`let $o = '';`,
				...(p.generator ? ['let $t;'] : []),
				...inner,
				`return $o;`,
				`}`,
			);
		}
		if (state() === before) break;
	}
	lines.push(...out);
}
