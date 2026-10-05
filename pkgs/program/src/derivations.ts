/**
 * Each derivation as the program computes it: one computed once a request when first read, one per
 * item as a function of what the item binds, a prop's default and a `hydratable` call in the order
 * the script makes them. See spec/derivation.md.
 */
import { type Context, guarded, type Info, json, local, textKey } from './model.ts';
import { derivationRead, expression, kindAt, written } from './names.ts';
import type { Program } from './state.ts';

/** The once-a-request and per-item derivations, as functions the walk and each other call. */
export function derivationCode(p: Program, lines: string[]): void {
	for (const info of p.infos.values()) {
		const i = String(info.index);
		if (info.kind === 'lazy') {
			const computing = computingOf(p, info, {
				chain: info.derivation.files ?? [],
				marked: info.marked,
			});
			lines.push(
				`let $v${i} = $U;`,
				`function $d${i}() {`,
				`if ($v${i} !== $U) return $v${i};`,
				`let $h;`,
				computing,
				`$v${i} = $h;`,
				...(info.asynchronous
					? [
							`if ($rt.thenable($h)) $v${i} = $rt.waiting(Promise.resolve($h).then(($x) => ($v${i} = $x)));`,
						]
					: []),
				`return $v${i};`,
				`}`,
			);
			continue;
		}
		if (info.kind === 'scoped') {
			const computing = computingOf(p, info, {
				chain: info.derivation.files ?? [],
				marked: info.marked,
				params: new Set<string>(),
			});
			const args = info.params.map(local);
			const memo = info.memo ? memoOf(i, args) : null;
			if (memo !== null) lines.push(...memo.declare);
			lines.push(
				`function $s${i}(${args.join(', ')}) {`,
				...(memo === null ? [] : memo.recall),
				`let $h;`,
				computing,
				...(memo === null ? [] : memo.keep),
				`return $h;`,
				`}`,
			);
		}
	}
}

/**
 * The statement computing a derivation into `$h`. A guard with no key over a value is written as
 * the catch it is, rather than as a function made and called per read: a page under Kit's root reads
 * one per value it writes. Inside a boundary's `try` it lets the throw through, for the `try` to
 * catch. See `tried` in the skeleton package.
 */
function computingOf(p: Program, info: Info, given: Context): string {
	const i = String(info.index);
	const reads = { seen: new Map<string, string>(), declared: [] as string[] };
	const context: Context = info.asynchronous ? given : { ...given, reads };
	const guard = info.asynchronous ? null : guardOf(p, info, context);
	if (guard !== null) {
		return `${reads.declared.join(' ')} if ($depth > 0) { $h = ${guard}; } else try { $h = ${guard}; if ($rt.thenable($h)) $h = Promise.resolve($h).catch(() => undefined); } catch { $h = undefined; }`;
	}
	const value = evaluated(p, info, context);
	return `${reads.declared.join(' ')} try { $h = ${failing(info, value)}; } catch ($e) { throw new $rt.DerivationFailed($S[${i}], $e); }`;
}

/** The value a derivation that is a whole keyless guard guards, written; null for any other. */
function guardOf(p: Program, info: Info, context: Context): string | null {
	const guard = guarded(info.derivation);
	// The helper the bundle carries, not a name of the author's.
	if (guard === null || p.fileName(context.chain, '$$tried') !== null) return null;
	const { source, inner } = guard;
	const found = p.byText.get(
		`${kindAt(context)}\u0002${textKey(context.chain, source.slice(inner.start, inner.end)) ?? ''}`,
	);
	if (found !== undefined && found !== info) return derivationRead(p, context, found, new Set());
	return `(${written(p, context, source, inner, new Set())})`;
}

/** The value, with a rejection naming the derivation where it is one that waits. */
function failing(info: Info, value: string): string {
	return info.asynchronous ? `$rt.failing(${value}, $S[${String(info.index)}], true)` : value;
}

/**
 * A per-item value kept by what it is called with, where one of those is an object -- an item, by
 * its identity: two items equal as values are still two items, and Svelte computes a `{@const}` once
 * for each. The last arguments and their value first: a page reads one item's values one after
 * another, so most reads are of the item just read, and comparing is cheaper than looking up. An
 * object is kept by its arguments for as long as the request lasts, since it is one object for each
 * item whoever reads it and when; a value that is not one reads the same computed again, and is kept
 * only as the last. One map a parameter, nested, so a read allocates nothing.
 */
