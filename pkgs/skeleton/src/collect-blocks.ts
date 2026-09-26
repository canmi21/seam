/**
 * The walk into an if, an each and an await: the blocks a request decides, each branch walked,
 * and what the render is asked where it can answer. Cases of `collect()` in collect.ts. See
 * spec/pipeline.md.
 */
import { bound as namesBound, constant, type Locals } from 'ast';
import { elseIf, isNode, span } from './node.ts';
import { headOpensWith } from './sentinel.ts';
import { awaiting, awaitsAtTop, blockedRead, waitsOn } from './awaits.ts';
import {
	buried,
	chose,
	constantly,
	keyed,
	oneBranch,
	reached,
	rewrapped,
	sentFor,
	settled,
	spanOfFragment,
} from './branches.ts';
import { IDENTIFIER, unwrapped } from './components.ts';
import { varies } from './dynamic.ts';
import { neutralise, takenApart } from './selection.ts';
import { afterElse, afterTag, mirrored, stamped } from './stamps.ts';
import { asWritten, kept } from './written.ts';
import type { AstNode } from './node.ts';
import type { Walk } from './walk-types.ts';
import { collect, type Stepper } from './collect.ts';

export function collectAwait(node: AstNode, walk: Walk, step: Stepper): void {
	const { blocks, edits, expand, site, source, stream, within } = walk;
	// What `$.await` does, read out of `internal/server/index.js`: a promise writes `<!--[-->`
	// and the pending branch, without waiting; anything else writes `<!--[!-->` and the then
	// branch with the value bound to it; the catch branch is never written, because nothing
	// is awaited and so nothing rejects. Two branches decided by one test, which is an if to
	// every pass after this one -- the anchors are bytes read off the render, whichever they
	// are. The block stays an await in the rendered source so Svelte writes its own anchors,
	// and only the expression is swapped: a promise for the render that holds the pending
	// branch, and something the pattern can take apart for the one that holds the then
	// branch, whose value is unused because every expression in it is a marker already. The
	// payload is data and holds no promise, but a derivation may return one, and then the
	// pending branch is what Svelte's own server would have written. See spec/refusals.md.
	const whole = span(node);
	const at = span(node['expression']);
	if (whole === null || at === null) return;
	const value = node['value'];
	const waiting = node['pending'];
	const then = node['then'];
	let asking = false;

	const expression = expand(node['expression']);
	const test = `typeof (${expression})?.then === 'function'`;
	const kind = isNode(value) ? value['type'] : undefined;
	const holds = kind === 'ObjectPattern' ? '{}' : kind === 'ArrayPattern' ? '[]' : 'null';
	// The then branch, with the value bound: `then_fn(promise)` is called with what was
	// awaited, which was never a promise on this branch, so the value substitutes the way a
	// snippet's parameter does.
	const resolved = (): Walk => {
		if (isNode(value)) neutralise(value, edits);
		// A key that changes something as it is evaluated is held, by place, since two keys
		// written alike are two evaluations; and every value in the branch reads the holds
		// first, in order, because Svelte takes the pattern apart as the branch opens.
		const keys: string[] = [];
		const bound = isNode(value)
			? takenApart(
					value,
					`(${expression})`,
					expand,
					() => 'this await',
					(text, place) => {
						const key = `$$hold(${String(kept(`${text} /*@key:${String(place)} */`, walk))})`;
						keys.push(key);
						return key;
					},
				)
			: new Map<string, string>();
		const inner: Locals['rewrite'] = (child, more) => {
			const text = expand(child, more === undefined ? bound : new Map([...bound, ...more]));
			return keys.length === 0 ? text : `(${keys.join(', ')}, ${text})`;
		};
		return { ...walk, expand: inner };
	};

	// A test the request does not decide is the render's to answer, the way an if's is, and
	// the answer holds for every request rather than for this render: `{#await p}` over
	// `let p = Promise.resolve(...)` writes the pending branch always, and the then branch is
	// markup nobody reaches. Walked as a decision it was rendered anyway, against the promise
	// itself, and `cards.filter` on one threw. See spec/derivation.md.
	if (
		site.payload !== null &&
		walk.asking !== true &&
		!varies(test, walk, true) &&
		!site.mute.has(keyed(walk, test))
	) {
		const answer = site.decided.get(keyed(walk, test));
		if (answer === true) {
			edits.push([at[0], at[1], 'Promise.resolve()']);
			if (isNode(waiting)) step(waiting);
			buried(walk, then);
			return;
		}
		if (answer === false) {
			if (isNode(then)) collect(then, resolved());
			buried(walk, waiting);
			return;
		}
		// Asked as the author wrote it, since the expansion may name what only this walk holds.
		if (!site.asks.some(([key]) => key === keyed(walk, test))) {
			const written = `typeof (${source.slice(at[0], at[1])})?.then === 'function'`;
			site.asks.push([keyed(walk, test), written]);
		}
		// And the branches are walked as a decision until the answer is in, which is what
		// stops a block inside one asking a question of its own: an ask is a statement in the
		// script and runs whatever branch the render takes, so `{#each cards.filter(...)}`
		// under a `{:then}` nobody reaches was evaluated against the promise.
		asking = true;
	}

	const index = blocks.length;
	blocks.push({
		index,
		kind: 'if',
		stream,
		expression: test,
		tests: [test],
		item: null,
		counter: null,
		alternate: true,
		within: [...within],
	});
	const opening = chose(walk, edits, at[0], at[1], index, 0, 'Promise.resolve()', holds);
	// Which block just closed, written where the render puts it and nowhere else.
	const closer = edits.length;
	edits.push(stamped(walk, index, source, whole[1]));

	if (isNode(waiting)) {
		within.push([index, 0]);
		collect(waiting, asking ? { ...walk, asking: true } : walk);
		within.pop();
	}
	if (isNode(then)) {
		within.push([index, -1]);
		collect(then, asking ? { ...resolved(), asking: true } : resolved());
		within.pop();
	}
	// The catch branch is left as written and never walked: the server never writes it, so
	// nothing planted there would come back.
	// A head inside it has the block stand in the head stream. Its pending branch is the one
	// place a `{@const}` is not allowed, so the open goes around the expression instead,
	// which runs once before either branch: both are opened by it. See `headOpensWith()`.
	if (site.headed.has(index)) {
		const mirror = mirrored(walk, index, closer, []);
		rewrapped(walk, opening, (text) => headOpensWith(mirror, text));
	}
	return;
}

