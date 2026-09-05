import { readFileSync } from 'node:fs';
import { basename, relative, resolve as resolvePath } from 'node:path';
import { parse } from 'svelte/compiler';
import { resolved } from 'ast';
import { partial } from './compose.ts';
import { anchored } from './fresh.ts';
import { type AstNode, titles } from './node.ts';
import { renderRewritten, shippable } from './render.ts';
import { dead, filled, outcomes, probed } from './resolve.ts';
import type { Rendered, Skeleton } from './shape.ts';
import { inlined } from './snippets.ts';
import { unbound } from './unbind.ts';
import { rewrite } from './walk.ts';

export { Undecided } from './walk.ts';

export type { Block, Choice, Hole, Rendered, Skeleton, Stream } from './shape.ts';

/**
 * One compile-time render of one component, and the record of every place a value would have gone.
 *
 * The order below is the order the answers become available, and each step says why it cannot come
 * earlier: the walk, then the baseline render, then the rest of each spread's call, then the probe
 * that says which components write what they were handed, then one render per branch nobody took,
 * then the class and style outcomes -- which need every one of those renders, because an element
 * inside an if is in the alternate and not in the baseline.
 */

/**
 * `root` is handed to Svelte as `rootDir`, and it decides bytes rather than diagnostics.
 *
 * Two things Svelte writes are hashes of the component's filename: the anchor that opens a
 * `<svelte:head>` block, and the class that scopes a `<style>`. Before hashing, it makes the
 * filename relative to `rootDir`, which defaults to `process.cwd()` -- so left alone, the
 * directory the build ran from is in the response, and one component compiled from three
 * directories gets three different hashes.
 *
 * The client half hashes the same name and compares: `head()` in Svelte's client checks the
 * anchor's text against the hash it was compiled with, and gives up if they differ. So `rootDir`
 * is not a nicety on one side of the build; it is what makes the two sides agree. Passing it, and
 * leaving `filename` absolute, is Svelte's own answer -- the filename stays real for errors and
 * source maps. See spec/build.md.
 */
