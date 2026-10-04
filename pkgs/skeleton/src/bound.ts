/**
 * What a child is bound to at a call site, and what its script runs: each declared prop's value
 * or hold, the child's declarations read over them, and the run that answers what the script
 * changes. See spec/derivation.md, "Where substitution cannot follow, the script runs as Svelte
 * compiled it".
 */
/**
 * Entering a child component at a call site: what the tag passes, what the child's script
 * declares and changes, what a binding sends back, and the copy the child is walked as. See
 * spec/derivation.md.
 */
import { basename, relative } from 'node:path';
import { locals, projectAsync, RUN_NAME, STATE_ON_SERVER, stateImports } from '@seam-js/ast';
import { propsOf, rebased } from './compose.ts';
import { type AstNode, refuse } from './node.ts';
import { callSite, REST, settleBindings } from './call-site.ts';
import { HYDRATABLE, HYDRATABLE_RUN, varies } from './dynamic.ts';
import { type Walk, changedKey } from './walk-types.ts';
import { exportedBy, holding, keptUnder } from './written.ts';

type Declares = NonNullable<ReturnType<typeof propsOf>>;
type Site = NonNullable<ReturnType<typeof callSite>>;

/** The object the call site passed, as `$$props` is inside the child. See `descend`. */
export interface Passing {
	object: string;
	slots: string[];
}

/** What each declared prop of the child is bound to, and what is held where it makes something. */
export function bindDeclared(
	walk: Walk,
	ahead: AstNode,
	declares: Declares,
	bindings: Site['bindings'],
	byName: Site['byName'],
	passing: Passing,
	recursion: string | null,
): {
	held: ReadonlyMap<string, string>;
	params: string[];
	bound: Map<string, string>;
	named: Set<string>;
	plain: Map<string, string>;
	before: number;
} {
	const held =
		recursion === null ? rebased(walk.site.fixed, declares, bindings) : new Map<string, string>();
	const params = declares.map((one) => one.local);
	const bound = new Map<string, string>();
	const named = new Set(
		declares.filter((one) => one.rest !== true && one.whole !== true).map((one) => one.prop),
	);
	/**
	 * What each held prop is bound to when the hold is given up, and where the list stood first.
	 *
	 * A hold is a reference this compiler resolves, and the child's **script** is handed to
	 * Svelte to evaluate. Where a declaration in that script reaches one, the reference would be
	 * written into source Svelte parses -- "`$$hold` is an illegal variable name" -- so the props
	 * are bound to their values instead and the identity this would have kept is given up. Only
	 * the script: a markup read is a hole, and a hole is an expression this compiler evaluates.
	 */
	const plain = new Map<string, string>();
	const before = walk.keeping.length;
	for (const one of declares) {
		if (recursion !== null) {
			bound.set(one.local, one.local);
			continue;
		}
		// `let props = $props()` binds the object itself, which is the one `$$props` is bound to.
		if (one.whole === true) {
			bound.set(one.local, `(${passing.object})`);
			continue;
		}
		if (one.rest === true) {
			// What `$props()` leaves in a rest: every attribute the caller wrote that the pattern
			// did not name, as an object of the caller's own expressions. Where a spread's keys
			// are the request's, `merged()` bound the rest already.
			const whole = bindings.get(REST);
			if (whole !== undefined) {
				bound.set(one.local, whole);
				continue;
			}
			const others = [...bindings]
				.filter(([prop]) => !named.has(prop))
				.map(([prop, value]) => `${JSON.stringify(prop)}: ${value}`);
			bound.set(one.local, `({ ${others.join(', ')} })`);
			continue;
		}
		// A default is JavaScript's, taken when the value is `undefined` and only then -- a prop
		// the caller passes as `undefined` takes it as much as one the caller leaves out.
		const given = bindings.get(one.prop);
		const value =
			given === undefined
				? one.fallback
				: one.fallback === 'undefined'
					? given
					: `(${given} === undefined ? (${one.fallback}) : ${given})`;
		// A value that **makes** something is held at the call site, which is where its identity
		// belongs: the caller evaluates it once and hands the child that one value, so two reads
		// inside the child must not build two. Recorded under the caller's own chain rather than
		// this child's, which is what makes the caller's reads of the same text and the child's
		// land on one derivation. See spec/derivation.md.
		const kept = holding(one.prop, given, byName, walk);
		if (kept !== null) plain.set(one.local, value);
		bound.set(one.local, kept ?? value);
	}
	// What the child imports from Kit's `$app/state`, bound the way its server module reads it:
	// `page` is the request's one object, which the root takes as its prop of that name, so the
	// child's `page` is the root's whichever level this is; the other two hold what a server
	// holds while it writes. Nothing is carried from the module. See spec/framework.md.
	for (const [local, exported] of stateImports(ahead['instance'])) {
		bound.set(local, exported === 'page' ? 'page' : (STATE_ON_SERVER[exported] ?? local));
	}
	return { held, params, bound, named, plain, before };
}