export function collectIf(node: AstNode, walk: Walk, step: Stepper): void {
	const { blocks, edits, expand, site, source, stream, within } = walk;
	// The whole `{:else if}` chain, because Svelte's server writes it as one block: the
	// transform flattens it and numbers the marker per branch rather than nesting a second
	// pair of anchors. Following the AST instead would number blocks the render never wrote.
	const chain = [node];
	for (;;) {
		const next = elseIf(chain[chain.length - 1]?.['alternate']);
		if (next === null) break;
		chain.push(next);
	}
	const last = chain[chain.length - 1];
	const otherwise = last?.['alternate'];
	// A `?:` in a test whose branches a marker cannot stand for -- one choosing between two
	// icon components on a payload key -- is a structure, and is enumerated the way one
	// handed to a package is: the walk stops and asks, and the build renders once per
	// branch. Told, the test is what the branch leaves, and the request may no longer
	// decide it, in which case the render does. See `stands`.
	const tests = chain.map((one) => settled(expand(one['test']), walk));

	// A test the source has already decided is not a question for anybody, and folding it
	// here is what keeps the walk out of a branch that is never written. See `constantly()`.
	const settledAt = reached(tests.map((one) => constantly(one)));
	if (settledAt !== null) {
		oneBranch(walk, chain, tests, settledAt, otherwise, edits, step);
		return;
	}

	// A block whose every test the request does not decide is decided once, by the render,
	// and is bytes: the branch it takes, between anchors the assembler copies as it copies
	// a package's own. Nothing in it is asked for per request -- which is what press's
	// newsletter needed, its branches turning on client state a library computes inside a
	// render and nowhere else. The walk is not told the answer the first time through, so
	// it asks: the render reports the value and the walk runs again told. Until then the
	// block is walked as a decision so that the render it is asked of can be made.
	let branches: Walk = walk;
	// **Up to the first test the request decides.** A later test is reached only where every
	// earlier one was false, so a chain whose render-decided prefix holds a true one is decided
	// whatever comes after: `{#if $foo}blah{:else if bar()}` over a `bar` the host holds is
	// the first branch for every request, and `bar()` is never called.
	const deciding = tests.findIndex(
		(test) => varies(test, walk, true) || site.mute.has(keyed(walk, test)),
	);
	const prefix = deciding === -1 ? tests : tests.slice(0, deciding);
	const heard = reached(prefix.map((test) => site.decided.get(keyed(walk, test))));
	if (
		site.payload !== null &&
		walk.asking !== true &&
		deciding !== -1 &&
		heard !== null &&
		heard >= 0
	) {
		oneBranch(walk, chain, tests, heard, otherwise, edits, step);
		return;
	}
	if (
		site.payload !== null &&
		walk.asking !== true &&
		deciding !== 0 &&
		(deciding === -1 || heard === null)
	) {
		const answers = prefix.map((test) => site.decided.get(keyed(walk, test)));
		const at = reached(answers);
		if (at !== null && deciding === -1) {
			oneBranch(walk, chain, tests, at, otherwise, edits, step);
			return;
		}
		// One test at a time, in source order, and never past one whose answer is not in yet.
		// A chain is a sequence of tests Svelte evaluates until one is true, so a later test
		// is only reached where every earlier one was false -- and the ask is written into the
		// script, where it runs whatever branch the render takes. Asked all at once,
		// `{#if $foo}blah{:else if bar()}` evaluated `bar()` for a chain whose first test is
		// true, and `bar` is a name that sample never binds.
		for (const [index, test] of prefix.entries()) {
			if (answers[index] === false) continue;
			if (!site.asks.some(([key]) => key === keyed(walk, test))) {
				site.asks.push([keyed(walk, test), asWritten(chain[index]?.['test'], test, walk)]);
			}
			break;
		}
		branches = { ...walk, asking: true };
	}

	const index = blocks.length;
	blocks.push({
		index,
		kind: 'if',
		stream,
		expression: tests[0] ?? '',
		tests,
		item: null,
		counter: null,
		alternate: otherwise !== null && otherwise !== undefined,
		within: [...within],
		// `IfBlock.js` wraps the chain on its head's `has_await`, the first test's, and on the
		// blockers its test reads, which is `async_block` around the same pair.
		...(awaiting(tests[0] ?? '') || blockedRead(chain[0]?.['test'], walk)
			? { wrapped: true as const }
			: {}),
	});
	// What a binding inside this block settles is read against the tests as they stand where
	// the block is walked, which is the pass's own source order. See `Site.tested`.
	const settledHere = sentFor(site.sends, site.copy);
	if (settledHere.size > 0) {
		site.tested.set(
			index,
			chain.map((one, at) => expand(one['test'], new Map(settledHere)) || (tests[at] ?? '')),
		);
	}

	// A chain no test of which the request decides is the render's to answer, and it is
	// asked above: the tests are written as the author wrote them, so the render takes the
	// branch it would take and evaluates nothing in the others. Forced to its first branch
	// instead, the render evaluated a body written for a request that never comes -- an
	// `await` of a promise nothing on the server resolves -- and never settled. The answer
	// decides the branch on the next pass, so the render's own choice here costs nothing.
	// See spec/pipeline.md, "A test the render answers is not forced".
	const answered = site.payload !== null && deciding === -1;
	for (const [branch, one] of chain.entries()) {
		const at = span(one['test']);
		const held = tests[branch] ?? '';
		if (at !== null) {
			// The author's test carries its own await and reads its own names, so it is not
			// wrapped the way a constant standing for it is.
			const written = answered ? asWritten(one['test'], held, walk) : null;
			chose(
				walk,
				edits,
				at[0],
				at[1],
				index,
				branch,
				written ?? waitsOn(one['test'], held, 'true', walk),
				written ?? waitsOn(one['test'], held, 'false', walk),
			);
		}
	}

	// Which block just closed, written where the render puts it and nowhere else.
	const whole = span(node);
	const closer = edits.length;
	if (whole !== null) edits.push(stamped(walk, index, source, whole[1]));

	// Only the first branch is in the baseline render, so only its blocks are numbered where
	// the assembler counts them. A block in any other branch is numbered here and appears in
	// a render nobody counts, which is the two lists coming apart. See spec/refusals.md.
	for (const [branch, one] of chain.entries()) {
		within.push([index, branch]);
		collect(one['consequent'], branches);
		within.pop();
	}
	if (isNode(otherwise)) {
		within.push([index, -1]);
		collect(otherwise, branches);
		within.pop();
	}
	// A head was walked inside it, so the block stands in the head stream too, opened at
	// the start of every branch that holds anything.
	if (site.headed.has(index)) {
		mirrored(walk, index, closer, [
			...chain.map((one) => afterTag(source, span(one['test']))),
			...(isNode(otherwise) ? [afterElse(source, otherwise)] : []),
		]);
	}
	return;
}

