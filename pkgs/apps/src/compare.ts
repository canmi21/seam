/**
 * One of SvelteKit's own test apps, built twice -- as Kit alone builds it and as the fork does --
 * and every page asked of both: the responses have to be the same bytes. It is the check the
 * Playwright specs make only where a spec happens to look, made over every page route the app has
 * and every URL its specs name. See spec/conformance.md, "Stage 2".
 *
 *   node pkgs/apps/src/compare.ts --app=basics
 *   node pkgs/apps/src/compare.ts --app=basics --reuse    the last builds, not built again
 *   node pkgs/apps/src/compare.ts --app=basics --kit-root=throw
 *
 * `--kit-root=throw` builds ours so that a render handed to Kit's own root throws instead, which is
 * how milestone A's third check is taken: every such request is a difference, and the server's log
 * names each one. See spec/conformance.md, "Stage 2".
 *
 * Each URL is asked of two servers of Kit's build and one of ours, once each and in the same order,
 * so that state a server keeps across requests -- a counter several routes share -- stands at the
 * same value in all three. A page whose two answers from Kit already differ -- a clock, a random
 * id -- is unstable rather than different, and is reported apart. What two builds of one app legitimately differ in, the version Kit names
 * each build by and the hashes in the client's file names, is written out before comparing.
 *
 * Kit's build has `vendor/kit` as its Kit and ours has the fork, so the two client builds read
 * Kit's client from two paths, and the bundler hashes the path in: the same chunk comes out under
 * another name, and every page naming it differs by that. An install puts either in the same
 * `node_modules/@sveltejs/kit`, so the names are matched rather than masked: every file of ours is
 * paired with Kit's whose content is the same once the names in it are, and ours are written as
 * Kit's before the pages are compared. A file with no such pair is a difference of its own.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { streamedIn, withoutStreamed } from '@seam-js/stream/fold';
import { bin, pkg, stage, staged, type Staged } from './stage.ts';
import { ask, normaliser, outDir, paired, parting, type Answer } from './same.ts';
import { answers, specURLs, urlOf } from './urls.ts';

function argument(name: string): string | undefined {
	return process.argv.find((one) => one.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const app = argument('app') ?? 'basics';
const out = resolve(pkg, '.build-apps/compare', app);
// Read by the plugin when ours is built; see `KIT_ROOT_CHECK` in pkgs/plugin/src/plugin.ts.
const kitRoot = argument('kit-root');
if (kitRoot !== undefined) process.env['SEAM_KIT_ROOT'] = kitRoot;
/** Where our server's stderr goes, which is where the check names what reached Kit's root. */
const seamLog = resolve(out, 'preview.seam.log');

function build(built: Staged, log: string): void {
	const mode = built.mode === undefined ? [] : ['--mode', built.mode];
	const ran = spawnSync(resolve(bin, 'vite'), ['build', '--config', built.viteConfig, ...mode], {
		cwd: built.dir,
		env: built.env,
		encoding: 'utf8',
		maxBuffer: 1 << 28,
	});
	writeFileSync(log, `${ran.stdout}\n${ran.stderr}`);
	if (ran.status !== 0)
		throw new Error(`the build in ${built.dir} exited ${String(ran.status)}; see ${log}`);
}

async function preview(built: Staged, port: number, log?: string): Promise<ChildProcess> {
	// A server already there would answer for this one, and the comparison would be of its app: a
	// run that crashed once left three behind, and every app after it was compared against them.
	if (await answers(port)) throw new Error(`something already listens on ${String(port)}`);
	const child = spawn(
		resolve(bin, 'vite'),
		['preview', '--config', built.viteConfig, '--port', String(port), '--strictPort'],
		{
			cwd: built.dir,
			env: { ...built.env, ...built.previewEnv },
			stdio: ['ignore', 'ignore', log === undefined ? 'ignore' : openSync(log, 'w')],
		},
	);
	for (let i = 0; i < 100; i += 1) {
		if (child.exitCode !== null) break;
		if (await answers(port)) return child;
		await new Promise((done) => setTimeout(done, 100));
	}
	child.kill();
	throw new Error(`the preview on ${String(port)} did not answer`);
}

const reuse = process.argv.includes('--reuse');
let plain = staged(app, true);
let ours = staged(app, false);
if (reuse) {
	for (const file of readdirSync(out))
		if (/\.(kit|seam)\.txt$/.test(file)) rmSync(resolve(out, file));
} else {
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });
	plain = stage(app, true);
	ours = stage(app, false);
	console.log(`building ${app} twice`);
	build(plain, resolve(out, 'build.plain.log'));
	build(ours, resolve(out, 'build.seam.log'));
}