/** The child's declarations, read with what each prop is bound to. */
export function declaredFor(
	walk: Walk,
	file: string,
	ahead: AstNode,
	raw: string,
	declares: Declares,
	passing: Passing,
	fresh: string | null,
	recursion: string | null,
	{ held, params, bound, plain, before }: ReturnType<typeof bindDeclared>,
): { declared: ReturnType<typeof locals>; inside: ReadonlySet<string> } {
	// The child's declarations, with what each prop is bound to, so that one reading a prop the
	// caller gave a constant is left for the render to evaluate rather than neutralised.
	const inside = recursion === null ? walk.dynamic : new Set([...walk.dynamic, ...params]);
	let declared = locals(
		raw,
		held,
		fresh,
		bound,
		inside,
		// Not the sixth: that names props the payload carries, which is the entry's shape. A
		// child's are bound at its call site and arrive as `bound`, and naming them here stopped
		// them being recorded as declarations at all.
		undefined,
		// The list `rest_props` leaves out, in the order `transform-server.js` builds it: the
		// readonly exports first, then the bindable props. `export function b() {}` is one of the
		// first, and leaving it out put `b` in `$$restProps` where Svelte has three keys and we
		// wrote four.
		[
			...exportedBy(ahead),
			...declares.filter((one) => one.rest !== true && one.whole !== true).map((one) => one.prop),
		],
		passing,
		walk.keeping,
		// The copy's script runs as Svelte compiled it where a read cannot be substituted. See
		// `ranBy` below.
		'run',
	);
	for (const [name, why] of declared.changed) {
		walk.site.changing.set(changedKey(relative(walk.site.root, file), name), why);
	}
	// A hold the child's script reaches is given up, and every hold of this call goes with it:
	// the list is indexed, so dropping one and keeping another would need the indices renumbered
	// for the sake of a distinction nothing here measures.
	if (plain.size > 0 && declared.reading.some(([, empty]) => empty.includes('$$hold('))) {
		for (const [local, value] of plain) bound.set(local, value);
		walk.keeping.length = before;
		declared = locals(
			raw,
			held,
			fresh,
			bound,
			inside,
			undefined,
			[
				...exportedBy(ahead),
				...declares.filter((one) => one.rest !== true && one.whole !== true).map((one) => one.prop),
			],
			passing,
			walk.keeping,
			'run',
		);
	}
	return { declared, inside };
}