export function collectEach(node: AstNode, walk: Walk, step: Stepper): void {
	const { blocks, dynamic, edits, expand, site, source, stream, within } = walk;
	// A key is not carried, because Svelte's own server transform never mentions one: a
	// keyed each renders byte for byte what an unkeyed one renders, measured. It belongs to
	// the client, which compiles from the source and keeps it.
	const at = span(node['expression']);
	const pattern = node['context'];
	const context = span(pattern);
	const fallback = node['fallback'];
	if (at === null) return;

	// A destructuring context binds names rather than the element, and Svelte's server takes
	// it apart with `let <pattern> = each_array[i]`. So the one element this render iterates
	// has to be something the pattern accepts: `0` is not, and destructuring it threw inside
	// Svelte's own output -- `number 0 is not iterable` -- which told the author nothing.
	const kind = isNode(pattern) ? pattern['type'] : undefined;
	const destructured = kind === 'ObjectPattern' || kind === 'ArrayPattern';
	const element = kind === 'ObjectPattern' ? '{}' : kind === 'ArrayPattern' ? '[]' : '0';

	const index = blocks.length;
	// A destructuring binds names out of the element rather than the element, and the block
	// binds the element under a name of its own: `$$` is Svelte's reserved prefix, so no
	// author's name is shadowed, and the block's number is on it, so no two of them collide
	// where one each sits inside another. Each name the pattern binds is then an expression
	// over that one, taken apart the way a snippet's parameter is -- so a member stays a
	// path the injector resolves per item, and everything else is a derivation over the
	// binding, which is what a derivation reading an each's name already is.
	const held = `$$item${String(index)}`;
	// What the block binds stands for itself and not for a declaration of the same name.
	// Svelte's server writes `let a = each_array[i]` inside the loop, which shadows the `let
	// a` in the instance script the way any block-scoped declaration does, and
	// `{#each a as a}` wrote the array's own initialiser at every read without it.
	const apart = new Map<string, string>();
	if (isNode(pattern) && pattern['type'] === 'Identifier' && typeof pattern['name'] === 'string') {
		apart.set(pattern['name'], pattern['name']);
	}
	if (typeof node['index'] === 'string') apart.set(node['index'], node['index']);
	if (destructured && isNode(pattern)) {
		// The pattern stays in the render, over the one element it iterates, so nothing in it
		// may evaluate. A default is JavaScript's, read out of `EachBlock.js`: the server
		// writes `let { id = d } = each_array[i]`, so the name is the member where that is not
		// `undefined` and the default where it is, and `null` is not defaulted.
		neutralise(pattern, edits);
		for (const [name, member] of takenApart(
			pattern,
			held,
			expand,
			() => "this each block's pattern",
		)) {
			apart.set(name, member);
		}
	}

	// A source the request does not decide is iterated per request all the same, so the
	// runtime has to hold it -- as the value, never as the computation: press's counter
	// takes its digits from a query a library computes inside a render and nowhere else.
	// The render is asked for the value as JSON, and the walk runs again told, with the
	// literal where the expression was. See spec/refusals.md.
	let written = expand(node['expression']);
	// Whether it awaits is read before the render's answer replaces it: the answer is the
	// value, and the value is not a promise. What decides the anchors is the expression the
	// source held. See `waitsOn()`.
	const awaits = written;
	if (
		site.payload !== null &&
		walk.asking !== true &&
		!constant(written) &&
		!varies(written, walk) &&
		!site.mute.has(keyed(walk, written))
	) {
		const told = site.told.get(keyed(walk, written));
		if (told === undefined) {
			if (!site.wants.some(([key]) => key === keyed(walk, written))) {
				site.wants.push([keyed(walk, written), asWritten(node['expression'], written, walk)]);
			}
			// This render is only asked the value and is thrown away, and a body that awaits,
			// run over a placeholder item, runs what Svelte may never run: over an empty list it
			// does not, and `{await Promise.reject(...)}` in one threw here. So that body is left
			// out of it, and not walked, since an edit inside it would outlive the one that cuts
			// it. The next walk is told. A body that awaits nothing is walked as ever: what it
			// asks and binds is read in this pass.
			const inner = spanOfFragment(node['body']);
			if (inner !== null && awaitsAtTop(node['body'])) {
				edits.push([inner[0], inner[1], '']);
				if (isNode(fallback)) step(fallback);
				return;
			}
		} else {
			written = told;
		}
	}
	// **A source the build knows is empty never renders its body**, so the body is not
	// rendered here either, and the block is the bytes of its fallback: the render writes
	// `<!--[!-->`, the fallback and `<!--]-->` from the source as written. Rendered over a
	// placeholder item instead it ran what Svelte never runs -- `async-each-fallback-hoisting`
	// rejects in there on purpose.
	if (/^\[\s*\]$/.test(unwrapped(written)) && !constant(awaits)) {
		buried(walk, node['body']);
		const inner = spanOfFragment(node['body']);
		if (inner !== null) edits.push([inner[0], inner[1], '']);
		if (isNode(fallback)) step(fallback);
		return;
	}
	blocks.push({
		index,
		kind: 'each',
		within: [...within],
		stream,
		expression: written,
		...(awaiting(awaits) || blockedRead(node['expression'], walk)
			? { wrapped: true as const }
			: {}),
		// A block with no `as` still binds: `EachBlock.js` writes the `for` loop either way and
		// only skips `let <context> = each_array[i]` where there is no context to bind. So the
		// item is the block's own name, which nothing reads, rather than nothing at all --
		// the IR's `each` binds a name per iteration and has no shape for binding none.
		item: destructured || context === null ? held : source.slice(context[0], context[1]),
		counter: typeof node['index'] === 'string' ? node['index'] : null,
		alternate: fallback !== null && fallback !== undefined,
	});
	// The key's expression goes from the render and the key itself stays. Svelte's server
	// never reads a key -- `EachBlock.js` visits the expression, the context, the index, the
	// body and the fallback, and not `node.key` -- so what it holds cannot reach the bytes;
	// but the one element the render iterates is a placeholder the key would be evaluated
	// against, and `(tile.stat.lang)` on `{}` threw inside Svelte's own output.
	//
	// Removing the whole `(...)` unkeyed the block, which is not the same markup. An
	// `animate:` element must be the only child of a **keyed** each, and
	// `2-analyze/visitors/shared/element.js` asks `parent.key` for exactly that, so the
	// render's copy failed Svelte's own analysis with `animation_missing_key` -- upstream's
	// message, on upstream's own sample, which cannot be upstream's fault. A literal keeps
	// the block keyed, reads nothing, and cannot throw.
	const key = span(node['key']);
	if (key !== null) edits.push([key[0], key[1], '0']);
	// One element, because the body's own expressions are sentinels and read nothing from it.
	// An each with an `{:else}` is two shapes the way an if is: Svelte's server writes
	// `<!--[-->` and the items for a list with something in it, and `<!--[!-->` and the
	// fallback for one with nothing, so the fallback gets a render of its own, from an empty
	// list, the way an else does. See spec/refusals.md.
	chose(
		walk,
		edits,
		at[0],
		at[1],
		index,
		0,
		waitsOn(node['expression'], awaits, `[${element}]`, walk, true),
		waitsOn(node['expression'], awaits, '[]', walk, true),
	);
	// Which block just closed, written where the render puts it and nowhere else.
	const whole = span(node);
	const closer = edits.length;
	if (whole !== null) edits.push(stamped(walk, index, source, whole[1]));
	// What the block binds is decided per item, so an expression reading it is a marker
	// even when nothing else in it reaches the payload.
	const inside = new Set(dynamic);
	namesBound(pattern, inside);
	inside.add(held);
	if (typeof node['index'] === 'string') inside.add(node['index']);
	const body: Locals['rewrite'] =
		apart.size === 0
			? expand
			: (child, more) => expand(child, more === undefined ? apart : new Map([...apart, ...more]));
	// What this block binds, for a component tag that names it. The expression rather than the
	// render's answer: a list of components is not data and the render answers nothing for it.
	const named = destructured || context === null ? null : source.slice(context[0], context[1]);
	const bound =
		named === null || !IDENTIFIER.test(named)
			? walk.items
			: new Map([...walk.items, [named, awaits]]);
	within.push([index, 0]);
	collect(node['body'], { ...walk, dynamic: inside, expand: body, items: bound });
	within.pop();
	if (isNode(fallback)) {
		within.push([index, -1]);
		step(fallback);
		within.pop();
	}
	// A head was walked inside it, so the block stands in the head stream too: opened per
	// item, after the whole of the opening tag, and in the fallback where there is one.
	if (site.headed.has(index)) {
		const tag: [number, number] = [at[0], Math.max(at[1], context?.[1] ?? 0, key?.[1] ?? 0)];
		mirrored(walk, index, closer, [
			afterTag(source, tag),
			...(isNode(fallback) ? [afterElse(source, fallback)] : []),
		]);
	}
	return;
}
