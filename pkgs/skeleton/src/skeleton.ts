import { readFileSync } from 'node:fs';
import { collides } from './sentinel.ts';
import { basename, relative, resolve as resolvePath } from 'node:path';
import { resolved } from '@seam-js/ast';
import { partial } from './compose.ts';
import { anchored } from './fresh.ts';
import { timed, timedSync } from './timing.ts';
import { renderRewritten, shippable } from './render.ts';
import { Climb, WholeRoute } from './ssr.ts';
import { dead, filled, outcomes, probed } from './resolve.ts';
import type { Block, Rendered, Skeleton } from './shape.ts';
import { inlined } from './snippets.ts';
import { unbound } from './unbind.ts';
import { rechosen } from './branches.ts';
import { outside } from './dynamic.ts';
import { rewrite } from './walk.ts';
import { Undecided } from './walk-types.ts';
import { whole } from './whole.ts';
import { blanked, expressionsOf } from './helpers.ts';
import { composed, tucked, unhydrated } from './hydratable.ts';
import { ran } from './ran.ts';

export { Undecided } from './walk-types.ts';

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

/** The walked pages whose markup changes what the script run holds. See `ran()`. */
const livePages = new WeakSet<Skeleton>();

/**
 * The walked compile, and where it refuses, the whole page as Svelte renders it if nothing on the
 * page is a request's to decide -- the rule `descend()` applies to a child, at the root. A refusal
 * about a page no request can change is a refusal about nothing. See spec/pipeline.md.
 */