/** The script run the copy's changed names read, and what a bound prop sends back up. */
export function scriptRun(
	walk: Walk,
	file: string,
	raw: string,
	declares: Declares,
	declared: ReturnType<typeof locals>,
	site: Site,
	settles: ReturnType<typeof settleBindings>['settles'],
): Map<string, string> {
	const { bindings, order, delayed, unsettled, boundProps, boundTo } = site;
	// What the copy's own statements change is answered by its script run, per call site: the
	// props are what the call site passes, in the caller's terms, and the reads become fields of
	// the run -- over the prop's own binding, since a prop the script changes
	// holds what the script left. See `ran()` in skeleton.ts, and spec/derivation.md, "Where
	// substitution cannot follow, the script runs as Svelte compiled it".
	const ranBy = new Map<string, string>();
	const running = [...declared.changed]
		.filter(([, why]) => !why.includes('changed by a function this render calls'))
		.map(([name]) => name);
	// What a function the markup calls changes while the bytes are written is not in any run,
	// and a copy's reads are always written out, so it stays refused as it always was.
	const during = [...declared.changed].find(([name]) => !running.includes(name));
	if (during !== undefined) throw new Error(during[1]);
	if (running.length > 0) {
		// One case the run is not the answer for, and it keeps the refusal it had: where nothing
		// the call site passes varies with the request, the child is Svelte's to render -- the
		// render is handed the values themselves, and a caller's local a run would read is in no
		// scope a derivation has. See `handsMarker`. A prop the call site binds is the other
		// half of a run, below.
		const varying =
			walk.site.payload !== null &&
			([...bindings.values()].some((value) => varies(value, walk)) ||
				order.some((one) => 'spread' in one && varies(one.spread, walk)));
		const [first] = running;
		if (!varying) {
			if (process.env['SEAM_TRACE'] !== undefined) {
				console.error(
					`[seam] ${basename(file)}: no script run, nothing the call site passes varies: ` +
						[...bindings.entries()].map(([name, value]) => `${name}=${value}`).join(', '),
				);
			}
			throw new Error(declared.changed.get(first ?? '') ?? 'a name the script changes');
		}
		if (HYDRATABLE.test(raw)) refuse(HYDRATABLE_RUN);
		const passed = [
			...order.map((one) =>
				'spread' in one
					? `...${one.spread}`
					: `${JSON.stringify(one.name)}: ${bindings.get(one.name) ?? 'undefined'}`,
			),
			...delayed.map(([name, value]) => `${JSON.stringify(name)}: ${value}`),
		];
		// Written at each read rather than held: the props may read a name a block binds -- a child
		// in an each is run once per item -- and a held value is one per request. The run is a
		// pure function of them, so a second read runs it again to the same answer.
		const call = `${RUN_NAME}({ ${passed.join(', ')} }, undefined, $$request)`;
		const run = projectAsync() ? `(await ${call})` : call;
		for (const name of running) {
			ranBy.set(name, `(${run}.${name})`);
			ranBy.set(`$${name}`, `(${run}.$${name})`);
			// Answered by the run, so no longer a name substitution cannot follow: every read of
			// it in this file is a field of the run from here on, and a bare `error` left in an
			// expression is the caller's -- the root's prop of that name, handed down.
			walk.site.changing.delete(changedKey(relative(walk.site.root, file), name));
		}
		// A prop the call site binds that the script changes sends what the script left back up,
		// where the caller passed `undefined`, and the caller's template renders again reading
		// it. What it sends is the run of the loop's first pass -- the getters expanded with
		// nothing settled -- held under this child's chain and read by the caller's ternary as
		// `($$hold(n).name)`; the reads above are the second pass, whose props carry the settled
		// names. See spec/derivation.md, "A hold may name the child's chain, and that is how a
		// value crosses back up".
		const sending = running.filter((name) => {
			const prop = declares.find((one) => one.local === name)?.prop;
			return prop !== undefined && boundProps.has(prop);
		});
		if (sending.length > 0) {
			// The bound prop's getter with nothing settled wherever it is passed -- a binding is
			// also listed in `order` -- since a settled getter reads this very hold.
			const firstPassed = [
				...order.map((one) =>
					'spread' in one
						? `...${one.spread}`
						: `${JSON.stringify(one.name)}: ${unsettled.get(one.name) ?? bindings.get(one.name) ?? 'undefined'}`,
				),
				...delayed.map(
					([name, value]) => `${JSON.stringify(name)}: ${unsettled.get(name) ?? value}`,
				),
			];
			const firstCall = `${RUN_NAME}({ ${firstPassed.join(', ')} })`;
			const firstRun = projectAsync() ? `(await ${firstCall})` : firstCall;
			const at = keptUnder(firstRun, [...walk.site.stack, file], walk);
			for (const name of sending) {
				const prop = declares.find((one) => one.local === name)?.prop ?? name;
				if (walk.sent.has(boundTo.get(prop) ?? prop)) continue;
				if (settles(prop, `($$hold(${String(at)}).${name})`)) continue;
				throw new Error(
					`\`${name}\` is a prop this component changes and the call site binds, so what ` +
						'the script leaves goes back up to the caller, and the block this tag sits in ' +
						'is one the walk cannot put a test to. Compute the value in one expression, ' +
						'or move what changes it out of the render. See spec/derivation.md',
				);
			}
		}
	}
	return ranBy;
}
