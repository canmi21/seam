import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';
import { collides, stamp } from './sentinel.ts';
import { basename, relative, resolve as resolvePath } from 'node:path';
import {
	type Carried,
	GIVEN,
	importsOf,
	projectAsync,
	readsOf,
	readsReplaced,
	resolveBare,
	resolved,
	RUN_NAME,
} from 'ast';
import { partial } from './compose.ts';
import { anchored } from './fresh.ts';
import { isNode, namesIn, refuse } from './node.ts';
import { timed, timedSync } from './timing.ts';
import { renderRewritten, shippable } from './render.ts';
import { dead, filled, outcomes, probed } from './resolve.ts';
import type { Block, Rendered, Skeleton } from './shape.ts';
import { inlined } from './snippets.ts';
import { unbound } from './unbind.ts';
import { HYDRATABLE, HYDRATABLE_RUN, outside, rechosen, rewrite, Undecided } from './walk.ts';
import { whole } from './whole.ts';

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
		// order; where no request decides anything on it, Svelte's render is that page already.
		if (!livePages.has(page) || fixed.size > 0) return page;
		return (await whole(resolvePath(entryFile), root)) ?? page;
	} catch (error) {
		if (error instanceof Undecided || fixed.size > 0) throw error;
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
async function walked(
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
			// re-applied rather than the route walked again. See `rechosen()` in walk.ts.
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
	// half, and the assembler reads it under either index. See `mirrored()` in walk.ts.
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
		// One entry per file rather than per call site: two calls of one component carry the same
		// imports, and what is wanted here is which modules the bundle has to reach. Relative to the
		// root, because this is written into a fixture two machines have to agree on, and an
		// absolute path says which machine built it.
		entered: [...new Set(baseline.copies.map((copy) => relative(root, copy.file)))],
		payload: baseline.payload,
		held: baseline.keeping.map((one) => ({ expression: one.expression, files: one.files ?? [] })),
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
	ran(finished, relative(root, file), baseline.ran, source, baseline.live, root);
	if (baseline.live) livePages.add(finished);
	for (const one of expressionsOf(finished)) outside(one.expression, true, baseline.changing);
	composed(expressionsOf(finished), root);

	return finished;
}

/**
 * Every read of one of the entry's own names that substitution could not follow, in an expression
 * the artifact holds, written as a field of the entry's script run as Svelte compiled it.
 *
 * The render evaluates the author's text and has these right wherever it is the one asked; what
 * reaches here is a read the artifact has to answer per request, and the run is its answer: one
 * held value per request, `$$run($$given)`, whose fields are what the markup would have read. Only
 * an expression written in the entry's own file, whose names are the entry's. See
 * spec/derivation.md, "Where substitution cannot follow, the script runs as Svelte compiled it".
 */
function ran(
	rendered: Skeleton,
	entry: string,
	changed: ReadonlySet<string>,
	source: string,
	/** Whether the markup itself changes the run's state while the bytes are written. */
	live = false,
	root = '',
): void {
	if (changed.size === 0) return;
	const hydrating = HYDRATABLE.test(source);
	// A component the run chose is compared by identity, and the run holds its own copy of each.
	// Asked of the markup by the name, as `chosenComponent()` asks it of an expansion in a child.
	const component = [...changed].find((name) =>
		new RegExp(`this=\\{[^}]*\\b${name}\\b|<${name}[\\s/>]`).test(source),
	);
	const names = new Set([...changed, ...[...changed].map((one) => `$${one}`)]);
	// The request's `hydratable` goes to the run, whose script makes its calls in its own order and
	// under its own conditions, which is Svelte's. See `captured()` in the ast package.
	const imported = hydrating ? hydratableImport(source) : { local: null, module: false };
	const call = `${RUN_NAME}(${GIVEN}${imported.local === null ? '' : `, ${imported.local}`})`;
	const running = projectAsync() ? `(await ${call})` : call;
	let at: number | undefined;
	const field = (name: string): string => {
		if (hydrating && (imported.local === null || imported.module)) refuse(HYDRATABLE_RUN);
		if (component !== undefined) {
			refuse(
				`\`${component}\` is a component chosen by a script this compiler runs per request: ` +
					'which component renders is decided by identity, and the run holds its own copy of ' +
					'each, not the one the source names. See spec/derivation.md',
			);
		}
		at ??= rendered.held.push({ expression: running, files: [entry] }) - 1;
		return `($$hold(${String(at)}).${name})`;
	};
	// Where the markup changes the run's state, a read is a read at one moment: two holes writing
	// the same text read at two points of the render, and one derivation for both would answer the
	// second with the first's value. Each is marked with its place, as `placed()` marks a clock.
	let place = 0;
	const over = (text: string): string => {
		const read = readsReplaced(text, names, field);
		if (!live || read === text) return read;
		place += 1;
		return `${read} /*@run:${String(place)} */`;
	};
	const own = (files: readonly string[] | undefined): boolean => (files?.[0] ?? entry) === entry;
	// What the walk holds once per request -- a spread's object -- is written in the entry's terms
	// too, and read once, where the render reads it.
	for (const one of [...rendered.held]) {
		if (own(one.files)) one.expression = over(one.expression);
	}
	// A child's hole holds what the entry handed it, in the entry's names, beside the child's own:
	// the entry's are written as fields of the run where the markup changes what it holds, and a
	// name a file nearer the hole declares is that file's and stays.
	const handed = (files: readonly string[] | undefined): string[] | null => {
		const chain = files ?? [];
		const reached = chain.indexOf(entry);
		if (!live || reached <= 0) return null;
		return chain.slice(0, reached);
	};
	for (const hole of rendered.holes) {
		const inner = handed(hole.files);
		if (inner !== null) {
			const nearer = new Set<string>();
			for (const one of inner)
				for (const name of declaredIn(resolvePath(root, one))) nearer.add(name);
			const mine = new Set([...names].filter((one) => !nearer.has(one.replace(/^\$/, ''))));
			const read = readsReplaced(hole.expression, mine, field);
			if (read !== hole.expression) {
				place += 1;
				hole.expression = `${read} /*@run:${String(place)} */`;
			}
			continue;
		}
		if (!own(hole.files)) continue;
		hole.expression = over(hole.expression);
		if (hole.choice?.tests !== undefined) hole.choice.tests = hole.choice.tests.map(over);
		if (hole.call?.binds !== undefined) {
			hole.call.binds = hole.call.binds.map(([name, one]) => [name, over(one)]);
		}
	}
	// A prop's default that reads one of these is the run's too, and the run answers with the prop
	// itself: it is given the request's props and applies the default as Svelte's script does, so
	// what the default changes along the way is changed in the same run the markup reads. `field` is
	// still asked, for the refusals it makes.
	for (const one of rendered.defaults) {
		if (!own(one.files) || over(one.expression) === one.expression) continue;
		// The run itself rather than the held derivation standing for it: defaults are computed
		// before any other derivation exists, and the run answers the same props object once.
		field(one.name);
		one.expression = `${running}.${one.name}`;
	}
	for (const block of rendered.blocks) {
		if (!own(block.files)) continue;
		block.expression = over(block.expression);
		if (block.tests !== undefined) block.tests = block.tests.map(over);
		if (block.fragment?.binds !== undefined) {
			block.fragment.binds = block.fragment.binds.map(([name, one]) => [name, over(one)]);
		}
	}
	// Taken, the run is what makes the entry's `hydratable` calls: once, first, whether or not the
	// markup reads what they return, as Svelte's script makes them. The calls read out of the source
	// one by one would make every one of them, whichever branch the script takes.
	if (at !== undefined && imported.local !== null) {
		rendered.eager = [{ expression: running, files: [entry] }];
	}
}

/** Every name a component's scripts declare or import at their top level, by file, once. */
const declaredNames = new Map<string, ReadonlySet<string>>();
function declaredIn(file: string): ReadonlySet<string> {
	const held = declaredNames.get(file);
	if (held !== undefined) return held;
	const found = new Set<string>();
	try {
		const ast = parse(readFileSync(file, 'utf8'), { modern: true }) as unknown as Record<
			string,
			unknown
		>;
		for (const block of [ast['module'], ast['instance']]) {
			const content = isNode(block) ? block['content'] : undefined;
			const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
			for (const statement of body) {
				if (!isNode(statement)) continue;
				const declaration =
					statement['type'] === 'ExportNamedDeclaration' && isNode(statement['declaration'])
						? statement['declaration']
						: statement;
				if (declaration['type'] === 'ImportDeclaration') {
					const specifiers = declaration['specifiers'];
					for (const one of Array.isArray(specifiers) ? specifiers : []) {
						if (isNode(one) && isNode(one['local'])) namesIn(one['local'], found);
					}
				} else if (declaration['type'] === 'VariableDeclaration') {
					const declarations = declaration['declarations'];
					for (const one of Array.isArray(declarations) ? declarations : []) {
						if (isNode(one)) namesIn(one['id'], found);
					}
				} else if (isNode(declaration['id'])) {
					namesIn(declaration['id'], found);
				}
			}
		}
	} catch {
		// A file that does not parse declares nothing this can read; the compile has said so already.
	}
	declaredNames.set(file, found);
	return found;
}

/** The name one script block imports Svelte's `hydratable` under, or null. */
function hydratableIn(block: unknown): string | null {
	const content = isNode(block) ? block['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'ImportDeclaration') continue;
		if (!isNode(statement['source']) || statement['source']['value'] !== 'svelte') continue;
		const specifiers = statement['specifiers'];
		for (const one of Array.isArray(specifiers) ? specifiers : []) {
			if (!isNode(one) || !isNode(one['imported']) || !isNode(one['local'])) continue;
			if (one['imported']['name'] !== 'hydratable') continue;
			if (typeof one['local']['name'] === 'string') return one['local']['name'];
		}
	}
	return null;
}

/**
 * The name the instance script imports Svelte's `hydratable` under, and whether the module script
 * imports it too, which the run cannot hand the request's: the two blocks are one module once
 * compiled.
 */
function hydratableImport(source: string): { local: string | null; module: boolean } {
	const ast = parse(source, { modern: true }) as unknown as Record<string, unknown>;
	return {
		local: hydratableIn(ast['instance']),
		module: hydratableIn(ast['module']) !== null,
	};
}

/**
 * A render with the stamp of each block Svelte wraps in a child block moved inside that wrapper.
 *
 * `create_child_block` writes `<!--[-->` and `<!--]-->` around a block whose source or test awaits,
 * so its close sits between the block's own close and the stamp, and the assembler, which takes
 * the close before a stamp as the block's, took the wrapper for the block: every item of an each
 * came out wrapped in a pair of its own. Moving the stamp one close in leaves the wrapper's close as
 * the bytes around the block it is. Letting the assembler step over a close instead was tried and
 * is wrong for every block that has none -- see spec/roadmap.md -- which is why the walk says which
 * block has one.
 */
function tucked(rendered: Rendered, blocks: readonly Block[]): Rendered {
	let { body, head } = rendered;
	for (const one of blocks) {
		if (one.wrapped !== true) continue;
		const at = stamp(one.index);
		body = body.replace(`<!--]-->${at}`, `${at}<!--]-->`);
		head = head.replace(`<!--]-->${at}`, `${at}<!--]-->`);
	}
	return { ...rendered, body, head };
}

/**
 * The render without the script `hydratable` values went into, which the injector writes per request.
 *
 * `#render_async` prepends it to the head as `\n\t\t<script>` (or `<script nonce=...>`), the
 * entries and `</script>`, and the values in it are the build's -- the sentinels a request's would
 * have been, run once. So it is taken off and the injector writes the request's own, from the
 * record the derivations filled. See `Skeleton.eager`.
 *
 * Refused where the render wrote more keys than the entry's script makes calls: a key the walk did
 * not see made is one no derivation would make per request, a child's `hydratable` or one behind
 * a function the script called, and the script would come out without it.
 */
function unhydrated(rendered: Rendered, calls: number): Rendered {
	const opens = '\n\t\t<script';
	const closes = '</script>';
	if (!rendered.head.startsWith(opens)) return rendered;
	const end = rendered.head.indexOf(closes);
	if (end === -1) return rendered;
	const script = rendered.head.slice(0, end);
	// One entry per line inside the `for` over them, as `#hydratable_block` joins them.
	const listed = /for \(const \[k, v\] of \[\n([\s\S]*?)\n\t*\]\)/.exec(script)?.[1] ?? '';
	const keys = listed.split(',\n').length;
	if (keys > calls) {
		refuse(
			`a \`hydratable\` call this compiler cannot see made: the render wrote ${String(keys)} ` +
				`key${keys === 1 ? '' : 's'} and the entry's script makes ${String(calls)} call` +
				`${calls === 1 ? '' : 's'}. One inside a child component, or behind a function the script ` +
				'calls, is made per request by nothing. See spec/derivation.md',
		);
	}
	return { ...rendered, head: rendered.head.slice(end + closes.length) };
}

/**
 * Refuses a derivation that reads a component, which is the half of resolution this is the place for.
 *
 * A component import resolves -- the file imports it and the copy this compiler stages keeps the
 * import, so a component handed to a child as a prop is a value the build has. What the bundle
 * cannot hold is the same name: `carriedBy()` skips a default `.svelte` import because a component
 * is composed at compile time and is never a value an expression calls, and a derivation is
 * evaluated outside the render with only what the bundle carries. So the one shape that has to be
 * refused is a component reaching an expression the artifact holds.
 *
 * Asked here rather than in `bindings.ts`, for the same reason the rule about a value the render
 * changes is: over the finished list, which is the one place that holds every expression. Asked at
 * the name, it refused `runtime-legacy/transition-css-iframe` -- `<Frame component={Foo}/>` over a
 * `Foo` two lines above it in an `import` -- for a name the data does not carry. See
 * spec/derivation.md.
 */
function composed(
	expressions: readonly { expression: string; files: string[] }[],
	root: string,
): void {
	const components = new Map<string, ReadonlySet<string>>();
	const held = (file: string): ReadonlySet<string> => {
		const found = components.get(file);
		if (found !== undefined) return found;
		const at = resolvePath(root, file);
		const names = new Set<string>();
		let source: string;
		try {
			source = readFileSync(at, 'utf8');
		} catch {
			components.set(file, names);
			return names;
		}
		for (const [local, one] of importsOf(source)) {
			if (one.kind !== 'default') continue;
			if ((resolveBare(one.from, at) ?? one.from).endsWith('.svelte')) names.add(local);
		}
		components.set(file, names);
		return names;
	};
	for (const one of expressions) {
		const names = readsOf([one.expression]);
		for (const file of one.files) {
			for (const name of names) {
				if (!held(file).has(name)) continue;
				throw new Error(
					`\`${name}\` is a component read by an expression this artifact holds, and a ` +
						'derivation is evaluated outside the render with only what the bundle carries. A ' +
						'component is composed at compile time and is not a value the bundle can hold, so ' +
						'the choice has to be written as an `{#if}` around each component. See ' +
						'spec/derivation.md',
				);
			}
		}
	}
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
		for (const [, expression] of hole.call?.binds ?? []) found.push({ expression, files });
	}
	for (const block of rendered.blocks) {
		const files = block.files ?? [];
		for (const expression of [block.expression, ...(block.tests ?? [])]) {
			found.push({ expression, files });
		}
		for (const [, expression] of block.fragment?.binds ?? []) found.push({ expression, files });
	}
	// A held value is a derivation like any other and is written where the declaration was, so what
	// it calls is what that file imports. It is not a hole -- the hole names a reference to it -- so
	// gathering holes alone left the bundle without it: `const attrs = writable(...)` handed to a
	// child came out as a derivation calling a name the bundle had not got. See `Skeleton.held`.
	//
	// **Only the ones something reaches**, to a fixed point, since a held value may name another.
	// The list is appended to while the walk expands, and a branch the walk then folds away leaves
	// its entries behind: an `{#await}`'s `then` pattern is walked and the block is dropped, and the
	// pattern's initialiser stayed in the list with nothing naming it.
	const reached = new Set<number>();
	for (let changed = true; changed;) {
		changed = false;
		const text = [
			...found.map((one) => one.expression),
			...[...reached].map((at) => rendered.held[at]?.expression ?? ''),
		].join('\n');
		for (const [at] of rendered.held.entries()) {
			if (reached.has(at) || !text.includes(`$$hold(${String(at)})`)) continue;
			reached.add(at);
			changed = true;
		}
	}
	for (const at of [...reached].sort((a, b) => a - b)) {
		const one = rendered.held[at];
		if (one !== undefined) found.push({ expression: one.expression, files: one.files });
	}
	// A default on one of the entry's props is a derivation like any other and may call anything
	// the entry's file has in scope -- `export let foo = get()`, a store read. It is not a hole, so
	// it would be gathered from nowhere, and the bundle would come out without what it calls: the
	// artifact compiled and the derivation threw at request time. See `Skeleton.defaults`.
	for (const one of [...rendered.defaults, ...rendered.eager]) {
		found.push({ expression: one.expression, files: one.files });
	}
	return found;
}

