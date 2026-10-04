/**
 * The script run of a component: how a walk captures what the instance script leaves and what the
 * render is handed of it. See spec/derivation.md, "Where substitution cannot follow, the script
 * runs as Svelte compiled it".
 */
import { importsOf } from '@seam-js/ast';
import { resolve as resolvePath } from 'node:path';
import { GIVEN, projectAsync, readsReplaced, resolveBare, RUN_NAME } from '@seam-js/ast';
import { refuse } from './node.ts';
import type { Skeleton } from './shape.ts';
import { HYDRATABLE, HYDRATABLE_RUN } from './dynamic.ts';
import { declaredIn, hydratableImport } from './hydratable.ts';

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
export function ran(
	rendered: Skeleton,
	entry: string,
	changed: ReadonlySet<string>,
	source: string,
	/** Whether the markup itself changes the run's state while the bytes are written. */
	live = false,
	root = '',
	/** The tests the build decided this structure on, which are the entry's expressions too. */
	decidedKeys: readonly string[] = [],
): void {
	if (changed.size === 0) return;
	const hydrating = HYDRATABLE.test(source);
	// A component the run chose is compared by identity inside the run, whose capture hands out
	// the file's component imports beside its declarations: the walk wrote the `this` as a chain
	// of `(name === Import)` tests (`runChosen()` in components.ts), and both sides of each become
	// fields of the run here. So the imports join the names the run answers, for that file alone.
	// See spec/derivation.md, "A component the run chose is compared inside the run".
	const component = [...changed].find((name) =>
		new RegExp(`this=\\{[^}]*\\b${name}\\b|<${name}[\\s/>]`).test(source),
	);
	const imports =
		component === undefined
			? []
			: [...importsOf(source)]
					.filter(
						([, one]) =>
							one.kind === 'default' &&
							(resolveBare(one.from, resolvePath(root, entry)) ?? one.from).endsWith('.svelte'),
					)
					.map(([local]) => local);
	const names = new Set([...changed, ...[...changed].map((one) => `$${one}`), ...imports]);
	// The request's `hydratable` goes to the run, whose script makes its calls in its own order and
	// under its own conditions, which is Svelte's. See `captured()` in the ast package.
	const imported = hydrating ? hydratableImport(source) : { local: null, module: false };
	const call = `${RUN_NAME}(${GIVEN}, ${imported.local ?? 'undefined'}, $$request)`;
	const running = projectAsync() ? `(await ${call})` : call;
	let at: number | undefined;
	const field = (name: string): string => {
		if (hydrating && (imported.local === null || imported.module)) refuse(HYDRATABLE_RUN);
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
	// too, and read once, where the render reads it. Over a copy of the list, since `field()`
	// appends the run's own hold to it on the first read it answers, and the copy is what keeps the
	// loop off what it appends.
	for (const one of rendered.held.slice()) {
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
	// A test the build decided is the structure's own test at request time, and it reads the run's
	// fields as the rest of the entry's expressions do. See `Skeleton.decidedAs`.
	const decidedAs: Record<string, string> = {};
	for (const test of decidedKeys) {
		const mapped = over(test);
		if (mapped !== test) decidedAs[test] = mapped;
	}
	if (Object.keys(decidedAs).length > 0) rendered.decidedAs = decidedAs;
	// Taken, the run is what makes the entry's `hydratable` calls: once, first, whether or not the
	// markup reads what they return, as Svelte's script makes them. The calls read out of the source
	// one by one would make every one of them, whichever branch the script takes.
	if (at !== undefined && imported.local !== null) {
		rendered.eager = [{ expression: running, files: [entry] }];
	}
}