export async function skeleton(
	entryFile: string,
	root: string,
	fixed: ReadonlyMap<string, string> = new Map(),
	decided: ReadonlyMap<string, boolean> = new Map(),
): Promise<Skeleton> {
	try {
		const page = await walked(entryFile, root, fixed, decided);
		// Where the markup changes the script's state, the page is computed by the run in render
		// order; where no request decides anything on it, Svelte's render is that page already --
		// unless a component on it renders by SSR, which is per request by declaration or because the
		// walk could not read it, and is not to be rendered once at the build. See spec/together.md.
		if (!livePages.has(page) || fixed.size > 0 || (page.ssr?.length ?? 0) > 0) return page;
		return (await whole(resolvePath(entryFile), root)) ?? page;
	} catch (error) {
		if (error instanceof Undecided || fixed.size > 0) throw error;
		// A component declared SSR is per request, and a page holding one is not Svelte's to render
		// once; one degraded by a refusal is the page's ordinary case. See spec/together.md.
		if ((error instanceof Climb || error instanceof WholeRoute) && error.declared) throw error;
		const page = await whole(resolvePath(entryFile), root);
		if (page === null) throw error;
		return page;
	}
}

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
export async function walked(
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
	/**
	 * What a component `bind:` settles a name to, by the caller's local, found on an earlier pass.
	 *
	 * Discovered rather than declared, like `decided`: the walk meets the tag half way through the
	 * template and Svelte re-renders the whole of it, so the settled value holds above the tag as
	 * well as below it and the pass that found it cannot use it. See `Site.sends`.
	 */
	sent: ReadonlyMap<string, string> = new Map(),
): Promise<Skeleton> {
	await shippable();
	const file = resolvePath(entryFile);
	// Before anything reads it: a snippet rendered more than once becomes one copy per call, which
	// is what the render does with it anyway and what leaves every pass below the case it knows.
	const source = inlined(unbound(readFileSync(file, 'utf8')));
	const clash = collides(source, basename(file));
	if (clash !== null) throw new Error(clash);

	if (process.env['SEAM_TRACE_SOURCE'] !== undefined) {
		console.error(`[seam] entry ${basename(file)} as walked:\n${source}\n`);
	}

	// `<style>` used to be refused here. It hangs off the root rather than off the fragment, so
	// neither pass's walk could see it and neither could refuse it: a styled component compiled,
	// exited zero, wrote Svelte's scoped class into the bytes and carried the stylesheet nowhere.
	// What it waited on was a half that emits one, which is the client build the plugin runs. The
	// class is a hash of the filename relative to `rootDir`, and both halves pass the project root,
	// which is what makes the class in these bytes the class in that stylesheet. See spec/build.md.

	// The first branch of every if, and every each with one item. An if with no `{:else if}` has
	// only that branch, so this is what "everything taken" used to mean.
	const baseline = timedSync('  walk (rewrite)', () =>
		rewrite(
			source,
			(_block, branch) => branch === 0,
			file,
			root,
			false,
			fixed,
			decided,
			told,
			mute,
			sent,
		),
	);
	// A binding the child sends back settles a name the template reads on either side of the tag,
	// so the pass that found it walked half the file without it. Walked again told, the way a value
	// the render was asked for is. Once, because the second pass is given every one of them.
	if (baseline.sends.size > 0) {
		return walked(file, root, fixed, decided, told, mute, new Map([...sent, ...baseline.sends]));
	}

	// After the walk, not before it. Every name has to come from somewhere -- this pass renders
	// rather than reading the markup, so a name nothing binds reaches Svelte's own renderer,
	// evaluates to undefined and writes an empty string. But a construct the compiler has not been
	// taught usually binds names of its own: `{#await}` binds its `:then`, a snippet binds its
	// parameters. Checking names first reports the name and hides the construct, which points the
	// author at the wrong thing. The walk above refuses the construct, so what reaches here is a
	// name in markup the compiler does understand.
	// The markup the walk folded away is blanked first, keeping every other offset where it was.
	// A branch behind a test the request does not decide, and which the answer excludes, is dead
	// for every request rather than only for this render -- and what the check owes an author is a
	// name that would have reached the bytes as nothing. There are no bytes there. Svelte compiles
	// such a branch and never runs it, so a name in one is not a name it asks about either.
	//
	// **And on the pass that is kept.** A test the request does not decide is answered by a render
	// and the walk runs again told, so the branch the answer excludes is folded on that second pass
	// and not on this one. Asking here reported a name that lives in markup no request reaches, one
	// pass before the walk knew that.
	if (baseline.asks.length === 0 && baseline.wants.length === 0) {
		resolved(blanked(source, baseline.dead.get(relative(root, file)) ?? []), basename(file), file);
	}
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
	if (process.env['SEAM_TRACE_SOURCE'] !== undefined) {
		console.error(`[seam] entry ${basename(file)} rewritten:\n${baseline.rewritten}\n`);
	}
	const rendered = await timed('  render (svelte SSR)', () =>
		renderRewritten(file, baseline.rewritten, root, baseline.copies, given, baseline.fresh),
	)
		.then((made) => {
			if (process.env['SEAM_TRACE_SOURCE'] !== undefined) {
				console.error(
					`[seam] entry ${basename(file)} rendered:\nhead: ${made.head}\nbody: ${made.body}\n`,
				);
			}
			return made;
		})
		.catch((error: unknown) => {
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
	// A test or a value the request does not decide was asked of the render, and this pass exists
	// to answer it: the walk runs again told, and everything below that reads the bytes -- the
	// probe, the dead holes, the class outcomes -- reads the bytes of that run rather than these.
	// So an asking pass renders what can answer and nothing else. The baseline has had its say
	// above, and an alternate has one only where a component the baseline does not render asks
	// something: a copy inside a branch the baseline does not take. A route with sixty blocks that
	// asks three times used to render every alternate three times over, and nearly all of the
	// article's eight minutes was that.
	const asking = baseline.asks.length > 0 || baseline.wants.length > 0;
	const answering = (block: Block, branch: number): boolean =>
		baseline.copies.some(
			(copy) =>
				((copy.asks?.length ?? 0) > 0 || (copy.wants?.length ?? 0) > 0) &&
				(copy.within ?? []).some(([index, at]) => index === block.index && at === branch),
		);

	if (!asking) {
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
	}

	// One more render per branch the baseline does not hold, keyed the way Svelte numbers them:
	// `1`, `2` for each `{:else if}`, and `-1` for the else, which is what it writes into the
	// marker that opens the branch. Every other block stays on its first branch, which is what
	// keeps this one reachable.
	const alternates: Record<string, Rendered> = {};
	for (const block of baseline.blocks) {
		if (block.absent === true) continue;
		// A block standing in the head stream is the body block it mirrors, rendered once; see below.
		if (block.mirrors !== undefined) continue;
		// An each with an `{:else}` has one other shape, the empty list, and it is keyed the way
		// an if's else is: `-1`, which is the branch the walk puts the fallback's blocks within.
		if (block.kind === 'each' && !block.alternate) continue;
		if (block.kind !== 'if' && block.kind !== 'each' && block.kind !== 'boundary') continue;
		// A boundary's second test is the JSON its failed branch opens with, not a branch of its own:
		// the one other render is the failed one, keyed as an else.
		const wanted = block.kind === 'if' ? [...(block.tests ?? []).keys()].slice(1) : [];
		// The else always gets a render, with or without a `{:else}` written: Svelte opens the
		// branch either way and an empty one is still the bytes for an if that is not taken.
		for (const branch of [...wanted, -1]) {
			if (asking && !answering(block, branch)) continue;
			// The ancestors go back on the branch that makes this block exist, or the render would
			// not hold it and there would be nothing to read.
			const forced = new Map(block.within ?? []);
			const chosen = (index: number, at: number) =>
				index === block.index ? at === branch : at === (forced.get(index) ?? 0);
			// The baseline's walk, with its branch choices written the other way. Nothing about a
			// walk depends on which branch a render takes except the text of a handful of edits --
			// `collect()` goes into every branch whatever it is told -- so an alternate is that walk
			// re-applied rather than the route walked again. See `rechosen()` in branches.ts.
			const flipped = timedSync('  rechoose (branch edits)', () => rechosen(baseline, chosen));
			const other = await timed('  render (svelte SSR)', () =>
				renderRewritten(file, flipped.rewritten, root, flipped.copies, given, flipped.fresh),
			);
			// The ids of the components the walk did not enter are numbered by this render, so they
			// are read back out of it rather than held in the one list every render shares.
			alternates[`${String(block.index)}.${String(branch)}`] = anchored(other);
		}
	}

	// A block standing in the head stream as well as the body is one if or one each, so the render
	// made with a branch of the body half taken is the render made with that branch of the head
	// half, and the assembler reads it under either index. See `mirrored()` in stamps.ts.
	for (const block of baseline.blocks) {
		if (block.mirrors === undefined) continue;
		for (const [key, other] of Object.entries(alternates)) {
			const dot = key.indexOf('.');
			if (Number(key.slice(0, dot)) !== block.mirrors) continue;
			alternates[`${String(block.index)}${key.slice(dot)}`] = other;
		}
	}

	// Every render this pass makes has had its say -- the baseline and each alternate that could
	// answer -- so a component in a branch the baseline does not take has answered too. One
	// nothing rendered is not asked again: it is walked as the decision it was, which the runtime
	// makes.
	if (asking) {
		if (process.env['SEAM_TRACE'] !== undefined) {
			console.error(
				`[seam] ${basename(file)}: asked ${String(baseline.asks.length)} tests and ` +
					`${String(baseline.wants.length)} values (told ${String(told.size)}, decided ` +
					`${String(decided.size)}, mute ${String(mute.size)}, blocks ${String(baseline.blocks.length)}, ` +
					`alternates ${String(Object.keys(alternates).length)})`,
			);
			for (const want of baseline.wants) {
				console.error(
					`[seam]   want ${want.replace(/\s+/g, ' ').slice(0, 160)} -> told ${String(told.has(want))}`,
				);
			}
		}
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
		return walked(file, root, fixed, settled, values, muted, sent);
	}

	if (process.env['SEAM_TRACE'] !== undefined) {
		const entered = [...new Set(baseline.copies.map((copy) => relative(root, copy.file)))];
		console.error(`[seam] entered ${String(entered.length)} files: ${entered.join(', ')}`);
		for (const one of baseline.missed) {
			console.error(
				`[seam] left to the render: ${relative(root, one.file)} -- ${one.reason.replace(/\s+/g, ' ').slice(0, 200)}`,
			);
		}
	}
	// An id written by a component the walk did not enter is a marker rather than a hole, because
	// Svelte numbers them per render. See `anchored`.
	const { body: html, head } = unhydrated(
		tucked(anchored(rendered), baseline.blocks),
		baseline.eager.length,
	);
	for (const [key, other] of Object.entries(alternates)) {
		alternates[key] = unhydrated(tucked(other, baseline.blocks), baseline.eager.length);
	}

	const everywhere = [
		html,
		head,
		...Object.values(alternates).flatMap((one) => [one.body, one.head]),
	];

	// After the alternates, because a value that comes back in one of them is not missing at all.
	await dead(baseline, file, root, given, rendered, everywhere);

	// After every render rather than after the first: an element inside an if appears in the
	// alternate and not in the baseline, and the hash has to be read wherever the marker landed.
	await outcomes(baseline.holes, baseline.pending, everywhere);

	const finished: Skeleton = {
		html,
		head,
		alternates,
		holes: baseline.holes,
		blocks: baseline.blocks,
		defaults: baseline.defaults,
		eager: baseline.eager,
		...(baseline.ssr.length === 0
			? {}
			: { ssr: baseline.ssr.map((one) => ({ file: relative(root, one.file), why: one.why })) }),
		// One entry per file rather than per call site: two calls of one component carry the same
		// imports, and what is wanted here is which modules the bundle has to reach. Relative to the
		// root, because this is written into a fixture two machines have to agree on, and an
		// absolute path says which machine built it.
		entered: [...new Set(baseline.copies.map((copy) => relative(root, copy.file)))],
		payload: baseline.payload,
		held: baseline.keeping.map((one) => ({
			expression: one.expression,
			files: one.files ?? [],
			...(one.item === true ? { item: true as const } : {}),
		})),
		// Left out where there is none, which is nearly every component: this is recorded in the
		// corpus and a key holding an empty object is churn in every fixture for the sake of the few
		// that have one.
		...(baseline.dead.size === 0 ? {} : { dead: Object.fromEntries(baseline.dead) }),
	};

	// Every expression here is a derivation, and a derivation is evaluated outside `render()`.
	// `varies()` asks this of each expression it turns into a marker, and not every marker is
	// planted through that question: a `class:` directive is a decision the element has whatever
	// its value reads, so a context read inside one went out as a derivation and threw
	// `lifecycle_outside_component` at injection rather than naming a file here. Asked once more
	// over the finished list, which is the one place that holds all of them.
	ran(finished, relative(root, file), baseline.ran, source, baseline.live, root, [
		...decided.keys(),
	]);
	if (baseline.live) livePages.add(finished);
	for (const one of expressionsOf(finished)) {
		outside(one.expression, true, baseline.changing, one.files);
	}
	composed(expressionsOf(finished), root);

	return finished;
}