/**
 * Svelte's own functions a component's expressions call, which the author did not import.
 *
 * `attributes` writes the whole of an element's attributes from an object, which is what a `{...}`
 * needs and what cannot be enumerated at compile time; `attr_class` writes the whole of a class
 * attribute beside a `class:` directive; `clsx` is what the analysis wraps a class value in when it
 * may be an array or an object. Each goes in the carried bundle beside the author's own imports, so
 * both backends run **Svelte's implementation** rather than agreeing about a rule: nothing here
 * reproduces the merging, the escaping, the boolean names, the `defaultValue` mapping on an input
 * or the case rules for a namespaced element. `attributes` measured at 17 kB bundled, with its only
 * host references optionally chained off `globalThis`, so an evaluator with no host reads them as
 * undefined rather than failing. See spec/refusals.md.
 *
 * Here rather than in the compiler so that the check gathers with the function the build gathers
 * with, over the same holes.
 */
/**
 * The source with each span replaced, keeping every offset outside it where it was.
 *
 * A `0` and then spaces rather than spaces alone: a span may be a test as well as a fragment, and
 * `{:else if      }` does not parse where `{:else if 0     }` does. In markup the `0` is a text
 * node reading no names, which is what this is asked about.
 */
function blanked(source: string, spans: readonly [number, number][]): string {
	if (spans.length === 0) return source;
	let held = source;
	for (const [from, to] of spans) {
		if (to <= from) continue;
		held = held.slice(0, from) + `0${' '.repeat(to - from - 1)}` + held.slice(to);
	}
	return held;
}

