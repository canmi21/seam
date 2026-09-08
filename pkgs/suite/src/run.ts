/**
 * Svelte's own samples, compiled here and held against Svelte's own render of them.
 *
 * `pkgs/skeleton/src/skeleton.test.ts` is the refusal surface and every case in it was written
 * here, so it measures what somebody thought to write down. This runs the same comparison over a
 * corpus nobody here chose: the 2388 samples under `vendor/svelte`, each compiled, injected with
 * the props its own `_config.js` declares, and compared byte for byte -- body and head -- against
 * `render()` of the same component with the same props.
 *
 * **The oracle is `render()` and not the sample's `_expected.html`.** Upstream compares against
 * that file with `assert_html_equal`, which parses both sides and compares trees, so attribute
 * order, insignificant whitespace and the exact anchors do not survive it. Passing upstream's
 * assertion is a weaker claim than the one this protocol makes. See spec/suite.md.
 *
 * **It fails when a sample compiled and wrote the wrong bytes, and only then.** A refusal stopped
 * a build and named a specification file, so the author knows; a difference shipped bytes nobody
 * asked for, and the whole claim here is that the bytes are Svelte's. The refusals are printed as
 * a list, ranked elsewhere -- spec/roadmap.md -- rather than counted as failures.
 *
 * Run by `mise run suite`, apart from `verify`: a check that cannot pass stops being read, and
 * every commit would carry it. It joins the gate when the count that differs reaches zero, at
 * which point its condition becomes a regression check. See spec/suite.md.
 */
