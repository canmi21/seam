import { readFileSync } from 'node:fs';
import { basename, resolve as resolvePath } from 'node:path';
import { parse } from 'svelte/compiler';
import { resolved } from 'ast';
import { type AstNode, titles } from './node.ts';
import { renderRewritten, shippable } from './render.ts';
import { filled, outcomes, probed } from './resolve.ts';
import type { Rendered, Skeleton } from './shape.ts';
import { inlined } from './snippets.ts';
import { unbound } from './unbind.ts';
import { rewrite } from './walk.ts';

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
export async function skeleton(entryFile: string, root: string): Promise<Skeleton> {
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
	const baseline = rewrite(source, (_block, branch) => branch === 0, file, root);

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
	const rendered = await renderRewritten(file, baseline.rewritten, root, baseline.copies).catch(
		(error: unknown) => {
			const why = baseline.missed
				.map((one) => `  ${basename(one.file)}: ${one.reason.replace(/\s+/g, ' ')}`)
				.join('\n');
			if (why === '') throw error;
			throw new Error(
				`${String((error as Error).message)}\n\nThe render stopped inside a component this ` +
					'compiler could not walk into, so Svelte rendered it without the values a request ' +
					`would bring. What stopped the walk:\n${why}`,
			);
		},
	);
	const { body: html, head } = rendered;

	// The rest of each spread's call, which only the compiled output has.
	filled(baseline, file, root);

	// Before the alternates, because an if in markup nobody renders needs none of them.
	await probed(baseline, source, file, root, [html, head]);

	// One more render per branch the baseline does not hold, keyed the way Svelte numbers them:
	// `1`, `2` for each `{:else if}`, and `-1` for the else, which is what it writes into the
	// marker that opens the branch. Every other block stays on its first branch, which is what
	// keeps this one reachable.
	const alternates: Record<string, Rendered> = {};
	for (const block of baseline.blocks) {
		if (block.kind !== 'if' || block.absent === true) continue;
		const wanted = [...(block.tests ?? []).keys()].slice(1);
		// The else always gets a render, with or without a `{:else}` written: Svelte opens the
		// branch either way and an empty one is still the bytes for an if that is not taken.
		for (const branch of [...wanted, -1]) {
			// The ancestors go back on the branch that makes this block exist, or the render would
			// not hold it and there would be nothing to read.
			const forced = new Map(block.within ?? []);
			const chosen = (index: number, at: number) =>
				index === block.index ? at === branch : at === (forced.get(index) ?? 0);
			const flipped = rewrite(source, chosen, file, root);
			alternates[`${String(block.index)}.${String(branch)}`] = await renderRewritten(
				file,
				flipped.rewritten,
				root,
				flipped.copies,
			);
		}
	}

	// After every render rather than after the first: an element inside an if appears in the
	// alternate and not in the baseline, and the hash has to be read wherever the marker landed.
	await outcomes(baseline.holes, baseline.pending, [
		html,
		head,
		...Object.values(alternates).flatMap((one) => [one.body, one.head]),
	]);

	return { html, head, alternates, holes: baseline.holes, blocks: baseline.blocks };
}