export function helpers(rendered: Skeleton): Carried[] {
	const found: Carried[] = [];
	const from = 'svelte/internal/server';
	// Under a `$$` name, which nothing the author writes can shadow: Svelte reserves the prefix, so
	// `$$props`, `$$slots` and these are the only names that carry it. Svelte's own output calls
	// them through `$.`, and ours had them bare -- so a component with `export let attributes`, which
	// is an ordinary thing to call a prop, put an object where the helper's name was and the
	// derivation called it. Measured on `class-with-spread`.
	if (rendered.holes.some((one) => one.spread === true)) {
		found.push({ local: '$$attributes', from, kind: 'named', exported: 'attributes' });
	}
	if (rendered.holes.some((one) => one.whole === true)) {
		found.push({ local: '$$attr_class', from, kind: 'named', exported: 'attr_class' });
	}
	// Over every expression rather than the holes alone: a name a pattern binds is reached inside a
	// block's own expression and inside a fragment call's bindings as readily as inside a hole.
	const written = expressionsOf(rendered).map((one) => one.expression);
	// `attr_style` is the same answer for a `style` attribute beside a `style:` directive: one call
	// whose result is the whole attribute. Keyed off the expression rather than off `whole`, which
	// the class hole also sets. Measured at 1855 bytes bundled, its only host references optionally
	// chained off `globalThis`, which is the same terms `attributes` is carried on.
	if (written.some((one) => one.includes('$$attr_style('))) {
		found.push({ local: '$$attr_style', from, kind: 'named', exported: 'attr_style' });
	}
	if (written.some((one) => one.includes('$$clsx('))) {
		found.push({ local: '$$clsx', from, kind: 'named', exported: 'clsx' });
	}
	// What `build_attribute_value` puts around every expression in a template: `stringify` is
	// Svelte's, not a rule reproduced here, so nullish comes out empty rather than as "undefined".
	if (written.some((one) => one.includes('$$stringify('))) {
		found.push({ local: '$$stringify', from, kind: 'named', exported: 'stringify' });
	}
	// The two ways in a destructuring has that are not a member: what a rest gathers out of an
	// object, and the array a rest slices. Svelte's own, so the symbol keys and the iterable
	// handling are upstream's. See `takenApart()` in `walk.ts`.
	if (written.some((one) => one.includes('$$exclude_from_object('))) {
		found.push({
			local: '$$exclude_from_object',
			from,
			kind: 'named',
			exported: 'exclude_from_object',
		});
	}
	if (written.some((one) => one.includes('$$to_array('))) {
		found.push({ local: '$$to_array', from, kind: 'named', exported: 'to_array' });
	}
	// `$foo` is a subscription to the store `foo`. `get` subscribes, takes the value and
	// unsubscribes, which is the one-shot read a derivation needs: Svelte's own `store_get` holds
	// the subscription until the render tears down, and there is no teardown here.
	if (written.some((one) => one.includes('$$get_store('))) {
		found.push({ local: '$$get_store', from: 'svelte/store', kind: 'named', exported: 'get' });
	}
	// What `transform-server.js` builds `$$restProps` and `$$slots` from, over the payload itself.
	for (const name of ['rest_props', 'sanitize_props', 'sanitize_slots']) {
		if (written.some((one) => one.includes(`$$${name}(`))) {
			found.push({ local: `$$${name}`, from, kind: 'named', exported: name });
		}
	}
	// A boundary's children run in one catch, and each of their values is guarded against the throw.
	// This compiler's own, since Svelte's renderer keeps the equivalent private. See `caught.ts`.
	const caughtAt = fileURLToPath(new URL('./caught.ts', import.meta.url));
	if (written.some((one) => one.includes('$$caught('))) {
		found.push({ local: '$$caught', from: caughtAt, kind: 'named', exported: 'caught' });
	}
	if (written.some((one) => one.includes('$$tried('))) {
		found.push({ local: '$$tried', from: caughtAt, kind: 'named', exported: 'tried' });
	}
	if (written.some((one) => one.includes('$$unnamed('))) {
		found.push({ local: '$$unnamed', from: caughtAt, kind: 'named', exported: 'unnamed' });
	}
	return found;
}