import {
	cpSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';
import { compile as compileComponent, compileModule } from 'svelte/compiler';
import { render } from 'svelte/server';
import { carry } from 'carry';
import { joined, merged, structures } from 'compiler';
import { compile as compileDerivations } from 'derive';
import { inject } from 'injector';
import { lower } from 'lowering';

const here = dirname(fileURLToPath(import.meta.url));
/** The vendored corpus, at the tag `vendor/svelte/VENDOR.md` pins. */
const SAMPLES = resolve(here, '../../../vendor/svelte/tests');
/**
 * Where a sample is copied to before it is compiled.
 *
 * Copied rather than read in place, because both halves write beside the component -- `skeleton()`
 * stages Svelte's compiled output next to it and the oracle writes its bundle there -- and the
 * vendored files are upstream's, unedited. `.build*` is ignored by name.
 */
const STAGE = resolve(here, '../.build-suite');

/**
 * The suites whose assertions a server render can be held to, and what each was written for.
 *
 * Only the first is about server bytes. The two runtime suites are the client's, repurposed: both
 * sides are handed the same props and the server render is what is compared. They are in because
 * they found most of what was wrong -- 97 of the 115 samples that compiled and wrote the wrong
 * bytes the first time this ran were theirs. See spec/suite.md.
 */
const SUITES = ['server-side-rendering', 'runtime-runes', 'runtime-legacy'] as const;

/**
 * A body of 20 bytes or fewer, which is `<!--[--><!--]-->` and nothing else.
 *
 * A sample that renders to nothing agrees with Svelte for a reason that says nothing about the
 * compiler, and the two runtime suites hold some because they were written to be driven by a
 * client. Counted apart rather than dropped: they are agreements, just not evidence.
 */
const EMPTY = 20;

/**
 * What upstream's own `_config.js` says about a sample, read rather than judged.
 *
 * A sample is skipped here only where upstream skips it: `skip` outright, a `mode` that does not
 * include `sync`, an `error` the sample is written to produce, or output it loads precompiled.
 * Nothing else is skipped, because a skip nobody upstream asked for is a number made to look
 * better. `props` is what both sides are handed.
 */
interface Config {
	skip?: boolean;
	mode?: string[];
	error?: unknown;
	load_compiled?: boolean;
	props?: Record<string, unknown>;
}

type Outcome = 'identical' | 'empty' | 'differs' | 'refused' | 'skipped' | 'oracle';

interface Result {
	suite: string;
	name: string;
	outcome: Outcome;
	/** Why, for everything but an agreement: the refusal, the skip's reason, the stream that differs. */
	why?: string;
}

const need = createRequire(import.meta.url);

/**
 * The sample's configuration, with the harness import it opens with stood in for.
 *
 * Every `_config.js` is `import { test } from '../../test'; export default test({ ... })`, and
 * that harness is upstream's runner rather than its fixtures, so it is not vendored. The import is
 * replaced by an identity and the object read straight off the default export. A config that will
 * not evaluate is a skip that says so, not a silent empty one.
 */
async function configOf(from: string, into: string): Promise<Config & { broken?: string }> {
	let source: string;
	try {
		source = readFileSync(resolve(from, '_config.js'), 'utf8');
	} catch {
		// Most samples have none, and a sample with no config is one with no props.
		return {};
	}
	const shimmed = source.replace(
		/import\s*\{\s*test\s*\}\s*from\s*['"][^'"]+['"];?/,
		'const test = (one) => one;',
	);
	const at = resolve(into, '_config.mjs');
	writeFileSync(at, shimmed);
	try {
		const mod = (await import(pathToFileURL(at).href)) as { default?: Config };
		return mod.default ?? {};
	} catch (error) {
		return { broken: (error as Error).message };
	}
}

/** What this compiler makes of the sample, through the same steps a build takes. */
async function ours(
	dir: string,
	props: Record<string, unknown>,
): Promise<ReturnType<typeof inject>> {
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
			decided: one.decided,
			compiled: lowered[at] as unknown as Parameters<typeof joined>[1][number]['compiled'],
		})),
		first.skeleton.defaults,
	);
	// One bundle over what every structure of it calls, which is what a route gets.
	const carried = await carry(first.file, merged(runs.map((one) => one.names)));
	const derive = compileDerivations(compiled.derivations, carried);
	return inject(compiled.ir as Parameters<typeof inject>[0], derive(props));
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
async function theirs(
	dir: string,
	props: Record<string, unknown>,
): Promise<{ body: string; head: string }> {
	const file = resolve(dir, 'main.svelte');
	const out = resolve(dir, 'oracle.js');
	writeFileSync(
		out,
		compileComponent(readFileSync(file, 'utf8'), {
			generate: 'server',
			name: 'C',
			filename: file,
			rootDir: dir,
		}).js.code,
	);
	const bundle = await rolldown({
		input: out,
		platform: 'node',
		resolve: { conditionNames: ['svelte', 'import', 'default'] },
		external: [/^svelte(?:\/|$)/],
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
						}).js.code;
					}
					if (/\.svelte\.(?:js|ts)$/.test(id)) {
						const text = readFileSync(id, 'utf8');
						return compileModule(id.endsWith('.ts') ? stripTypeScriptTypes(text) : text, {
							generate: 'server',
							filename: id,
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
	const mod = (await import(pathToFileURL(out).href)) as { default: Parameters<typeof render>[0] };
	const rendered = render(mod.default, { props: props as never });
	return { body: rendered.body, head: rendered.head };
}

/** One sample, staged, compiled, rendered and compared. */
async function attempt(suite: string, name: string): Promise<Result> {
	const from = resolve(SAMPLES, suite, 'samples', name);
	const dir = resolve(STAGE, suite, name);
	mkdirSync(dir, { recursive: true });
	cpSync(from, dir, { recursive: true });

	const config = await configOf(from, dir);
	const why =
		config.broken !== undefined
			? `its config will not evaluate: ${config.broken}`
			: config.skip === true
				? 'upstream skips it'
				: Array.isArray(config.mode) && !config.mode.includes('sync')
					? 'upstream runs it only in async mode'
					: config.error !== undefined
						? 'upstream expects it to error'
						: config.load_compiled === true
							? 'upstream loads its output precompiled'
							: null;
	if (why !== null) return { suite, name, outcome: 'skipped', why };

	const props = config.props ?? {};
	let mine: { body: string; head: string };
	try {
		mine = await ours(dir, props);
	} catch (error) {
		return { suite, name, outcome: 'refused', why: firstLine(error) };
	}
	let svelte: { body: string; head: string };
	try {
		svelte = await theirs(dir, props);
	} catch (error) {
		// Neither side's answer: the oracle could not be built or run. Reported apart so it is never
		// read as agreement, and never as a refusal either.
		return { suite, name, outcome: 'oracle', why: firstLine(error) };
	}

	if (mine.body !== svelte.body) {
		return { suite, name, outcome: 'differs', why: divergence('body', mine.body, svelte.body) };
	}
	if (mine.head !== svelte.head) {
		return { suite, name, outcome: 'differs', why: divergence('head', mine.head, svelte.head) };
	}
	return { suite, name, outcome: svelte.body.length <= EMPTY ? 'empty' : 'identical' };
}

/**
 * Where two renders part, as the bytes around it from both sides.
 *
 * The name of a differing sample says nothing about why it differs, and forty of them are read one
 * at a time to be grouped into causes -- which was a second tool until it was this. Anchored at the
 * first byte that disagrees rather than at a whole-string diff: what is wanted is the construct,
 * and the construct is at the seam.
 */
function divergence(stream: string, mine: string, theirs: string): string {
	let at = 0;
	while (at < mine.length && at < theirs.length && mine[at] === theirs[at]) at += 1;
	const from = Math.max(0, at - 40);
	const show = (text: string): string =>
		JSON.stringify(text.slice(from, at + 60)).replaceAll('\\n', ' ');
	return `${stream} at ${String(at)}\n      ours   ${show(mine)}\n      svelte ${show(theirs)}`;
}

function firstLine(error: unknown): string {
	const [line] = String((error as Error).message).split('\n');
	return line ?? 'it failed and said nothing';
}

function samplesOf(suite: string): string[] {
	return readdirSync(resolve(SAMPLES, suite, 'samples'), { withFileTypes: true })
		.filter((one) => one.isDirectory())
		.map((one) => one.name)
		.sort();
}

function count(results: readonly Result[], outcome: Outcome): number {
	return results.filter((one) => one.outcome === outcome).length;
}

function list(results: readonly Result[], outcome: Outcome, title: string): void {
	const found = results.filter((one) => one.outcome === outcome);
	if (found.length === 0) return;
	console.log(`\n${title} (${String(found.length)})`);
	for (const one of found) {
		console.log(`  ${one.suite}/${one.name}${one.why === undefined ? '' : `\n      ${one.why}`}`);
	}
}

// A sample is free to throw from a promise nobody awaits -- several are written to -- and the
// default is to end the process. The outcome of the sample that did it is already recorded by the
// time this fires, so the run continues.
process.on('unhandledRejection', () => undefined);

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(resolve(STAGE, 'node_modules'), { recursive: true });
// The bundled oracle keeps Svelte's own runtime external, so it has to resolve from where it sits.
symlinkSync(
	dirname(need.resolve('svelte/package.json')),
	resolve(STAGE, 'node_modules/svelte'),
	'dir',
);

const results: Result[] = [];
for (const suite of SUITES) {
	for (const name of samplesOf(suite)) results.push(await attempt(suite, name));
}

const width = Math.max(...SUITES.map((one) => one.length));
console.log(
	`\n${'suite'.padEnd(width)}  ${'samples'.padStart(8)}${'identical'.padStart(11)}${'empty'.padStart(7)}${'differs'.padStart(9)}${'refused'.padStart(9)}${'skipped'.padStart(9)}${'oracle'.padStart(8)}`,
);
for (const suite of SUITES) {
	const mine = results.filter((one) => one.suite === suite);
	console.log(
		`${suite.padEnd(width)}  ${String(mine.length).padStart(8)}${String(count(mine, 'identical')).padStart(11)}${String(count(mine, 'empty')).padStart(7)}${String(count(mine, 'differs')).padStart(9)}${String(count(mine, 'refused')).padStart(9)}${String(count(mine, 'skipped')).padStart(9)}${String(count(mine, 'oracle')).padStart(8)}`,
	);
}
console.log(
	`${'total'.padEnd(width)}  ${String(results.length).padStart(8)}${String(count(results, 'identical')).padStart(11)}${String(count(results, 'empty')).padStart(7)}${String(count(results, 'differs')).padStart(9)}${String(count(results, 'refused')).padStart(9)}${String(count(results, 'skipped')).padStart(9)}${String(count(results, 'oracle')).padStart(8)}`,
);

list(results, 'differs', "compiled and wrote bytes that are not Svelte's");
list(results, 'oracle', 'neither side answered: the oracle could not be built or run');
list(results, 'refused', 'refused, each naming where the question lives');

const differs = count(results, 'differs');
console.log(
	`\n${String(differs)} sample(s) wrote the wrong bytes. A refusal names a file and stops a build; a difference ships. See spec/suite.md.`,
);
rmSync(STAGE, { recursive: true, force: true });
process.exit(differs === 0 ? 0 : 1);
