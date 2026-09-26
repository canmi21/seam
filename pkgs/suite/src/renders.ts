/**
 * The two renders of one sample: this compiler's, through the same steps a build takes, and
 * Svelte's own, bundled the way the refusal check bundles its oracle. See spec/suite.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { rolldown } from 'rolldown';
import { compile as compileComponent, compileModule } from 'svelte/compiler';
import { render } from 'svelte/server';
import { carry } from 'carry';
import { decidedAs, joined, merged, structures } from 'compiler';
import { compile as compileDerivations } from 'derive';
import { inject } from 'injector';
import { lower } from 'lowering';
import type { Config } from './corpus.ts';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The one render this measures: Svelte's with `experimental.async` on, both sides compiled with it
 * and both renders awaited.
 *
 * It is the render a project with the flag gets today and the only one Svelte 6 keeps, and it
 * renders everything the synchronous one does. The synchronous render was a second pass, in a
 * process of its own since the flag is process-global and nothing turns it off; measured under
 * this one, every sample it passed still passes but one, which is owed. See spec/suite.md.
 */
export const ASYNC = { experimental: { async: true as const } };
/**
 * Where a sample is copied to before it is compiled.
 *
 * Copied rather than read in place, because both halves write beside the component -- `skeleton()`
 * stages Svelte's compiled output next to it and the oracle writes its bundle there -- and the
 * vendored files are upstream's, unedited. `.build*` is ignored by name.
 */
export const STAGE = resolve(here, '../.build-suite');

/** A render's bytes, and what a `hash` policy has to allow for them. */
export interface Rendered {
	body: string;
	head: string;
	hashes?: { script: string[] };
}

/** What this compiler makes of the sample, through the same steps a build takes. */
export async function ours(
	dir: string,
	props: Record<string, unknown>,
	/** The policy the oracle is handed, handed to the injector as the plugin hands it Kit's. */
	csp?: Config['csp'],
	/** What the oracle is handed as `transformError`, handed to the derivations as a render option. */
	transformError?: Config['transformError'],
): Promise<Awaited<ReturnType<typeof inject>>> {
	// Not `compile()`: that batches lowering across a whole project and writes artifacts to disk,
	// and this is one component compared in memory. The steps are its steps.
	const runs = await structures({ path: '/', component: 'main.svelte' }, dir);
	const lowered = lower(runs.map((one) => [one.id, JSON.stringify(one.skeleton)] as const));
	for (const one of lowered) {
		if (one === undefined) throw new Error('nothing came back from lowering');
		if ('error' in one) throw new Error(one.error);
	}
	const first = runs[0];
	if (first === undefined) throw new Error('the component compiled to no structures at all');
	const compiled = joined(
		first.id,
		runs.map((one, at) => ({
			fixed: one.fixed,
			decided: decidedAs(one),
			held: one.skeleton.held,
			compiled: lowered[at] as unknown as Parameters<typeof joined>[1][number]['compiled'],
		})),
		first.skeleton.defaults,
		first.skeleton.eager,
	);
	// One bundle over what every structure of it calls, which is what a route gets.
	const carried = await carry(first.file, merged(runs.map((one) => one.names)));
	const derive = compileDerivations(compiled.derivations, carried);
	return await seededly(async () =>
		inject(
			compiled.ir as Parameters<typeof inject>[0],
			derive(props, transformError === undefined ? {} : { transformError }),
			csp === undefined ? {} : { csp },
		),
	);
}

/**
 * What Svelte makes of it, bundled the way the refusal check bundles its oracle.
 *
 * Node cannot load a `.svelte`, so every component the entry reaches is compiled where it sits and
 * its runes modules with it, and Svelte's own runtime stays external so one copy of it runs. The
 * `rootDir` is the sample's directory, which is what the compile above used: Svelte hashes the
 * filename relative to it into a head anchor and into a scoped class, so an oracle rooted
 * elsewhere renders a different component.
 */