const { manifest } = (await import(
	pathToFileURL(resolve(outDir(plain.dir), 'output/server/manifest-full.js')).href
)) as {
	manifest: { app_dir: string; app_path: string; routes: { id: string; page: unknown }[] };
};
// Kit's `paths.base`, which `options-2` sets to `/basepath`: the manifest's `app_path` is the base
// and the app directory joined, without the leading slash, and `app_dir` alone where there is none.
const base =
	manifest.app_path === manifest.app_dir
		? ''
		: `/${manifest.app_path.slice(0, -(manifest.app_dir.length + 1))}`;
const based = (url: string): string =>
	base === '' || url === base || url.startsWith(`${base}/`) ? url : `${base}${url}`;
const pages = manifest.routes.filter((one) => one.page !== null).map((one) => urlOf(one.id));
const urls = [...new Set([...pages, ...specURLs(plain.dir)].map(based))].toSorted();

const kitPort = 4791;
const seamPort = 4792;
const againPort = 4793;
const servers: ChildProcess[] = [];
const same: string[] = [];
/** The same once what was streamed after the page is taken out: a declared difference, and only that. */
const declared: string[] = [];
/** Kit's two answers differ, and ours is one of them: a clock or a counter both servers keep. */
const unstable: string[] = [];
/** Kit's two answers differ, and ours is neither: not settled by this comparison. */
const unsettled: { url: string; kit: string; seam: string }[] = [];
const differ: { url: string; kit: string; seam: string }[] = [];
/** Files of our client build with no file of Kit's alike in everything but their names. */
let clientDiffers: string[] = [];
try {
	servers.push(await preview(plain, kitPort));
	servers.push(await preview(ours, seamPort, seamLog));
	servers.push(await preview(plain, againPort));
	const { names, kitNames, unpaired } = paired(plain.dir, ours.dir);
	clientDiffers = unpaired;
	const kitText = normaliser(plain.dir, kitNames);
	const seamText = normaliser(ours.dir, names, true);
	for (const url of urls) {
		const kitFirst = await ask(kitPort, url);
		const seamAnswer = await ask(seamPort, url);
		const kitAgain = await ask(againPort, url);
		// What the page streamed after it, taken out of all three: the one declared difference a
		// page's own bytes may carry. See spec/conformance.md, "Declared differences".
		const streamed = streamedIn(seamAnswer.body);
		const bare = (answer: Answer): Answer => ({
			...answer,
			body: withoutStreamed(answer.body, streamed),
		});
		const first = kitText(bare(kitFirst));
		const seam = seamText(bare(seamAnswer));
		const again = kitText(bare(kitAgain));
		if (first !== again) {
			if (seam === first || seam === again) unstable.push(url);
			else unsettled.push({ url, kit: first, seam });
		} else if (first === seam) (streamed.length > 0 ? declared : same).push(url);
		else differ.push({ url, kit: first, seam });
	}
} finally {
	for (const one of servers) one.kill();
}

differ.forEach((one, i) => {
	writeFileSync(resolve(out, `${String(i)}.kit.txt`), `${one.url}\n${one.kit}`);
	writeFileSync(resolve(out, `${String(i)}.seam.txt`), `${one.url}\n${one.seam}`);
});
unsettled.forEach((one, i) => {
	writeFileSync(resolve(out, `unsettled-${String(i)}.kit.txt`), `${one.url}\n${one.kit}`);
	writeFileSync(resolve(out, `unsettled-${String(i)}.seam.txt`), `${one.url}\n${one.seam}`);
});
writeFileSync(
	resolve(out, 'summary.json'),
	`${JSON.stringify({ same, declared, unstable, unsettled: unsettled.map((one) => one.url), differ: differ.map((one) => one.url), clientDiffers }, null, '\t')}\n`,
);
for (const one of differ.slice(0, 20)) console.log(`\n${one.url}\n${parting(one.kit, one.seam)}`);
for (const one of clientDiffers) console.log(`client file with no match in Kit's build: ${one}`);
const refused = existsSync(seamLog)
	? readFileSync(seamLog, 'utf8')
			.split('\n')
			.filter((line) => line.startsWith("seam: Kit's root rendered"))
	: [];
if (refused.length > 0) {
	const counted = new Map<string, number>();
	for (const line of refused) counted.set(line, (counted.get(line) ?? 0) + 1);
	console.log(`\nKit's root, refused ${String(refused.length)} times:`);
	for (const [line, n] of counted) console.log(`  ${String(n)} x ${line}`);
}
console.log(
	`\n${String(urls.length)} URLs: ${String(same.length)} the same, ` +
		`${String(declared.length)} the same but for what they streamed, ${String(differ.length)} different; ` +
		`${String(unstable.length + unsettled.length)} unstable in Kit's own answers, of which ours matched ` +
		`one of Kit's for ${String(unstable.length)} and neither for ${String(unsettled.length)}. ` +
		`Each difference is in ${out}`,
);
process.exit(differ.length === 0 && clientDiffers.length === 0 ? 0 : 1);