export async function skeleton(
	entryFile: string,
	root: string,
	/**
	 * Payload paths this render is being made for, as literal source text.
	 *
	 * The build declares a field's domain and calls this once per value; in each render the path is
	 * a literal rather than a hole, so the structures it induces are produced at compile time
	 * instead of being decided per request. See spec/pipeline.md.
	 */
	fixed: ReadonlyMap<string, string> = new Map(),
	/**
	 * Which branch each `?:` handed to a component the walk cannot enter takes in this render, by
	 * the test's source text. Discovered rather than declared: the walk stops with `Undecided` at
	 * the first it is not told about, and the build calls this once per branch. See spec/refusals.md.
	 */
	decided: ReadonlyMap<string, boolean> = new Map(),
	/** What the render answered when asked for a value, by expression, as JSON. See `Site.wants`. */
	told: ReadonlyMap<string, string> = new Map(),
	/** Asks no render answered, which are not asked again. See `Site.mute`. */
	mute: ReadonlySet<string> = new Set(),
): Promise<Skeleton> {
	await shippable();
	const file = resolvePath(entryFile);
	// Before anything reads it: a snippet rendered more than once becomes one copy per call, which
	// is what the render does with it anyway and what leaves every pass below the case it knows.
	const source = inlined(unbound(readFileSync(file, 'utf8')));

	const parsed = parse(source, { modern: true }) as unknown as AstNode;

	// `<style>` used to be refused here. It hangs off the root rather than off the fragment, so
	// neither pass's walk could see it and neither could refuse it: a styled component compiled,
	// exited zero, wrote Svelte's scoped class into the bytes and carried the stylesheet nowhere.
	// What it waited on was a half that emits one, which is the client build the plugin runs. The
	// class is a hash of the filename relative to `rootDir`, and both halves pass the project root,
	// which is what makes the class in these bytes the class in that stylesheet. See spec/build.md.

	const { found, conditional } = titles(parsed);
	if (found > 1) {
		throw new Error(
			`this component writes ${found} titles, and which of them wins is not decided; see spec/ir.md`,
		);
	}
	// The title leaves the block it was written in: the block renders empty and the title is
	// appended after every one of them, so nothing in the bytes says the two go together.
	if (conditional) {
		throw new Error(
			'which of two titles wins is not decided, and a title inside a block is that question: the ' +
				'block renders without it. See spec/ir.md',
		);
	}

	// The first branch of every if, and every each with one item. An if with no `{:else if}` has
	// only that branch, so this is what "everything taken" used to mean.
	const baseline = rewrite(
		source,
		(_block, branch) => branch === 0,
		file,
		root,
		false,
		fixed,
		decided,
		told,
		mute,
	);

	// After the walk, not before it. Every name has to come from somewhere -- this pass renders
	// rather than reading the markup, so a name nothing binds reaches Svelte's own renderer,
	// evaluates to undefined and writes an empty string. But a construct the compiler has not been
	// taught usually binds names of its own: `{#await}` binds its `:then`, a snippet binds its
	// parameters. Checking names first reports the name and hides the construct, which points the
	// author at the wrong thing. The walk above refuses the construct, so what reaches here is a
	// name in markup the compiler does understand.
	resolved(source, basename(file));
	// A render that fails is nearly always a component the walk could not enter and Svelte then
	// rendered without the data it needed. The author was shown that crash and never the refusal
	// behind it, so both are said here, the refusals first.
	// What the entry's own props are, which is the payload: the render is given the paths it is
	// fixed at under the names they arrive as, and nothing else.
	const given: Record<string, unknown> = {};
	for (const path of fixed.keys()) {
		const [name] = path.split('.');
		if (name !== undefined && !(name in given)) {
			const held = partial(fixed, name);
			if (held !== undefined) given[name] = held;
		}
	}
	// What the render is asked to decide is read back after it, below.
	const asked = globalThis as unknown as Record<string, Record<string, unknown> | undefined>;
	asked['__seam_asked'] = {};
	const rendered = await renderRewritten(
		file,
		baseline.rewritten,
		root,
		baseline.copies,
		given,
		baseline.fresh,
	).catch((error: unknown) => {
		const why = baseline.missed
			.map((one) => `  ${basename(one.file)}: ${one.reason.replace(/\s+/g, ' ')}`)
			.join('\n');
		if (why === '') throw error;
		throw new Error(
			`${String((error as Error).message)}\n\nThe render stopped inside a component this ` +
				'compiler could not walk into, so Svelte rendered it without the values a request ' +
				`would bring. What stopped the walk:\n${why}`,
		);
	});
	// The rest of each spread's call, which only the compiled output has.
	filled(baseline, file, root);

	// Before the alternates, because an if in markup nobody renders needs none of them.
	await probed(
		baseline,
		source,
		file,
		root,
		[rendered.body, rendered.head],
		fixed,
		given,
		decided,
		told,
		mute,
	);

	// One more render per branch the baseline does not hold, keyed the way Svelte numbers them:
	// `1`, `2` for each `{:else if}`, and `-1` for the else, which is what it writes into the
	// marker that opens the branch. Every other block stays on its first branch, which is what
	// keeps this one reachable.
	const alternates: Record<string, Rendered> = {};
	for (const block of baseline.blocks) {
		if (block.absent === true) continue;
		// An each with an `{:else}` has one other shape, the empty list, and it is keyed the way
		// an if's else is: `-1`, which is the branch the walk puts the fallback's blocks within.
		if (block.kind === 'each' && !block.alternate) continue;
		if (block.kind !== 'if' && block.kind !== 'each') continue;
		const wanted = block.kind === 'each' ? [] : [...(block.tests ?? []).keys()].slice(1);
		// The else always gets a render, with or without a `{:else}` written: Svelte opens the
		// branch either way and an empty one is still the bytes for an if that is not taken.
		for (const branch of [...wanted, -1]) {
			// The ancestors go back on the branch that makes this block exist, or the render would
			// not hold it and there would be nothing to read.
			const forced = new Map(block.within ?? []);
			const chosen = (index: number, at: number) =>
				index === block.index ? at === branch : at === (forced.get(index) ?? 0);
			const flipped = rewrite(source, chosen, file, root, false, fixed, decided, told, mute);
			const other = await renderRewritten(
				file,
				flipped.rewritten,
				root,
				flipped.copies,
				given,
				flipped.fresh,
			);
			// The ids of the components the walk did not enter are numbered by this render, so they
			// are read back out of it rather than held in the one list every render shares.
			alternates[`${String(block.index)}.${String(branch)}`] = anchored(other);
		}
	}
	// An id written by a component the walk did not enter is a marker rather than a hole, because
	// Svelte numbers them per render. See `anchored`.
	const { body: html, head } = anchored(rendered);

	const everywhere = [
		html,
		head,
		...Object.values(alternates).flatMap((one) => [one.body, one.head]),
	];

	// After the alternates, because a value that comes back in one of them is not missing at all.
	await dead(baseline, file, root, given, rendered, everywhere);

	// After every render rather than after the first: an element inside an if appears in the
	// alternate and not in the baseline, and the hash has to be read wherever the marker landed.
	await outcomes(baseline.holes, baseline.pending, [
		html,
		head,
		...Object.values(alternates).flatMap((one) => [one.body, one.head]),
	]);

	// A test or a value the request does not decide was asked of the render, and the walk runs
	// again told. Every render so far -- the baseline and each alternate -- has had its say, so a
	// component in a branch the baseline does not take has answered too. One nothing rendered is
	// not asked again: it is walked as the decision it was, which the runtime makes.
	if (baseline.asks.length > 0 || baseline.wants.length > 0) {
		const answers = asked['__seam_asked'] ?? {};
		const settled = new Map(decided);
		const values = new Map(told);
		const muted = new Set(mute);
		for (const test of baseline.asks) {
			const value = answers[test];
			if (value === undefined) muted.add(test);
			else settled.set(test, value === true);
		}
		for (const want of baseline.wants) {
			const value = answers[want];
			// `JSON.stringify` of something it cannot write, a function or a symbol, is undefined:
			// a value the runtime could not hold as a value, so the expression stays what it was.
			if (typeof value !== 'string') muted.add(want);
			else values.set(want, value);
		}
		return skeleton(file, root, fixed, settled, values, muted);
	}

	return {
		html,
		head,
		alternates,
		holes: baseline.holes,
		blocks: baseline.blocks,
		// One entry per file rather than per call site: two calls of one component carry the same
		// imports, and what is wanted here is which modules the bundle has to reach. Relative to the
		// root, because this is written into a fixture two machines have to agree on, and an
		// absolute path says which machine built it.
		entered: [...new Set(baseline.copies.map((copy) => relative(root, copy.file)))],
		payload: baseline.payload,
	};
}

/**
 * Every expression the compiled component will evaluate, with the files it was written across:
 * each hole's, each decision's tests, and each block's source and tests. What they read, in
 * which file, is what has to be carried. See `carriedBy()`.
 */
export function expressionsOf(rendered: Skeleton): { expression: string; files: string[] }[] {
	const found: { expression: string; files: string[] }[] = [];
	for (const hole of rendered.holes) {
		const files = hole.files ?? [];
		found.push({ expression: hole.expression, files });
		for (const test of hole.choice?.tests ?? []) found.push({ expression: test, files });
	}
	for (const block of rendered.blocks) {
		const files = block.files ?? [];
		for (const expression of [block.expression, ...(block.tests ?? [])]) {
			found.push({ expression, files });
		}
	}
	return found;
}