export async function theirs(
	dir: string,
	props: Record<string, unknown>,
	/** What the sample hands `render()` for an error a boundary catches. See `Config`. */
	transformError: ((error: unknown) => unknown) | undefined,
	/** The mode to compile in, or undefined where Svelte decides. See `RUNES`. */
	runes: boolean | undefined,
	/** What the sample hands `render()` for a content security policy. See `Config.csp`. */
	csp: Config['csp'],
	/** Whether to render with a browser's globals in place. See `withDom`. */
	dom = false,
): Promise<{ body: string; head: string }> {
	// A file of its own for each, since a module whose evaluation threw stays thrown when imported
	// again, and the render with a DOM is asked only after the one without it failed.
	const out = resolve(dir, dom ? 'oracle-dom.js' : 'oracle.js');
	// **The entry re-exports the component rather than holding a compiled copy of it.** Compiled
	// into the entry, `main.svelte` was in the graph twice -- once here and once through the
	// plugin, for every child that imports the entry's own `<script module>` -- so its module block
	// ran twice and everything it declares had two identities. `createContext()` returns a closure
	// over a fresh key, so `set` in one copy and `get` in the other is `missing_context`:
	// `runtime-runes/create-context` and `error-boundary-27` were counted as the oracle failing
	// where they render perfectly well. It is the same fault `spec/refusals.md` records for a copy
	// this compiler stages, met on the other side of the comparison.
	writeFileSync(out, `export { default } from ${JSON.stringify(resolve(dir, 'main.svelte'))};\n`);
	const bundle = await rolldown({
		input: out,
		platform: 'node',
		resolve: { conditionNames: ['svelte', 'import', 'default'] },
		external: [/^svelte(?:\/|$)/],
		// An import of a name the module does not export is `undefined` under Vite, which upstream
		// runs under, and an error under rolldown's default. `context-api-b` imports one.
		shimMissingExports: true,
		logLevel: 'silent',
		plugins: [
			{
				name: 'svelte',
				load(id: string) {
					if (id.endsWith('.svelte')) {
						return compileComponent(readFileSync(id, 'utf8'), {
							generate: 'server',
							name: basename(id, '.svelte'),
							filename: id,
							rootDir: dir,
							...ASYNC,
							...(runes === undefined ? {} : { runes }),
						}).js.code;
					}
					if (/\.svelte\.(?:js|ts)$/.test(id)) {
						const text = readFileSync(id, 'utf8');
						return compileModule(id.endsWith('.ts') ? stripTypeScriptTypes(text) : text, {
							generate: 'server',
							filename: id,
							...ASYNC,
						}).js.code;
					}
					return null;
				},
			},
		],
	});
	const { output } = await bundle.generate({ format: 'es' });
	await bundle.close();
	const [chunk] = output;
	if (chunk === undefined) throw new Error('nothing came out of bundling the oracle');
	writeFileSync(out, chunk.code);
	return withDom(dom, async () => {
		const mod = (await import(pathToFileURL(out).href)) as {
			default: Parameters<typeof render>[0];
		};
		return seededly(async () => {
			const rendered = render(mod.default, {
				props: props as never,
				...(transformError === undefined ? {} : { transformError }),
				...(csp === undefined ? {} : { csp }),
			});
			const held = (await rendered) as Rendered;
			return {
				body: held.body,
				head: held.head,
				...(held.hashes === undefined ? {} : { hashes: held.hashes }),
			};
		});
	});
}

/**
 * One side's render with `Math.random` drawing the numbers the other side's draws: a sample that
 * reads randomness agrees only where both read one sequence. It makes nothing agree that would not:
 * a render drawing a different number of times, or in another order, still writes other bytes. See
 * spec/suite.md.
 */
async function seededly<T>(run: () => Promise<T>): Promise<T> {
	const random = Math.random;
	let state = 0x9e3779b9;
	Math.random = () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let mixed = Math.imul(state ^ (state >>> 15), state | 1);
		mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
	try {
		return await run();
	} finally {
		Math.random = random;
	}
}

/**
 * Runs the oracle with a browser's globals in place where `dom` says so, and takes them away again.
 *
 * Upstream renders both runtime suites' server variant under `// @vitest-environment jsdom`, so a
 * sample reading `document`, `customElements` or a bare `name` -- which is `window.name` -- renders
 * there and throws in plain Node. Kit's server is plain Node, so a sample that renders only with a
 * DOM is not one a server can render either: it is asked with one only to say so, and skipped as
 * upstream's environment. This compiler never gets a DOM. See spec/suite.md.
 */
async function withDom<T>(dom: boolean, what: () => Promise<T>): Promise<T> {
	if (!dom) return what();
	const { window } = new JSDOM('', { url: 'http://localhost/' });
	const held = globalThis as unknown as Record<string, unknown>;
	const added = Object.getOwnPropertyNames(window).filter((key) => !(key in globalThis));
	for (const key of added) held[key] = (window as unknown as Record<string, unknown>)[key];
	try {
		return await what();
	} finally {
		for (const key of added) delete held[key];
		window.close();
	}
}

/** What a render that passes its deadline is reported as, on either side. */
export const NEVER_SETTLED = 'the render never settled';

/**
 * A render's deadline. A sample handing the render `new Promise(() => {})` waits forever, and a
 * promise waited on is not a result; the one that passes it is thrown as `why`.
 */
export function settling<T>(rendering: Promise<T>, why: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		rendering,
		new Promise<never>((_, refuse) => {
			timer = setTimeout(() => refuse(new Error(why)), 5000);
		}),
	]).finally(() => {
		if (timer !== undefined) clearTimeout(timer);
	});
}