function memoOf(
	i: string,
	args: readonly string[],
): { declare: string[]; recall: string[]; keep: string[] } {
	const object = (one: string): string =>
		`((typeof ${one} === 'object' && ${one} !== null) || typeof ${one} === 'function')`;
	const last = args.map((_, at) => `$l${i}_${String(at)}`);
	const same = args.map((arg, at) => `${arg} === ${last[at] ?? ''}`).join(' && ');
	const remember = (value: string): string =>
		`${args.map((arg, at) => `${last[at] ?? ''} = ${arg};`).join(' ')} $lv${i} = ${value}; $lf${i} = true;`;
	const recall = [
		`const $o = ${args.map(object).join(' || ')};`,
		`if ($o && $lf${i} && ${same}) return $lv${i};`,
		`let $n = $m${i}.size === 0 ? undefined : $m${i};`,
	];
	const keep = [
		`if ($o) {`,
		remember('$h'),
		`if ((typeof $h === 'object' && $h !== null) || typeof $h === 'function') {`,
		`let $p = $m${i};`,
	];
	for (const [at, arg] of args.entries()) {
		if (at === args.length - 1) {
			recall.push(
				`if ($o && $n !== undefined && $n.has(${arg})) { const $hit = $n.get(${arg}); ${remember('$hit')} return $hit; }`,
			);
			keep.push(`$p.set(${arg}, $h);`);
		} else {
			recall.push(`if ($n !== undefined) $n = $n.get(${arg});`);
			keep.push(
				`{ let $q = $p.get(${arg}); if ($q === undefined) { $q = new Map(); $p.set(${arg}, $q); } $p = $q; }`,
			);
		}
	}
	keep.push('}', '}');
	return {
		declare: [`const $m${i} = new Map();`, `let ${last.join(', ')}, $lv${i}, $lf${i} = false;`],
		recall,
		keep,
	};
}

/** The order a prop's default and a `hydratable` call are made in: the list's. */
export function orderedCode(p: Program, lines: string[]): void {
	for (const info of p.infos.values()) {
		const i = String(info.index);
		const name = json(info.derivation.name);
		const context: Context = { chain: info.derivation.files ?? [], marked: info.marked };
		if (info.kind === 'prop') {
			// A prop with no default holds nothing and has nothing to compute.
			if (info.derivation.expression === 'undefined') continue;
			lines.push(
				`if ($out[${name}] === undefined) {`,
				`let $h;`,
				`try { $h = ${evaluated(p, info, context)}; } catch ($e) { throw new $rt.DerivationFailed($S[${i}], $e); }`,
				info.asynchronous
					? `$out[${name}] = $rt.thenable($h) ? $rt.waiting(Promise.resolve($h).then(($x) => ($out[${name}] = $x))) : $h;`
					: `$out[${name}] = $h;`,
				`}`,
			);
		} else if (info.kind === 'eager') {
			lines.push(
				`try { $out[${name}] = ${failing(info, evaluated(p, info, context))}; } catch ($e) { throw new $rt.DerivationFailed($S[${i}], $e); }`,
			);
		}
	}
}

/**
 * The expression as a value, built `async` where it awaits or reads what does: what it awaits is
 * waited on first, so it reads their values rather than their promises.
 */
function evaluated(p: Program, info: Info, context: Context): string {
	if (!info.asynchronous) return `(${expression(p, info, context)})`;
	const sites = new Map<string, string>();
	const first: string[] = [];
	for (const name of info.awaited) {
		const other = p.infos.get(name);
		if (other === undefined) continue;
		const read = derivationRead(p, context, other, new Set());
		const held = `$w${String(first.length)}`;
		first.push(read);
		if (other.kind === 'scoped') sites.set(read, held);
	}
	const body = expression(p, info, { ...context, awaitedSites: sites });
	const waited =
		first.length === 0
			? ''
			: `const [${first.map((_, at) => `$w${String(at)}`).join(', ')}] = await Promise.all([${first.join(', ')}]); `;
	return `(async () => { ${waited}return (${body}); })()`;
}
